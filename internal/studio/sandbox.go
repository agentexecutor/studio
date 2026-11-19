// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package studio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
)

// ChangedFile summarizes a modified, added, or deleted file inside a task sandbox.
type ChangedFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"` // "M" | "A" | "D" | "?"
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch"`
}

// TaskChangesResponse is returned by GET /api/tasks/changes.
type TaskChangesResponse struct {
	TaskName  string        `json:"taskName"`
	Available bool          `json:"available"`
	Reason    string        `json:"reason,omitempty"`
	RepoDir   string        `json:"repoDir,omitempty"`
	Branch    string        `json:"branch,omitempty"`
	Files     []ChangedFile `json:"files"`
	FullPatch string        `json:"fullPatch"`
}

func validateRelativeSandboxPath(p string) error {
	p = strings.TrimSpace(p)
	if p == "" || strings.HasPrefix(p, "/") || strings.HasPrefix(p, "-") || strings.ContainsRune(p, 0) {
		return errors.New("invalid file path")
	}
	for _, seg := range strings.Split(filepath.ToSlash(p), "/") {
		if seg == ".." || seg == "" {
			return errors.New("path traversal is not allowed")
		}
	}
	return nil
}

func validateLocalGitRepoDir(rawPath string) (string, error) {
	trimmed := strings.TrimSpace(rawPath)
	if trimmed == "" {
		return "", errors.New("local repository path is required")
	}
	if strings.HasPrefix(trimmed, "~/") || trimmed == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolving home directory: %w", err)
		}
		trimmed = filepath.Join(home, strings.TrimPrefix(trimmed, "~"))
	}
	cleaned := filepath.Clean(trimmed)
	if !filepath.IsAbs(cleaned) {
		return "", errors.New("local repository path must be an absolute path (or start with ~/)")
	}
	resolved, err := filepath.EvalSymlinks(cleaned)
	if err != nil {
		return "", fmt.Errorf("local directory does not exist: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", errors.New("target path is not a directory")
	}
	if _, err := os.Stat(filepath.Join(resolved, ".git")); err != nil {
		return "", errors.New("target directory is not a Git repository (missing .git)")
	}
	return resolved, nil
}

