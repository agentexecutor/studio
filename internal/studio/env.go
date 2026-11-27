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
	axclient "github.com/google/ax/client"
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
	// Access says whether kubectl can look inside a running cluster: "ok",
	// "no-context" or "unreachable". Without it, what's installed is unknown.
	Access string `json:"access"`
}

// EnvOpSnapshot reports an active or completed environment operation.
type EnvOpSnapshot struct {
	ID       string   `json:"id"`
	Action   string   `json:"action"` // "local-up" | "local-stop" | "local-delete" | "remote-install" | "remote-uninstall"
	Target   string   `json:"target"`
	Stage    string   `json:"stage,omitempty"` // "kind" | "substrate" | "workers" | "ax"
	Status   string   `json:"status"`          // "running" | "ok" | "failed"
	Error    string   `json:"error,omitempty"`
	Logs     []string `json:"logs,omitempty"`
	Started  int64    `json:"started"`
	Finished int64    `json:"finished,omitempty"`
	// StageStarted is when each stage began (Unix ms), for the ones that have.
	StageStarted map[string]int64 `json:"stageStarted,omitempty"`
	// Step is the step ax last announced ("==> Deploying ax-server..."), without the arrow.
	Step string `json:"step,omitempty"`
	// Canceled is set when the command was interrupted from the UI.
	Canceled bool `json:"canceled,omitempty"`
	// Purpose is what a local-up was started for ("setup", "start", "update" or
	// "repair"), so every window words it the same way.
	Purpose string `json:"purpose,omitempty"`
	// ExitCode is the command's exit status when it failed with one.
	ExitCode int `json:"exitCode,omitempty"`
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
	Preflight         []PreflightItem  `json:"preflight"`
	Local             LocalClusterInfo `json:"local"`
	Contexts          []ContextSummary `json:"contexts"`
	CurrentContext    string           `json:"currentContext"`
	Operation         *EnvOpSnapshot   `json:"operation,omitempty"`
	// Tools are ax, kubectl and kind as ax will find them.
	Tools []ToolInfo `json:"tools"`
	// AXFlags says which optional flags this ax takes.
	AXFlags AXFlags `json:"axFlags"`
	// SetupImages are the images setup uses unless the request names others.
	SetupImages SetupImages `json:"setupImages"`
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

const (
	// defaultLocalClusterName is the cluster `ax local` manages by default.
	defaultLocalClusterName = "ax-local"
	// stateNotFound is the state `ax local status` reports when there is no local cluster.
	stateNotFound = "NotFound"
	// stateRunning is the state it reports when every node of the cluster runs.
	stateRunning = "Running"
)

// localStatus is the part of `ax local status -o json` that Studio shows.
type localStatus struct {
	LocalClusterInfo
	Host localHost `json:"host"`
}

// localHost is the container engine that runs the local cluster. Error is why
// `ax local start` would refuse it, and Warning a problem that would not stop it.
type localHost struct {
	Runtime       string `json:"runtime"`
	KernelVersion string `json:"kernelVersion"`
	MemTotalBytes int64  `json:"memTotalBytes"`
	Rootless      bool   `json:"rootless"`
	Error         string `json:"error"`
	Warning       string `json:"warning"`
}

// axLocalStatus runs `ax local status -o json`. ax owns the checks of the
// host and of the cluster, so Studio and `ax local start` always agree.
func (s *Server) axLocalStatus(ctx context.Context) (localStatus, error) {
	c, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	res, err := s.runner.Run(c, kube.Spec{
		Name: s.axBinary,
		Args: []string{"-n", s.axNamespace, "local", "status", "-o", "json"},
	})
	if err != nil {
		lines := strings.Split(strings.TrimSpace(res.Stderr), "\n")
		return localStatus{}, fmt.Errorf("%s", nonEmptyStr(strings.TrimSpace(lines[len(lines)-1]), err.Error()))
	}
	var st localStatus
	if err := json.Unmarshal([]byte(res.Stdout), &st); err != nil {
		return localStatus{}, fmt.Errorf("reading the output of ax local status: %w", err)
	}
	return st, nil
}

// containerEnginePreflight turns ax's report of the container host into the
// row the Environments page shows. statusErr is why the report could not be read.
func containerEnginePreflight(host localHost, statusErr error) PreflightItem {
	item := PreflightItem{ID: "container_engine", Label: "Container runtime & VM"}
	switch {
	case statusErr != nil:
		// Not a reason to block a start: an older ax has no JSON status.
		item.Status = "warn"
		item.Detail = fmt.Sprintf("Could not check the container host with `ax local status -o json`: %v", statusErr)
	case host.Error != "" || host.Runtime == "":
		item.Status = "fail"
		item.Detail = nonEmptyStr(host.Error, "No running container engine found.")
		if host.Runtime != "" && runtime.GOOS == "darwin" {
			item.Command = "colima stop && colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs"
		}
	case host.Warning != "":
		item.Status = "warn"
		item.Detail = host.Warning
	default:
		item.Status = "ok"
		item.Detail = host.Runtime + " ready"
		if gib := float64(host.MemTotalBytes) / (1024 * 1024 * 1024); host.KernelVersion != "" && gib > 0 {
			item.Detail = fmt.Sprintf("%s ready · kernel %s · %.1f GiB RAM", host.Runtime, host.KernelVersion, gib)
		}
	}
	return item
}

func freeDiskSpaceBytes(dir string) uint64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(dir, &st); err != nil || st.Bsize <= 0 {
		return 0
	}
	return uint64(st.Bavail) * uint64(st.Bsize)
}

