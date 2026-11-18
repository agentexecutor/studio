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
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
)

const (
	recommendedDiskBytes uint64 = 15 * 1024 * 1024 * 1024 // 15 GiB
	minDiskBytes         uint64 = 8 * 1024 * 1024 * 1024  // 8 GiB
)

var (
	secretKeyRe     = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)
	redactTokenLine = regexp.MustCompile(`(?i)(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*\S+`)
)

// PreflightItem represents a single check of the local host before a local cluster is set up.
type PreflightItem struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Status  string `json:"status"` // "ok" | "warn" | "fail"
	Detail  string `json:"detail"`
	Command string `json:"command,omitempty"`
}

// ContextSummary describes a kubeconfig context visible to AX Studio.
type ContextSummary struct {
	Name    string `json:"name"`
	Cluster string `json:"cluster"`
	Current bool   `json:"current"`
	IsLocal bool   `json:"isLocal"`
}

// LocalClusterInfo summarizes the local Kind + Substrate + AX environment.
type LocalClusterInfo struct {
	Name            string `json:"name"`
	State           string `json:"state"`
	KubeContext     string `json:"kubeContext"`
	SubstrateStatus string `json:"substrateStatus"`
	AXStatus        string `json:"axStatus"`
}

// EnvOpSnapshot reports an active or completed environment operation.
type EnvOpSnapshot struct {
	ID       string   `json:"id"`
	Action   string   `json:"action"` // "local-up" | "local-stop" | "local-delete" | "remote-install"
	Target   string   `json:"target"`
	Stage    string   `json:"stage,omitempty"` // "kind" | "substrate" | "workers" | "ax"
	Status   string   `json:"status"`          // "running" | "ok" | "failed"
	Error    string   `json:"error,omitempty"`
	Logs     []string `json:"logs,omitempty"`
	Started  int64    `json:"started"`
	Finished int64    `json:"finished,omitempty"`
}

// EnvStatusResponse is returned by GET /api/env/status.
type EnvStatusResponse struct {
	OS                string           `json:"os"`
	Arch              string           `json:"arch"`
	FreeDiskBytes     uint64           `json:"freeDiskBytes"`
	ContainerRuntime  string           `json:"containerRuntime"`
	ContainerKernel   string           `json:"containerKernel"`
	ContainerMemBytes int64            `json:"containerMemBytes"`
	ContainerRootless bool             `json:"containerRootless"`
	CanStartLocal     bool             `json:"canStartLocal"`
	ServerImageEnv    string           `json:"serverImageEnv,omitempty"`
	DefaultTaskImgEnv string           `json:"defaultTaskImageEnv,omitempty"`
	Preflight         []PreflightItem  `json:"preflight"`
	Local             LocalClusterInfo `json:"local"`
	Contexts          []ContextSummary `json:"contexts"`
	CurrentContext    string           `json:"currentContext"`
	Operation         *EnvOpSnapshot   `json:"operation,omitempty"`
}

// hasContainerCLI reports whether a docker or podman command is on PATH,
// running or not.
func (s *Server) hasContainerCLI() bool {
	for _, name := range []string{"docker", "podman"} {
		if _, err := s.runner.LookPath(name); err == nil {
			return true
		}
	}
	return false
}

func freeDiskSpaceBytes(dir string) uint64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil || st.Bsize <= 0 {
		return 0
	}
	return uint64(st.Bavail) * uint64(st.Bsize)
}