func (s *Server) collectTaskChanges(ctx context.Context, kubeCtx, atespace, taskName string) (*TaskChangesResponse, error) {
	if atespace == "" {
		atespace = v1alpha1.DefaultAtespace
	}
	if err := kube.ValidateName(taskName); err != nil {
		return nil, fmt.Errorf("invalid task name: %w", err)
	}
	if s.guestExec == nil {
		return &TaskChangesResponse{TaskName: taskName, Available: false, Reason: "Guest sandbox client is not configured."}, nil
	}

	client, conn, err := s.dialAXForContext(ctx, kubeCtx)
	if err != nil {
		return nil, fmt.Errorf("connecting to cluster: %w", err)
	}
	defer conn.Close()

	task, err := client.GetTask(ctx, &v1alpha1.GetTaskRequest{Atespace: atespace, Name: taskName})
	if err != nil {
		return nil, fmt.Errorf("fetching task %q: %w", taskName, err)
	}
	if !task.GetSpec().GetDebug() {
		return &TaskChangesResponse{
			TaskName:  taskName,
			Available: false,
			Reason:    "Sandbox inspection requires spec.debug: true on the Task.",
		}, nil
	}
	state := task.GetStatus().GetState()
	if state == v1alpha1.TaskState_TASK_STATE_SUSPENDED || state == v1alpha1.TaskState_TASK_STATE_SUSPENDING {
		return &TaskChangesResponse{
			TaskName:  taskName,
			Available: false,
			Reason:    "Task sandbox is currently Suspended. Resume the task to inspect or apply working tree changes.",
		}, nil
	}
	actor := task.GetStatus().GetActor()
	if actor == "" {
		return &TaskChangesResponse{
			TaskName:  taskName,
			Available: false,
			Reason:    "Task has no active sandbox actor yet.",
		}, nil
	}

	var ws *v1alpha1.Workspace
	if wsName := task.GetSpec().GetWorkspace().GetName(); wsName != "" {
		ws, _ = client.GetWorkspace(ctx, &v1alpha1.GetWorkspaceRequest{Atespace: atespace, Name: wsName})
	}

	repoDir := s.locateSandboxGitDir(ctx, kubeCtx, atespace, task, ws)
	if repoDir == "" {
		return &TaskChangesResponse{
			TaskName:  taskName,
			Available: false,
			Reason:    "No Git repository found inside /workspace.",
		}, nil
	}

	branchOut, _, _, _ := s.guestExec(ctx, atespace, taskName, kubeCtx, s.axNamespace, []string{"git", "rev-parse", "--abbrev-ref", "HEAD"}, repoDir)
	// Every untracked file is listed. By default git lists a new directory
	// as one entry, and the files in it would be missing from the changes.
	statusOut, _, code, stErr := s.guestExec(ctx, atespace, taskName, kubeCtx, s.axNamespace, []string{"git", "status", "--porcelain", "--untracked-files=all"}, repoDir)
	if stErr != nil || code != 0 {
		return &TaskChangesResponse{
			TaskName:  taskName,
			Available: false,
			Reason:    "Unable to read git status from sandbox.",
		}, nil
	}

	resp := &TaskChangesResponse{
		TaskName:  taskName,
		Available: true,
		RepoDir:   repoDir,
		Branch:    strings.TrimSpace(branchOut),
		Files:     []ChangedFile{},
	}

	var patchParts []string
	trackedDiff, _, _, _ := s.guestExec(ctx, atespace, taskName, kubeCtx, s.axNamespace, []string{"git", "diff", "HEAD", "--unified=3"}, repoDir)
	if strings.TrimSpace(trackedDiff) != "" {
		patchParts = append(patchParts, strings.TrimRight(trackedDiff, "\n")+"\n")
	}

	perFilePatches := splitGitDiffByFile(trackedDiff)

	for _, rawLine := range strings.Split(strings.TrimRight(statusOut, "\r\n"), "\n") {
		if len(rawLine) < 4 {
			continue
		}
		xy := strings.TrimSpace(rawLine[:2])
		filePath := strings.TrimSpace(rawLine[3:])
		if idx := strings.Index(filePath, " -> "); idx >= 0 {
			filePath = strings.TrimSpace(filePath[idx+4:])
		}
		if filePath == ".ax" || strings.HasPrefix(filePath, ".ax/") {
			continue
		}
		if err := validateRelativeSandboxPath(filePath); err != nil {
			continue
		}

		stCode := "M"
		switch {
		case strings.Contains(xy, "?"):
			stCode = "?"
		case strings.Contains(xy, "A"):
			stCode = "A"
		case strings.Contains(xy, "D"):
			stCode = "D"
		}

		filePatch := perFilePatches[filePath]
		if stCode == "?" {
			// Synthesize a git-apply compatible diff for untracked files (git diff --no-index exits 1 when differences exist).
			uDiff, _, uCode, uErr := s.guestExec(ctx, atespace, taskName, kubeCtx, s.axNamespace, []string{"git", "diff", "--no-index", "--", "/dev/null", filePath}, repoDir)
			if (uCode == 0 || (uCode == 1 && strings.TrimSpace(uDiff) != "") || uErr == nil) && strings.TrimSpace(uDiff) != "" {
				normalized := normalizeUntrackedPatch(uDiff, filePath)
				filePatch = normalized
				patchParts = append(patchParts, strings.TrimRight(normalized, "\n")+"\n")
			}
		}

		adds, dels := countPatchStats(filePatch)
		resp.Files = append(resp.Files, ChangedFile{
			Path:      filePath,
			Status:    stCode,
			Additions: adds,
			Deletions: dels,
			Patch:     filePatch,
		})
	}

	resp.FullPatch = strings.Join(patchParts, "")
	return resp, nil
}