func (s *Server) collectEnvStatus(ctx context.Context) EnvStatusResponse {
	return s.collectEnvStatusFresh(ctx, false)
}

// collectEnvStatusFresh checks this computer and the kubeconfig. fresh asks
// for the tools' versions again rather than the ones kept for a minute.
func (s *Server) collectEnvStatusFresh(ctx context.Context, fresh bool) EnvStatusResponse {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = "."
	}
	diskBytes := freeDiskSpaceBytes(home)

	resp := EnvStatusResponse{
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		FreeDiskBytes:  diskBytes,
		ServerImageEnv: strings.TrimSpace(os.Getenv("AX_SERVER_IMAGE")),
	}

	// 1. OS & CPU Architecture check.
	resp.Preflight = append(resp.Preflight, PreflightItem{
		ID:     "os_arch",
		Label:  "Operating system & CPU",
		Status: "ok",
		Detail: fmt.Sprintf("%s/%s", runtime.GOOS, runtime.GOARCH),
	})

	// 2. Container runtime, kernel and memory, and the local cluster, as
	// `ax local status` reports them.
	resp.Local = LocalClusterInfo{
		Name:            "N/A",
		State:           stateNotFound,
		KubeContext:     "N/A",
		SubstrateStatus: "N/A",
		AXStatus:        "N/A",
	}
	local, localErr := s.axLocalStatus(ctx)
	if localErr == nil {
		resp.Local = local.LocalClusterInfo
		resp.ContainerRuntime = local.Host.Runtime
		resp.ContainerKernel = local.Host.KernelVersion
		resp.ContainerMemBytes = local.Host.MemTotalBytes
		resp.ContainerRootless = local.Host.Rootless
	}
	engine := containerEnginePreflight(local.Host, localErr)
	if localErr == nil && local.Host.Runtime == "" {
		// No engine is running. Say what this computer has to start one with.
		if runtime.GOOS == "darwin" {
			// macOS runs containers in a Linux VM that one of a few apps provides: say which are installed, and how to start one.
			engine.Detail, engine.Command = s.macVMAdvice()
		} else if !s.hasContainerCLI() {
			// There is no engine to start: neither one is installed.
			engine.Detail = "Docker or Podman isn't installed. Install Docker, or Podman in rootful mode, and start it. Or connect directly to a team cluster."
		} else {
			engine.Detail = "No running rootful Docker or Podman engine detected."
			engine.Command = "sudo systemctl start docker"
		}
	}
	resp.Preflight = append(resp.Preflight, engine)

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

	// Kubeconfig contexts.
	curCtx, _ := axclient.CurrentContext()
	resp.CurrentContext = curCtx
	if entries, err := axclient.ListContexts(); err == nil {
		for _, e := range entries {
			resp.Contexts = append(resp.Contexts, ContextSummary{
				Name:    e.Name,
				Cluster: e.Cluster,
				Current: e.Current,
				IsLocal: e.Name == "ax-local" || e.Name == "local" || strings.HasPrefix(e.Name, "kind-"),
			})
		}
	}
	resp.Local.Access = s.localAccess(ctx, resp.Local, resp.Contexts)
	resp.Tools = s.collectTools(ctx, fresh)
	resp.AXFlags = s.axFlags(ctx)
	resp.SetupImages = setupImages(resp.AXFlags)

	s.opMu.Lock()
	if s.currentOp != nil {
		if s.currentOp.Action == "local-up" && s.currentOp.Status == "failed" &&
			resp.Local.State == stateRunning &&
			strings.Contains(resp.Local.SubstrateStatus, "available") &&
			strings.Contains(resp.Local.AXStatus, "available") {
			s.currentOp = nil
		} else {
			cp := *s.currentOp
			cp.Logs = append([]string(nil), s.currentOp.Logs...)
			cp.StageStarted = copyStages(s.currentOp.StageStarted)
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
	writeJSON(w, http.StatusOK, s.collectEnvStatusFresh(r.Context(), r.URL.Query().Get("fresh") == "1"))
}

type localActionRequest struct {
	Name              string `json:"name"`
	Workers           int    `json:"workers"`
	ServerImage       string `json:"serverImage"`
	DefaultTaskImage  string `json:"defaultTaskImage"`
	RunnerVolumeImage string `json:"runnerVolumeImage"`
	// Purpose is the button that started `ax local start`: setup, start,
	// update or repair. It only changes how the operation is worded.
	Purpose string `json:"purpose"`
}

// localUpPurposes are the reasons the UI runs `ax local start` for.
var localUpPurposes = map[string]bool{"": true, "setup": true, "start": true, "update": true, "repair": true}

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
		name = defaultLocalClusterName
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
	// Without images in the request or in Studio's environment (which ax
	// reads too), setup uses Studio's pinned defaults (images.go).
	flags := s.axFlags(r.Context())
	if srvImg == "" && strings.TrimSpace(os.Getenv("AX_SERVER_IMAGE")) == "" {
		srvImg = DefaultServerImage
	}
	if taskImg == "" && strings.TrimSpace(os.Getenv("AX_DEFAULT_TASK_IMAGE")) == "" && flags.DefaultTaskImage {
		taskImg = DefaultTaskImage
	}
	if runnerImg == "" && strings.TrimSpace(os.Getenv("AX_RUNNER_VOLUME_IMAGE")) == "" && flags.RunnerVolumeImage {
		runnerImg = DefaultRunnerVolumeImage
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

	purpose := strings.TrimSpace(req.Purpose)
	if !localUpPurposes[purpose] {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid purpose %q", purpose))
		return
	}
	s.runAXOperationFor(w, "local-up", purpose, name, "kind", args)
}

// runAXOperation starts `ax <args>` as the environment operation action on
// target, streaming its output to the UI, and responds with the operation.
func (s *Server) runAXOperation(w http.ResponseWriter, action, target, stage string, args []string) {
	s.runAXOperationFor(w, action, "", target, stage, args)
}

// runAXOperationFor is runAXOperation with the purpose the operation records.
func (s *Server) runAXOperationFor(w http.ResponseWriter, action, purpose, target, stage string, args []string) {
	snap, err := s.startEnvOperationFor(action, purpose, target, stage, func(opCtx context.Context, logWriter *opLogWriter) error {
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
			name = defaultLocalClusterName
		}
		if err := kube.ValidateName(name); err != nil {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("invalid cluster name: %v", err))
			return
		}
		s.runAXOperation(w, "local-"+subcmd, name, "", []string{"-n", s.axNamespace, "local", subcmd, "--name", name})
	}
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
	return s.startEnvOperationFor(action, "", target, initialStage, fn)
}