func (s *Server) collectEnvStatus(ctx context.Context) EnvStatusResponse {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "."
	}
	diskBytes := freeDiskSpaceBytes(home)

	resp := EnvStatusResponse{
		OS:                runtime.GOOS,
		Arch:              runtime.GOARCH,
		FreeDiskBytes:     diskBytes,
		ServerImageEnv:    strings.TrimSpace(os.Getenv("AX_SERVER_IMAGE")),
		DefaultTaskImgEnv: strings.TrimSpace(os.Getenv("AX_DEFAULT_TASK_IMAGE")),
	}

	// 1. OS & CPU Architecture check.
	resp.Preflight = append(resp.Preflight, PreflightItem{
		ID:     "os_arch",
		Label:  "Operating system & CPU",
		Status: "ok",
		Detail: fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
	})

	// 2. Container Runtime, Kernel & Memory check.
	rt, rtErr := kube.ResolveContainerRuntime(ctx, s.runner)
	if rtErr != nil {
		fixCmd := "sudo systemctl start docker"
		detail := "No running rootful Docker or Podman engine detected."
		if runtime.GOOS == "darwin" {
			fixCmd = "colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs"
			detail = "Start OrbStack, Docker Desktop, or Colima (>= 6 GiB RAM) to run sandboxes locally, or connect directly to a team cluster."
		} else if !s.hasContainerCLI() {
			// There is no engine to start: neither one is installed.
			fixCmd = ""
			detail = "Docker or Podman isn't installed. Install Docker, or Podman in rootful mode, and start it. Or connect directly to a team cluster."
		}
		resp.Preflight = append(resp.Preflight, PreflightItem{
			ID:      "container_engine",
			Label:   "Container runtime & VM",
			Status:  "fail",
			Detail:  detail,
			Command: fixCmd,
		})
	} else {
		engineName := "docker"
		if rt.IsPodman {
			engineName = "podman"
		}
		resp.ContainerRuntime = engineName

		hostInfo, ok := kube.InspectContainerHost(ctx, s.runner, rt)
		if ok {
			resp.ContainerKernel = hostInfo.KernelVersion
			resp.ContainerMemBytes = hostInfo.MemTotalBytes
			resp.ContainerRootless = hostInfo.Rootless
		}
		var warnBuf bytes.Buffer
		valErr := kube.ValidateContainerHost(hostInfo, rt.IsPodman, runtime.GOOS, &warnBuf)
		switch {
		case valErr != nil:
			fixCmd := ""
			if runtime.GOOS == "darwin" {
				fixCmd = "colima stop && colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs"
			}
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:      "container_engine",
				Label:   "Container runtime & VM",
				Status:  "fail",
				Detail:  valErr.Error(),
				Command: fixCmd,
			})
		case warnBuf.Len() > 0:
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:     "container_engine",
				Label:  "Container runtime & VM",
				Status: "warn",
				Detail: strings.TrimSpace(strings.TrimPrefix(warnBuf.String(), "==> Warning: ")),
			})
		default:
			gib := float64(hostInfo.MemTotalBytes) / (1024 * 1024 * 1024)
			detail := fmt.Sprintf("%s ready", engineName)
			if hostInfo.KernelVersion != "" && gib > 0 {
				detail = fmt.Sprintf("%s ready · kernel %s · %.1f GiB RAM", engineName, hostInfo.KernelVersion, gib)
			}
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:     "container_engine",
				Label:  "Container runtime & VM",
				Status: "ok",
				Detail: detail,
			})
		}
	}

	// 3. Free Disk Space check.
	if diskBytes > 0 {
		gib := float64(diskBytes) / (1024 * 1024 * 1024)
		switch {
		case diskBytes < minDiskBytes:
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:     "disk_space",
				Label:  "Available disk space",
				Status: "fail",
				Detail: fmt.Sprintf("%.1f GiB free (< 8 GiB minimum required for Kind + Substrate images)", gib),
			})
		case diskBytes < recommendedDiskBytes:
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:     "disk_space",
				Label:  "Available disk space",
				Status: "warn",
				Detail: fmt.Sprintf("%.1f GiB free (15+ GiB recommended)", gib),
			})
		default:
			resp.Preflight = append(resp.Preflight, PreflightItem{
				ID:     "disk_space",
				Label:  "Available disk space",
				Status: "ok",
				Detail: fmt.Sprintf("%.1f GiB free", gib),
			})
		}
	}

	canStart := true
	for _, p := range resp.Preflight {
		if p.Status == "fail" {
			canStart = false
			break
		}
	}
	resp.CanStartLocal = canStart

	// Local cluster status (fast check when container runtime is up).
	resp.Local = LocalClusterInfo{
		Name:            "N/A",
		State:           kube.StateNotFound,
		KubeContext:     "N/A",
		SubstrateStatus: "N/A",
		AXStatus:        "N/A",
	}
	if resp.ContainerRuntime != "" {
		stCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		st := kube.InspectLocalCluster(stCtx, s.runner, rt, kube.DefaultLocalClusterName, s.axNamespace)
		cancel()
		resp.Local = LocalClusterInfo{
			Name:            st.Name,
			State:           st.State,
			KubeContext:     st.KubeContext,
			SubstrateStatus: st.SubstrateStatus,
			AXStatus:        st.AXStatus,
		}
	}

	// Kubeconfig contexts.
	curCtx, _ := kube.CurrentContext("")
	resp.CurrentContext = curCtx
	if entries, err := kube.ListContexts(""); err == nil {
		for _, e := range entries {
			resp.Contexts = append(resp.Contexts, ContextSummary{
				Name:    e.Name,
				Cluster: e.Cluster,
				Current: e.Current,
				IsLocal: e.Name == "ax-local" || e.Name == "local" || strings.HasPrefix(e.Name, "kind-"),
			})
		}
	}

	s.opMu.Lock()
	if s.currentOp != nil {
		if s.currentOp.Action == "local-up" && s.currentOp.Status == "failed" &&
			resp.Local.State == kube.StateRunning &&
			strings.Contains(resp.Local.SubstrateStatus, "available") &&
			strings.Contains(resp.Local.AXStatus, "available") {
			s.currentOp = nil
		} else {
			cp := *s.currentOp
			cp.Logs = append([]string(nil), s.currentOp.Logs...)
			resp.Operation = &cp
		}
	}
	s.opMu.Unlock()

	return resp
}