func normalizeUntrackedPatch(diffText, relPath string) string {
	lines := strings.Split(diffText, "\n")
	for i, l := range lines {
		if strings.HasPrefix(l, "diff --git ") {
			lines[i] = fmt.Sprintf("diff --git a/%s b/%s", relPath, relPath)
		} else if strings.HasPrefix(l, "+++ b/") || strings.HasPrefix(l, "+++ ") {
			if !strings.HasPrefix(l, "+++ /dev/null") {
				lines[i] = "+++ b/" + relPath
			}
		}
	}
	return strings.Join(lines, "\n")
}

func splitGitDiffByFile(diffText string) map[string]string {
	out := map[string]string{}
	if strings.TrimSpace(diffText) == "" {
		return out
	}
	var curPath string
	var curLines []string
	flush := func() {
		if curPath != "" && len(curLines) > 0 {
			out[curPath] = strings.Join(curLines, "\n")
		}
	}
	for _, line := range strings.Split(diffText, "\n") {
		if strings.HasPrefix(line, "diff --git ") {
			flush()
			curLines = []string{line}
			curPath = ""
			parts := strings.Fields(line)
			if len(parts) >= 4 {
				curPath = strings.TrimPrefix(parts[3], "b/")
			}
			continue
		}
		if curLines != nil {
			curLines = append(curLines, line)
		}
	}
	flush()
	return out
}

func countPatchStats(patch string) (additions, deletions int) {
	for _, l := range strings.Split(patch, "\n") {
		if strings.HasPrefix(l, "+++") || strings.HasPrefix(l, "---") {
			continue
		}
		if strings.HasPrefix(l, "+") {
			additions++
		} else if strings.HasPrefix(l, "-") {
			deletions++
		}
	}
	return additions, deletions
}

func (s *Server) handleTaskChanges(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	kubeCtx := strings.TrimSpace(q.Get("context"))
	atespace := strings.TrimSpace(q.Get("atespace"))
	taskName := strings.TrimSpace(q.Get("task"))
	if strings.HasPrefix(kubeCtx, "-") {
		writeError(w, http.StatusBadRequest, "invalid context")
		return
	}

	changes, err := s.collectTaskChanges(r.Context(), kubeCtx, atespace, taskName)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, changes)
}

type discardFileRequest struct {
	Context  string `json:"context"`
	Atespace string `json:"atespace"`
	Task     string `json:"task"`
	Path     string `json:"path"`
}

func (s *Server) handleDiscardFile(w http.ResponseWriter, r *http.Request) {
	var req discardFileRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := kube.ValidateName(req.Task); err != nil {
		writeError(w, http.StatusBadRequest, "invalid task name")
		return
	}
	if err := validateRelativeSandboxPath(req.Path); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.HasPrefix(req.Context, "-") {
		writeError(w, http.StatusBadRequest, "invalid context")
		return
	}
	if s.guestExec == nil {
		writeError(w, http.StatusServiceUnavailable, "guest execution unavailable")
		return
	}

	atespace := nonEmptyStr(strings.TrimSpace(req.Atespace), v1alpha1.DefaultAtespace)
	client, conn, err := s.dialAXForContext(r.Context(), req.Context)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer conn.Close()

	task, err := client.GetTask(r.Context(), &v1alpha1.GetTaskRequest{Atespace: atespace, Name: req.Task})
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	if !task.GetSpec().GetDebug() || task.GetStatus().GetActor() == "" {
		writeError(w, http.StatusConflict, "task sandbox does not expose debug guest services")
		return
	}
	var ws *v1alpha1.Workspace
	if wsName := task.GetSpec().GetWorkspace().GetName(); wsName != "" {
		ws, _ = client.GetWorkspace(r.Context(), &v1alpha1.GetWorkspaceRequest{Atespace: atespace, Name: wsName})
	}
	repoDir := s.locateSandboxGitDir(r.Context(), req.Context, atespace, task, ws)
	if repoDir == "" {
		writeError(w, http.StatusNotFound, "no git repository found in sandbox")
		return
	}

	_, _, lsCode, _ := s.guestExec(r.Context(), atespace, req.Task, req.Context, s.axNamespace, []string{"git", "ls-files", "--error-unmatch", "--", req.Path}, repoDir)
	if lsCode == 0 {
		if _, stderr, code, exErr := s.guestExec(r.Context(), atespace, req.Task, req.Context, s.axNamespace, []string{"git", "checkout", "HEAD", "--", req.Path}, repoDir); exErr != nil || code != 0 {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("discarding tracked file failed: %s", strings.TrimSpace(stderr)))
			return
		}
	} else {
		if _, stderr, code, exErr := s.guestExec(r.Context(), atespace, req.Task, req.Context, s.axNamespace, []string{"git", "clean", "-f", "--", req.Path}, repoDir); exErr != nil || code != 0 {
			writeError(w, http.StatusBadGateway, fmt.Sprintf("removing untracked file failed: %s", strings.TrimSpace(stderr)))
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"discarded": req.Path})
}