// startEnvOperationFor is startEnvOperation with the purpose the operation
// records.
func (s *Server) startEnvOperationFor(action, purpose, target, initialStage string, fn func(context.Context, *opLogWriter) error, opts ...func(*EnvOpSnapshot)) (EnvOpSnapshot, error) {
	s.opMu.Lock()
	if s.currentOp != nil && s.currentOp.Status == "running" {
		busy := fmt.Errorf("operation %q on %q is already running", s.currentOp.Action, s.currentOp.Target)
		s.opMu.Unlock()
		return EnvOpSnapshot{}, busy
	}
	opID := fmt.Sprintf("op-%d", time.Now().UnixNano())
	now := time.Now().UnixMilli()
	snap := &EnvOpSnapshot{
		ID:      opID,
		Action:  action,
		Target:  target,
		Stage:   initialStage,
		Status:  "running",
		Started: now,
		Purpose: purpose,
	}
	if initialStage != "" {
		snap.StageStarted = map[string]int64{initialStage: now}
	}
	for _, o := range opts {
		o(snap)
	}
	parentCtx := s.shutdownCtx
	if parentCtx == nil {
		parentCtx = context.Background()
	}
	opCtx, cancel := context.WithTimeout(parentCtx, 20*time.Minute)
	s.extras.opCancel = cancel
	s.currentOp = snap
	cp := *snap
	cp.StageStarted = copyStages(snap.StageStarted)
	s.opMu.Unlock()

	s.hub.Publish("envOp", cp)

	s.opWg.Add(1)
	go func() {
		defer s.opWg.Done()
		defer cancel()
		lw := &opLogWriter{srv: s, op: opID}
		err := fn(opCtx, lw)

		s.opMu.Lock()
		if s.currentOp != nil && s.currentOp.ID == opID {
			s.currentOp.Finished = time.Now().UnixMilli()
			switch {
			case s.currentOp.Canceled:
				s.currentOp.Status = "failed"
				s.currentOp.Error = "Canceled"
			case err != nil:
				s.currentOp.Status = "failed"
				s.currentOp.Error = err.Error()
				s.currentOp.ExitCode = exitCodeOf(err)
			default:
				s.currentOp.Status = "ok"
			}
			doneSnap := *s.currentOp
			doneSnap.Logs = append([]string(nil), s.currentOp.Logs...)
			doneSnap.StageStarted = copyStages(s.currentOp.StageStarted)
			s.extras.opCancel = nil
			s.opMu.Unlock()
			s.hub.Publish("envOp", doneSnap)
			return
		}
		s.opMu.Unlock()
	}()

	return cp, nil
}