func (s *Server) handleEnvStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, s.collectEnvStatus(r.Context()))
}

type localActionRequest struct {
	Name              string `json:"name"`
	Workers           int    `json:"workers"`
	ServerImage       string `json:"serverImage"`
	DefaultTaskImage  string `json:"defaultTaskImage"`
	RunnerVolumeImage string `json:"runnerVolumeImage"`
}

func validateOptionalFlagImage(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", nil
	}
	if strings.HasPrefix(s, "-") || strings.ContainsAny(s, " \t\r\n") {
		return "", fmt.Errorf("invalid image reference %q", s)
	}
	return s, nil
}

func (s *Server) handleLocalUp(w http.ResponseWriter, r *http.Request) {
	var req localActionRequest
	_ = decodeJSONBody(r, &req)
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = kube.DefaultLocalClusterName
	}
	if err := kube.ValidateName(name); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid cluster name: %v", err))
		return
	}
	srvImg, err := validateOptionalFlagImage(req.ServerImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	taskImg, err := validateOptionalFlagImage(req.DefaultTaskImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	runnerImg, err := validateOptionalFlagImage(req.RunnerVolumeImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	workers := req.Workers
	if workers <= 0 {
		workers = 1
	}
	if workers > 8 {
		workers = 8
	}

	args := []string{"-n", s.axNamespace, "local", "start", "--name", name, "--workers", strconv.Itoa(workers)}
	if srvImg != "" {
		args = append(args, "--server-image", srvImg)
	}
	if taskImg != "" {
		args = append(args, "--default-task-image", taskImg)
	}
	if runnerImg != "" {
		args = append(args, "--runner-volume-image", runnerImg)
	}

	s.runAXOperation(w, "local-up", name, "kind", args)
}

// runAXOperation starts `ax <args>` as the environment operation action on
// target, streaming its output to the UI, and responds with the operation.
func (s *Server) runAXOperation(w http.ResponseWriter, action, target, stage string, args []string) {
	snap, err := s.startEnvOperation(action, target, stage, func(opCtx context.Context, logWriter *opLogWriter) error {
		res, runErr := s.runner.Run(opCtx, kube.Spec{
			Name:   s.axBinary,
			Args:   args,
			Stdout: logWriter,
			Stderr: logWriter,
		})
		if runErr != nil && action == "local-up" && strings.Contains(res.Stdout+res.Stderr, "nodes is forbidden") {
			_, _ = logWriter.Write([]byte("==> Waiting for Kubernetes API server RBAC warm-up and retrying...\n"))
			select {
			case <-time.After(2 * time.Second):
			case <-opCtx.Done():
				return opCtx.Err()
			}
			_, runErr = s.runner.Run(opCtx, kube.Spec{
				Name:   s.axBinary,
				Args:   args,
				Stdout: logWriter,
				Stderr: logWriter,
			})
		}
		return runErr
	})
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, snap)
}

// handleLocalAction serves `ax local <subcmd>` (stop or delete) for the named
// local cluster.
func (s *Server) handleLocalAction(subcmd string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req localActionRequest
		_ = decodeJSONBody(r, &req)
		name := strings.TrimSpace(req.Name)
		if name == "" {
			name = kube.DefaultLocalClusterName
		}
		if err := kube.ValidateName(name); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid cluster name: %v", err))
			return
		}
		s.runAXOperation(w, "local-"+subcmd, name, "", []string{"-n", s.axNamespace, "local", subcmd, "--name", name})
	}
}