type applyLocalRequest struct {
	Context       string `json:"context"`
	Atespace      string `json:"atespace"`
	Task          string `json:"task"`
	LocalRepoPath string `json:"localRepoPath"`
}

func (s *Server) handleApplyLocal(w http.ResponseWriter, r *http.Request) {
	var req applyLocalRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.HasPrefix(req.Context, "-") {
		writeError(w, http.StatusBadRequest, "invalid context")
		return
	}
	repoPath, err := validateLocalGitRepoDir(req.LocalRepoPath)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	changes, err := s.collectTaskChanges(r.Context(), req.Context, req.Atespace, req.Task)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if !changes.Available {
		writeError(w, http.StatusConflict, changes.Reason)
		return
	}
	if strings.TrimSpace(changes.FullPatch) == "" {
		writeError(w, http.StatusBadRequest, "no uncommitted changes to apply")
		return
	}

	gitBin, err := s.runner.LookPath("git")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "git CLI not found on host")
		return
	}

	checkRes, checkErr := s.runner.Run(r.Context(), kube.Spec{
		Name:  gitBin,
		Args:  []string{"-C", repoPath, "apply", "--check", "--whitespace=nowarn", "-"},
		Stdin: strings.NewReader(changes.FullPatch),
	})
	if checkErr != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"applied":  false,
			"conflict": true,
			"detail":   strings.TrimSpace(checkRes.Stderr),
		})
		return
	}

	applyRes, applyErr := s.runner.Run(r.Context(), kube.Spec{
		Name:  gitBin,
		Args:  []string{"-C", repoPath, "apply", "--whitespace=nowarn", "-"},
		Stdin: strings.NewReader(changes.FullPatch),
	})
	if applyErr != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("git apply failed: %s", strings.TrimSpace(applyRes.Stderr)))
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"applied":       true,
		"conflict":      false,
		"filesApplied":  len(changes.Files),
		"localRepoPath": repoPath,
	})
}

type pushBranchAPIRequest struct {
	Context       string `json:"context"`
	Atespace      string `json:"atespace"`
	Task          string `json:"task"`
	Branch        string `json:"branch"`
	CommitMessage string `json:"commitMessage"`
}

