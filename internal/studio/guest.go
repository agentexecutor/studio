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
	"regexp"
	"strings"
	"sync"

	axclient "github.com/google/ax/client"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
)

var (
	validBranchRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$`)
	nonLabelChars = regexp.MustCompile(`[^a-z0-9-]+`)
)

// GuestExecFunc executes a non-interactive command inside a task's sandbox actor.
type GuestExecFunc func(ctx context.Context, atespace, taskName, kubeContext, axNamespace string, command []string, cwd string) (stdout, stderr string, exitCode int, err error)

// ServerResolver resolves the address of the ax-server that opts selects. The
// default is the ax client's ServerURL, which shares its port-forwards with
// the ax CLI.
type ServerResolver func(ctx context.Context, opts axclient.Options) (string, error)

// PushBranchResult reports the pushed branch and commit SHA.
type PushBranchResult struct {
	Branch    string `json:"branch"`
	CommitSHA string `json:"commitSha"`
	RepoDir   string `json:"repoDir"`
}

// dialAXForContext returns a client for the ax-server of kubeCtx. The caller
// closes the connection. Cancelling ctx stops the wait for a port-forward that
// is still starting; one that is already up is shared and outlives ctx.
func (s *Server) dialAXForContext(ctx context.Context, kubeCtx string) (v1alpha1.AXClient, *grpc.ClientConn, error) {
	// Resolving may start a port-forward. Requests for the same context take
	// turns, so two of them never start two.
	s.dialMu.Lock()
	lock := s.dialLocks[kubeCtx]
	if lock == nil {
		lock = &sync.Mutex{}
		s.dialLocks[kubeCtx] = lock
	}
	s.dialMu.Unlock()
	lock.Lock()
	serverURL, err := s.resolveServer(ctx, axclient.Options{Context: kubeCtx, Namespace: s.axNamespace})
	lock.Unlock()
	if err != nil {
		return nil, nil, err
	}
	return axclient.Dial(ctx, axclient.Options{ServerURL: serverURL})
}

// validateBranchName verifies that branch is a safe Git ref name without traversal or flags.
func validateBranchName(branch string) error {
	if !validBranchRe.MatchString(branch) || strings.Contains(branch, "..") || strings.Contains(branch, "//") || strings.HasSuffix(branch, "/") || strings.HasSuffix(branch, ".lock") {
		return fmt.Errorf("invalid git branch name %q", branch)
	}
	return nil
}

// suggestedBranchName builds a clean `ax/<task>` branch name from a task name.
func suggestedBranchName(taskName string) string {
	clean := nonLabelChars.ReplaceAllString(strings.ToLower(strings.TrimSpace(taskName)), "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		clean = "handoff"
	}
	return "ax/" + clean
}

// locateSandboxGitDir finds the primary git working tree inside the task's
// workspace, or returns "" when there is none.
func (s *Server) locateSandboxGitDir(ctx context.Context, kubeCtx, atespace string, task *v1alpha1.Task, ws *v1alpha1.Workspace) string {
	wsRoot := task.GetSpec().GetWorkspace().GetPath()
	if wsRoot == "" {
		wsRoot = v1alpha1.DefaultWorkspacePath
	}

	var candidates []string
	for _, g := range ws.GetSpec().GetSetup().GetGit() {
		dir := strings.TrimSpace(g.GetDir())
		switch {
		case dir == "" && g.GetRepo() != "":
			base := strings.TrimSuffix(g.GetRepo(), ".git")
			if idx := strings.LastIndex(base, "/"); idx >= 0 {
				base = base[idx+1:]
			}
			if base != "" && base != "." {
				candidates = append(candidates, wsRoot+"/"+base)
			}
		case dir == ".":
			candidates = append(candidates, wsRoot)
		default:
			candidates = append(candidates, wsRoot+"/"+strings.TrimPrefix(dir, "/"))
		}
	}
	candidates = append(candidates, wsRoot)

	for _, dir := range candidates {
		out, _, code, err := s.guestExec(ctx, atespace, task.GetMetadata().GetName(), kubeCtx, s.axNamespace, []string{"git", "rev-parse", "--show-toplevel"}, dir)
		if err == nil && code == 0 && strings.TrimSpace(out) != "" {
			return strings.TrimSpace(out)
		}
	}
	return ""
}

// pushSandboxBranch commits the uncommitted changes inside a task's sandbox
// and pushes them to origin/<branch>. An empty branch means ax/<task>.
func (s *Server) pushSandboxBranch(ctx context.Context, kubeCtx, atespace, taskName, branch, commitMsg string) (*PushBranchResult, error) {
	if s.guestExec == nil {
		return nil, errors.New("guest execution is not configured")
	}
	if branch = strings.TrimSpace(branch); branch == "" {
		branch = suggestedBranchName(taskName)
	}
	if err := validateBranchName(branch); err != nil {
		return nil, err
	}
	if atespace == "" {
		atespace = v1alpha1.DefaultAtespace
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
	if !task.GetSpec().GetDebug() || task.GetStatus().GetActor() == "" {
		return nil, fmt.Errorf("task %q does not have an active debug-enabled sandbox", taskName)
	}
	var ws *v1alpha1.Workspace
	if wsName := task.GetSpec().GetWorkspace().GetName(); wsName != "" {
		ws, _ = client.GetWorkspace(ctx, &v1alpha1.GetWorkspaceRequest{Atespace: atespace, Name: wsName})
	}

	repoDir := s.locateSandboxGitDir(ctx, kubeCtx, atespace, task, ws)
	if repoDir == "" {
		return nil, fmt.Errorf("no git repository found in sandbox for task %q", taskName)
	}

	// git runs a git command in the sandbox's repository. A non-zero exit is
	// an error that carries git's stderr.
	git := func(args ...string) (string, error) {
		stdout, stderr, code, err := s.guestExec(ctx, atespace, taskName, kubeCtx, s.axNamespace, append([]string{"git"}, args...), repoDir)
		if err == nil && code != 0 {
			err = fmt.Errorf("exit status %d", code)
		}
		if err != nil {
			err = fmt.Errorf("%s: %w", strings.TrimSpace(stderr), err)
		}
		return strings.TrimSpace(stdout), err
	}

	if commitMsg = strings.TrimSpace(commitMsg); commitMsg == "" {
		commitMsg = fmt.Sprintf("chore(ax): checkpoint changes from task %s", taskName)
	}
	for _, identity := range [][2]string{{"user.name", "AX Studio"}, {"user.email", "ax-studio@ax.io"}} {
		if out, _ := git("config", identity[0]); out == "" {
			_, _ = git("config", identity[0], identity[1])
		}
	}

	if _, err := git("checkout", "-B", branch); err != nil {
		return nil, fmt.Errorf("checking out branch %q in sandbox: %w", branch, err)
	}
	if _, err := git("add", "-A"); err != nil {
		return nil, fmt.Errorf("staging files in sandbox: %w", err)
	}
	// Never commit ax-task-runner's internal `.ax/` runtime directory when repoDir == /workspace.
	_, _ = git("reset", "-q", "--", ".ax")

	if staged, _ := git("status", "--porcelain"); staged != "" {
		if _, err := git("commit", "-m", commitMsg); err != nil {
			return nil, fmt.Errorf("committing sandbox changes: %w", err)
		}
	}
	if _, err := git("push", "-u", "origin", branch); err != nil {
		return nil, fmt.Errorf("pushing branch %q to origin (ensure Gateway allows git host and credentials): %w", branch, err)
	}

	sha, _ := git("rev-parse", "--short", "HEAD")
	return &PushBranchResult{Branch: branch, CommitSHA: sha, RepoDir: repoDir}, nil
}