type remoteInstallRequest struct {
	Context           string `json:"context"`
	ServerImage       string `json:"serverImage"`
	DefaultTaskImage  string `json:"defaultTaskImage"`
	RunnerVolumeImage string `json:"runnerVolumeImage"`
}

func (s *Server) handleRemoteInstall(w http.ResponseWriter, r *http.Request) {
	var req remoteInstallRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	targetCtx := strings.TrimSpace(req.Context)
	if targetCtx == "" || strings.HasPrefix(targetCtx, "-") {
		writeError(w, http.StatusBadRequest, "valid Kubernetes context is required")
		return
	}
	srvImg, err := validateOptionalFlagImage(req.ServerImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	taskImg, err := validateOptionalFlagImage(req.DefaultTaskImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	runnerImg, err := validateOptionalFlagImage(req.RunnerVolumeImage)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	args := []string{"--context", targetCtx, "-n", s.axNamespace, "install"}
	if srvImg != "" {
		args = append(args, "--server-image", srvImg)
	}
	if taskImg != "" {
		args = append(args, "--default-task-image", taskImg)
	}
	if runnerImg != "" {
		args = append(args, "--runner-volume-image", runnerImg)
	}

	s.runAXOperation(w, "remote-install", targetCtx, "ax", args)
}

type selectContextRequest struct {
	Context string `json:"context"`
}

func (s *Server) handleSelectContext(w http.ResponseWriter, r *http.Request) {
	var req selectContextRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ctxName := strings.TrimSpace(req.Context)
	if ctxName == "" || strings.HasPrefix(ctxName, "-") {
		writeError(w, http.StatusBadRequest, "valid context name is required")
		return
	}
	// `ax ctx <name>` owns switching the kubeconfig context.
	if res, err := s.runner.Run(r.Context(), kube.Spec{Name: s.axBinary, Args: []string{"ctx", ctxName}}); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("switching context: %s", nonEmptyStr(strings.TrimSpace(res.Stderr), err.Error())))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"context": ctxName})
}