func copyStages(m map[string]int64) map[string]int64 {
	if m == nil {
		return nil
	}
	out := make(map[string]int64, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}

// opStages is the order `ax local start` builds things in.
var opStages = []string{"kind", "substrate", "workers", "ax"}

// stageFor says which stage one of ax's "==> " progress lines starts.
func stageFor(line string) string {
	switch {
	case strings.Contains(line, "Kind cluster"):
		return "kind"
	case strings.Contains(line, "WorkerPool"):
		return "workers"
	case strings.Contains(line, "ax-postgres") || strings.Contains(line, "ax-server") || strings.Contains(line, "AX is ready") || strings.Contains(line, "Substrate permissions"):
		return "ax"
	case strings.Contains(line, "Substrate"):
		return "substrate"
	}
	return ""
}

func stageIndex(stage string) int {
	for i, s := range opStages {
		if s == stage {
			return i
		}
	}
	return -1
}

func (s *Server) appendOpLog(opID, line string) {
	clean := scrubSecrets(line)
	s.opMu.Lock()
	if s.currentOp == nil || s.currentOp.ID != opID {
		s.opMu.Unlock()
		return
	}
	/* Only ax's own "==> " progress lines move the stage, and only forward: a later line that names an earlier layer
	   doesn't take setup back. */
	if step, ok := strings.CutPrefix(strings.TrimSpace(clean), "==> "); ok {
		s.currentOp.Step = step
		if next := stageFor(step); next != "" && stageIndex(next) > stageIndex(s.currentOp.Stage) {
			s.currentOp.Stage = next
			if s.currentOp.StageStarted == nil {
				s.currentOp.StageStarted = map[string]int64{}
			}
			s.currentOp.StageStarted[next] = time.Now().UnixMilli()
		}
	}
	if len(s.currentOp.Logs) < 2000 {
		s.currentOp.Logs = append(s.currentOp.Logs, clean)
	}
	stage := s.currentOp.Stage
	step := s.currentOp.Step
	started := copyStages(s.currentOp.StageStarted)
	s.opMu.Unlock()

	s.hub.Publish("streamLine", map[string]any{
		"id":           opID,
		"line":         clean,
		"stage":        stage,
		"step":         step,
		"stageStarted": started,
	})
}