func (s *Server) handlePushBranch(w http.ResponseWriter, r *http.Request) {
	var req pushBranchAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.HasPrefix(req.Context, "-") {
		writeError(w, http.StatusBadRequest, "invalid context")
		return
	}
	if err := kube.ValidateName(req.Task); err != nil {
		writeError(w, http.StatusBadRequest, "invalid task name")
		return
	}

	res, err := s.pushSandboxBranch(r.Context(), req.Context, req.Atespace, req.Task, req.Branch, req.CommitMessage)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// --- Strictly Allow-Listed CLI Execution Bridge (/api/ax/exec) ---

type execAPIRequest struct {
	Program string   `json:"program"`
	Args    []string `json:"args"`
	Stdin   string   `json:"stdin"`
}

// allowedAXSubcommands are the ax subcommands the web UI runs through the exec
// bridge. Cluster setup (ax local, ax install) has its own endpoints, which
// stream progress.
var allowedAXSubcommands = map[string]bool{
	"version": true,
	"ctx":     true,
	"get":     true,
	"apply":   true,
	"delete":  true,
	"suspend": true,
	"resume":  true,
	"promote": true,
}

// validateAXArgs checks an ax command line from the browser and returns its
// subcommand.
func validateAXArgs(args []string) (string, error) {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--context" || a == "-a" || a == "--atespace" || a == "-n" || a == "--namespace" || a == "--server" {
			i++
			continue
		}
		if strings.HasPrefix(a, "--context=") || strings.HasPrefix(a, "--atespace=") || strings.HasPrefix(a, "--namespace=") || strings.HasPrefix(a, "--server=") || a == "--trace" {
			continue
		}
		if strings.HasPrefix(a, "-") {
			return "", fmt.Errorf("disallowed global flag %q", a)
		}
		if !allowedAXSubcommands[a] {
			return "", fmt.Errorf("subcommand %q is not permitted via Studio exec bridge", a)
		}
		// Reject local file reads via `apply -f <path>`; only stdin `-f -` is allowed from browser.
		if a == "apply" {
			for j := i + 1; j < len(args); j++ {
				if (args[j] == "-f" || args[j] == "--file") && j+1 < len(args) && args[j+1] != "-" {
					return "", errors.New("browser apply only supports stdin (-f -)")
				}
			}
		}
		return a, nil
	}
	return "", errors.New("missing ax subcommand")
}

func (s *Server) handleAXExec(w http.ResponseWriter, r *http.Request) {
	var req execAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// ax is the only program the web UI runs.
	if base := filepath.Base(strings.TrimSpace(req.Program)); base != "ax" && base != filepath.Base(s.axBinary) {
		writeError(w, http.StatusForbidden, fmt.Sprintf("program %q is not in Studio allow-list", base))
		return
	}
	subcommand, err := validateAXArgs(req.Args)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	timeout := 90 * time.Second
	if subcommand == "promote" {
		// ax promote waits for the workspace to be set up on the target and
		// for the task to resume there.
		timeout = 11 * time.Minute
	}
	c, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()

	var stdin io.Reader
	if req.Stdin != "" {
		stdin = strings.NewReader(req.Stdin)
	}
	res, runErr := s.runner.Run(c, kube.Spec{
		Name:  s.axBinary,
		Args:  append([]string{"-n", s.axNamespace}, req.Args...),
		Stdin: stdin,
	})
	exitStatus := res.ExitCode
	if runErr != nil && exitStatus == 0 {
		exitStatus = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": exitStatus,
		"stdout": res.Stdout,
		"stderr": res.Stderr,
	})
}

// --- Interactive Terminal Session Manager (`ax ssh` only) ---

type liveSession struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser
	mu    sync.Mutex
}

type startSessionAPIRequest struct {
	ID   string   `json:"id"`
	Args []string `json:"args"`
}

func validateSSHSessionArgs(args []string) error {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--context" || a == "-a" || a == "--atespace" || a == "-n" || a == "--namespace" {
			i++
			continue
		}
		if strings.HasPrefix(a, "--context=") || strings.HasPrefix(a, "--atespace=") || strings.HasPrefix(a, "--namespace=") {
			continue
		}
		if a == "ssh" {
			if i+1 >= len(args) || strings.HasPrefix(args[i+1], "-") {
				return errors.New("missing task name for ssh session")
			}
			return kube.ValidateName(args[i+1])
		}
		return fmt.Errorf("session bridge only permits 'ax ssh', got %q", a)
	}
	return errors.New("missing ssh subcommand")
}