type credentialSecretRequest struct {
	Context   string `json:"context"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	Key       string `json:"key"`
	Value     string `json:"value"`
}

func (s *Server) handleCreateCredentialSecret(w http.ResponseWriter, r *http.Request) {
	var req credentialSecretRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := kube.ValidateName(req.Name); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid secret name: %v", err))
		return
	}
	ns := strings.TrimSpace(req.Namespace)
	if ns == "" {
		ns = s.axNamespace
	}
	if err := kube.ValidateName(ns); err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid namespace: %v", err))
		return
	}
	if !secretKeyRe.MatchString(req.Key) {
		writeError(w, http.StatusBadRequest, "invalid secret key name")
		return
	}
	if req.Value == "" {
		writeError(w, http.StatusBadRequest, "credential value cannot be empty")
		return
	}
	if req.Context != "" && strings.HasPrefix(req.Context, "-") {
		writeError(w, http.StatusBadRequest, "invalid context name")
		return
	}

	kubectlBin, err := kube.ResolveKubectl(s.runner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "kubectl is not available")
		return
	}

	// Render Secret YAML client-side reading value from stdin so the secret
	// never appears in process argv or temporary files.
	ctxArgs := []string{}
	if req.Context != "" {
		ctxArgs = []string{"--context", req.Context}
	}
	genArgs := append([]string{}, ctxArgs...)
	genArgs = append(genArgs,
		"-n", ns,
		"create", "secret", "generic", req.Name,
		"--from-file="+req.Key+"=/dev/stdin",
		"--dry-run=client", "-o", "json",
	)
	genRes, err := s.runner.Run(r.Context(), kube.Spec{
		Name:  kubectlBin,
		Args:  genArgs,
		Stdin: strings.NewReader(req.Value),
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to prepare credential secret manifest")
		return
	}

	// Inject ax.io/credential: "true" label into metadata before applying.
	var secretObj map[string]any
	if err := json.Unmarshal([]byte(genRes.Stdout), &secretObj); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to encode credential secret manifest")
		return
	}
	meta, _ := secretObj["metadata"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
		secretObj["metadata"] = meta
	}
	labels, _ := meta["labels"].(map[string]any)
	if labels == nil {
		labels = map[string]any{}
		meta["labels"] = labels
	}
	labels["ax.io/credential"] = "true"

	labeledJSON, err := json.Marshal(secretObj)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to marshal credential secret manifest")
		return
	}

	applyArgs := append([]string{}, ctxArgs...)
	applyArgs = append(applyArgs, "-n", ns, "apply", "-f", "-")
	if _, err := s.runner.Run(r.Context(), kube.Spec{
		Name:  kubectlBin,
		Args:  applyArgs,
		Stdin: bytes.NewReader(labeledJSON),
	}); err != nil {
		writeError(w, http.StatusBadGateway, "failed to apply credential secret to cluster")
		return
	}

	uri := fmt.Sprintf("ate-secret://k8s.io/default/%s/%s/%s", ns, req.Name, req.Key)
	writeJSON(w, http.StatusOK, map[string]any{
		"namespace":     ns,
		"name":          req.Name,
		"key":           req.Key,
		"credentialUri": uri,
	})
}

func (s *Server) handleDiagnostics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	kubeCtx := strings.TrimSpace(r.URL.Query().Get("context"))
	if strings.HasPrefix(kubeCtx, "-") {
		writeError(w, http.StatusBadRequest, "invalid context parameter")
		return
	}

	env := s.collectEnvStatus(r.Context())
	var b strings.Builder
	fmt.Fprintf(&b, "=== AX Studio Diagnostics (Secrets Redacted) ===\n")
	fmt.Fprintf(&b, "Timestamp: %s\n", time.Now().UTC().Format(time.RFC3339))
	fmt.Fprintf(&b, "Host: %s/%s\n", env.OS, env.Arch)
	fmt.Fprintf(&b, "Container Runtime: %s (kernel=%s, rootless=%v, memBytes=%d)\n",
		nonEmptyStr(env.ContainerRuntime, "none"), env.ContainerKernel, env.ContainerRootless, env.ContainerMemBytes)
	fmt.Fprintf(&b, "Free Disk Bytes: %d\n", env.FreeDiskBytes)
	fmt.Fprintf(&b, "Active Context: %s\n", nonEmptyStr(kubeCtx, env.CurrentContext))
	fmt.Fprintf(&b, "Local Cluster: state=%s substrate=%q ax=%q\n\n",
		env.Local.State, env.Local.SubstrateStatus, env.Local.AXStatus)

	fmt.Fprintf(&b, "--- Preflight Checks ---\n")
	for _, p := range env.Preflight {
		fmt.Fprintf(&b, "[%s] %s: %s\n", strings.ToUpper(p.Status), p.Label, p.Detail)
	}

	if kubectlBin, err := kube.ResolveKubectl(s.runner); err == nil && kubectlBin != "" {
		targetCtx := nonEmptyStr(kubeCtx, env.CurrentContext)
		ctxPrefix := []string{"--request-timeout=5s"}
		if targetCtx != "" {
			ctxPrefix = append([]string{"--context", targetCtx}, ctxPrefix...)
		}
		for _, ns := range []string{"ate-system", nonEmptyStr(s.axNamespace, v1alpha1.DefaultSystemNamespace)} {
			c, cancel := context.WithTimeout(r.Context(), 6*time.Second)
			res, runErr := s.runner.Run(c, kube.Spec{
				Name: kubectlBin,
				Args: append(append([]string{}, ctxPrefix...), "-n", ns, "get", "pods", "-o", "wide"),
			})
			cancel()
			fmt.Fprintf(&b, "\n--- Pods (%s) ---\n", ns)
			if runErr != nil {
				fmt.Fprintf(&b, "unavailable\n")
			} else {
				b.WriteString(scrubSecrets(res.Stdout))
			}
		}

		axNS := nonEmptyStr(s.axNamespace, v1alpha1.DefaultSystemNamespace)
		c, cancel := context.WithTimeout(r.Context(), 6*time.Second)
		logsRes, logErr := s.runner.Run(c, kube.Spec{
			Name: kubectlBin,
			Args: append(append([]string{}, ctxPrefix...), "-n", axNS, "logs", "deployment/ax-server", "--tail=40"),
		})
		cancel()
		fmt.Fprintf(&b, "\n--- ax-server Recent Logs ---\n")
		if logErr != nil {
			fmt.Fprintf(&b, "unavailable\n")
		} else {
			b.WriteString(scrubSecrets(logsRes.Stdout))
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"diagnostics": b.String(),
	})
}

func scrubSecrets(s string) string {
	return redactTokenLine.ReplaceAllString(s, "$1: [REDACTED]")
}

func nonEmptyStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

type opLogWriter struct {
	srv *Server
	op  string
}

func (w *opLogWriter) Write(p []byte) (int, error) {
	text := string(p)
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		if line == "" {
			continue
		}
		w.srv.appendOpLog(w.op, line)
	}
	return len(p), nil
}

func (s *Server) startEnvOperation(action, target, initialStage string, fn func(context.Context, *opLogWriter) error) (EnvOpSnapshot, error) {
	s.opMu.Lock()
	if s.currentOp != nil && s.currentOp.Status == "running" {
		busy := fmt.Errorf("operation %q on %q is already running", s.currentOp.Action, s.currentOp.Target)
		s.opMu.Unlock()
		return EnvOpSnapshot{}, busy
	}
	opID := fmt.Sprintf("op-%d", time.Now().UnixNano())
	snap := &EnvOpSnapshot{
		ID:      opID,
		Action:  action,
		Target:  target,
		Stage:   initialStage,
		Status:  "running",
		Started: time.Now().UnixMilli(),
	}
	s.currentOp = snap
	cp := *snap
	s.opMu.Unlock()

	s.hub.Publish("envOp", cp)

	s.opWg.Add(1)
	go func() {
		defer s.opWg.Done()
		parentCtx := s.shutdownCtx
		if parentCtx == nil {
			parentCtx = context.Background()
		}
		opCtx, cancel := context.WithTimeout(parentCtx, 20*time.Minute)
		defer cancel()
		lw := &opLogWriter{srv: s, op: opID}
		err := fn(opCtx, lw)

		s.opMu.Lock()
		if s.currentOp != nil && s.currentOp.ID == opID {
			s.currentOp.Finished = time.Now().UnixMilli()
			if err != nil {
				s.currentOp.Status = "failed"
				s.currentOp.Error = err.Error()
			} else {
				s.currentOp.Status = "ok"
			}
			doneSnap := *s.currentOp
			doneSnap.Logs = append([]string(nil), s.currentOp.Logs...)
			s.opMu.Unlock()
			s.hub.Publish("envOp", doneSnap)
			return
		}
		s.opMu.Unlock()
	}()

	return cp, nil
}

func (s *Server) appendOpLog(opID, line string) {
	clean := scrubSecrets(line)
	s.opMu.Lock()
	if s.currentOp == nil || s.currentOp.ID != opID {
		s.opMu.Unlock()
		return
	}
	switch {
	case strings.Contains(clean, "Kind cluster"):
		s.currentOp.Stage = "kind"
	case strings.Contains(clean, "WorkerPool"):
		s.currentOp.Stage = "workers"
	case strings.Contains(clean, "ax-postgres") || strings.Contains(clean, "ax-server") || strings.Contains(clean, "AX is ready") || strings.Contains(clean, "Configuring Agent Substrate permissions"):
		s.currentOp.Stage = "ax"
	case strings.Contains(clean, "Substrate"):
		s.currentOp.Stage = "substrate"
	}
	if len(s.currentOp.Logs) < 2000 {
		s.currentOp.Logs = append(s.currentOp.Logs, clean)
	}
	stage := s.currentOp.Stage
	s.opMu.Unlock()

	s.hub.Publish("streamLine", map[string]any{
		"id":    opID,
		"line":  clean,
		"stage": stage,
	})
}