func (s *Server) handleSessionStart(w http.ResponseWriter, r *http.Request) {
	var req startSessionAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.ID) == "" || len(req.ID) > 64 {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	if err := validateSSHSessionArgs(req.Args); err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}

	s.sessMu.Lock()
	if prev, ok := s.sessions[req.ID]; ok {
		_ = prev.stdin.Close()
		if prev.cmd.Process != nil {
			_ = prev.cmd.Process.Kill()
		}
		delete(s.sessions, req.ID)
	}
	s.sessMu.Unlock()

	cmd := exec.Command(s.axBinary, append([]string{"-n", s.axNamespace}, req.Args...)...)
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to allocate session stdin")
		return
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to allocate session stdout")
		return
	}
	stderrPipe, err := cmd.StderrPipe()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to allocate session stderr")
		return
	}
	if err := cmd.Start(); err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("starting ax ssh failed: %v", err))
		return
	}

	sess := &liveSession{cmd: cmd, stdin: stdinPipe}
	s.sessMu.Lock()
	s.sessions[req.ID] = sess
	s.sessMu.Unlock()

	pump := func(rc io.ReadCloser, stream string) {
		buf := make([]byte, 4096)
		for {
			n, readErr := rc.Read(buf)
			if n > 0 {
				s.hub.Publish("sessionData", map[string]any{
					"id":     req.ID,
					"data":   string(buf[:n]),
					"stream": stream,
				})
			}
			if readErr != nil {
				return
			}
		}
	}
	go pump(stdoutPipe, "stdout")
	go pump(stderrPipe, "stderr")
	go func() {
		waitErr := cmd.Wait()
		code := 0
		if waitErr != nil {
			var exitErr *exec.ExitError
			if errors.As(waitErr, &exitErr) {
				code = exitErr.ExitCode()
			} else {
				code = 1
			}
		}
		s.sessMu.Lock()
		if cur, ok := s.sessions[req.ID]; ok && cur == sess {
			delete(s.sessions, req.ID)
		}
		s.sessMu.Unlock()
		s.hub.Publish("sessionExit", map[string]any{
			"id":     req.ID,
			"status": code,
		})
	}()

	writeJSON(w, http.StatusOK, map[string]any{"id": req.ID})
}

type sessionInputAPIRequest struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}

func (s *Server) handleSessionWrite(w http.ResponseWriter, r *http.Request) {
	var req sessionInputAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.sessMu.Lock()
	sess := s.sessions[req.ID]
	s.sessMu.Unlock()
	if sess == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	sess.mu.Lock()
	_, err := io.WriteString(sess.stdin, req.Data)
	sess.mu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, "session stdin closed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSessionInterrupt(w http.ResponseWriter, r *http.Request) {
	var req sessionInputAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.sessMu.Lock()
	sess := s.sessions[req.ID]
	s.sessMu.Unlock()
	if sess != nil && sess.cmd.Process != nil {
		_ = sess.cmd.Process.Signal(syscall.SIGINT)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSessionEOF(w http.ResponseWriter, r *http.Request) {
	var req sessionInputAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.sessMu.Lock()
	sess := s.sessions[req.ID]
	s.sessMu.Unlock()
	if sess != nil {
		sess.mu.Lock()
		_ = sess.stdin.Close()
		sess.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleSessionClose(w http.ResponseWriter, r *http.Request) {
	var req sessionInputAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.sessMu.Lock()
	sess := s.sessions[req.ID]
	delete(s.sessions, req.ID)
	s.sessMu.Unlock()
	if sess != nil {
		sess.mu.Lock()
		_ = sess.stdin.Close()
		sess.mu.Unlock()
		if sess.cmd.Process != nil {
			_ = sess.cmd.Process.Kill()
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
