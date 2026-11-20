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

// What the Environments page of the desktop app shows, for the web UI too:
//
//   - the command-line tools AX on this computer uses (ax, kubectl, kind), with
//     their versions and where they are;
//   - whether Studio can look inside a running local cluster (its context may
//     be missing from the kubeconfig, or its API server may not answer);
//   - a read-only check of a cluster in the kubeconfig: whether it can run
//     Agent Substrate and AX, and whether each is installed;
//   - uninstalling AX from a cluster, and cancelling the command that runs.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

// ToolInfo is a command-line tool AX on this computer depends on.
type ToolInfo struct {
	Name string `json:"name"`
	// Version is empty when the tool isn't installed or doesn't say.
	Version string `json:"version"`
	// Status is "ok", "warn", "fail", or "none" for a tool that is missing but
	// that ax downloads when it needs it.
	Status string `json:"status"`
	// Detail says where the tool is, or what happens without it.
	Detail string `json:"detail"`
}

// AXFlags says which optional flags this ax accepts, so the UI only offers
// what will work.
type AXFlags struct {
	RunnerVolumeImage bool `json:"runnerVolumeImage"`
	DefaultTaskImage  bool `json:"defaultTaskImage"`
}

const (
	// toolsTTL is how long the tools' versions are kept between env checks.
	toolsTTL = time.Minute
	// minKindMinor: ax uses a kind on PATH only from v0.<this>; otherwise it
	// keeps its own in ~/.ax/bin.
	minKindMinor = 32
)

var (
	kubectlClientRe = regexp.MustCompile(`Client Version:\s*(\S+)`)
	kindVersionRe   = regexp.MustCompile(`kind (v[\w.-]+)`)
	axVersionRe     = regexp.MustCompile(`(?i)ax version\s+(\S+)`)
	majorMinorRe    = regexp.MustCompile(`^v?(\d+)\.(\d+)`)

	// fileExists is a seam for tests.
	fileExists = func(path string) bool { _, err := os.Stat(path); return err == nil }
)

// envExtras holds what the env checks keep between calls.
type envExtras struct {
	toolsMu sync.Mutex
	tools   []ToolInfo
	toolsAt time.Time

	flagsOnce sync.Once
	flags     AXFlags

	opCancel context.CancelFunc

	// workerNS caches where each cluster's Agent Substrate workers run (logs.go).
	workerNS workerNamespaces
}

// shortHome writes a path under the home directory with ~.
func shortHome(path string) string {
	home, _ := os.UserHomeDir()
	if home != "" && strings.HasPrefix(path, home+string(filepath.Separator)) {
		return "~" + path[len(home):]
	}
	return path
}

// olderThan says whether a "v1.2.3" or "6.8.0-45" version is older than min.
func olderThan(version string, min [2]int) bool {
	m := majorMinorRe.FindStringSubmatch(strings.TrimSpace(version))
	if m == nil {
		return false
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	return major < min[0] || (major == min[0] && minor < min[1])
}

// versionOf runs program with args and returns what pattern finds in its output.
func (s *Server) versionOf(ctx context.Context, program string, args []string, pattern *regexp.Regexp) string {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	res, err := s.runner.Run(ctx, kube.Spec{Name: program, Args: args})
	if err != nil {
		return ""
	}
	if m := pattern.FindStringSubmatch(res.Stdout + "\n" + res.Stderr); m != nil {
		return m[1]
	}
	return ""
}

// collectTools finds ax, kubectl and kind the way ax will, with their versions.
// The answer is kept for a minute unless fresh is set.
func (s *Server) collectTools(ctx context.Context, fresh bool) []ToolInfo {
	s.extras.toolsMu.Lock()
	defer s.extras.toolsMu.Unlock()
	if !fresh && s.extras.tools != nil && time.Since(s.extras.toolsAt) < toolsTTL {
		return append([]ToolInfo(nil), s.extras.tools...)
	}
	const downloaded = "Not installed. ax downloads it into ~/.ax/bin when you set up AX on this computer."
	var tools []ToolInfo

	axPath := s.axBinary
	found := ""
	if filepath.IsAbs(axPath) {
		if fileExists(axPath) {
			found = axPath
		}
	} else if p, err := s.runner.LookPath(axPath); err == nil {
		found = p
	}
	if found == "" {
		tools = append(tools, ToolInfo{Name: "ax", Status: "fail", Detail: fmt.Sprintf("Not found (%s). Install AX, or start AX Studio with --ax-bin.", axPath)})
	} else {
		tools = append(tools, ToolInfo{Name: "ax", Version: s.versionOf(ctx, found, []string{"version"}, axVersionRe), Status: "ok", Detail: shortHome(found)})
	}

	if kubectl, err := kube.ResolveKubectl(s.runner); err == nil && kubectl != "" {
		tools = append(tools, ToolInfo{Name: "kubectl", Version: s.versionOf(ctx, kubectl, []string{"version", "--client"}, kubectlClientRe), Status: "ok", Detail: shortHome(kubectl)})
	} else {
		tools = append(tools, ToolInfo{Name: "kubectl", Status: "none", Detail: downloaded})
	}

	if kind, err := kube.ResolveKind(s.runner); err == nil && kind != "" {
		v := s.versionOf(ctx, kind, []string{"version"}, kindVersionRe)
		if v != "" && olderThan(v, [2]int{0, minKindMinor}) {
			tools = append(tools, ToolInfo{Name: "kind", Version: v, Status: "warn",
				Detail: fmt.Sprintf("The kind at %s is older than v0.%d.0. ax downloads a newer one into ~/.ax/bin when you set up AX on this computer.", shortHome(kind), minKindMinor)})
		} else {
			tools = append(tools, ToolInfo{Name: "kind", Version: v, Status: "ok", Detail: shortHome(kind)})
		}
	} else {
		tools = append(tools, ToolInfo{Name: "kind", Status: "none", Detail: downloaded})
	}

	s.extras.tools = tools
	s.extras.toolsAt = time.Now()
	return append([]ToolInfo(nil), tools...)
}

// axFlags reads which optional flags this ax's `local start` takes, once.
func (s *Server) axFlags(ctx context.Context) AXFlags {
	s.extras.flagsOnce.Do(func() {
		hctx, cancel := context.WithTimeout(ctx, 8*time.Second)
		defer cancel()
		res, _ := s.runner.Run(hctx, kube.Spec{Name: s.axBinary, Args: []string{"local", "start", "--help"}})
		help := res.Stdout + res.Stderr
		s.extras.flags.RunnerVolumeImage = strings.Contains(help, "--runner-volume-image")
		s.extras.flags.DefaultTaskImage = strings.Contains(help, "--default-task-image")
	})
	return s.extras.flags
}

// localAccess says whether kubectl can look inside the running local cluster:
// "ok", "no-context" (the kubeconfig has no context for it) or "unreachable"
// (its API server doesn't answer). Without access, what's installed on it is
// unknown rather than missing.
func (s *Server) localAccess(ctx context.Context, st LocalClusterInfo, contexts []ContextSummary) string {
	if st.State != stateRunning {
		return "ok"
	}
	known := false
	for _, c := range contexts {
		if c.Name == st.KubeContext {
			known = true
			break
		}
	}
	if !known {
		return "no-context"
	}
	// The deployments answered, so the API server did.
	if st.SubstrateStatus != "NotInstalled" || st.AXStatus != "NotInstalled" {
		return "ok"
	}
	kubectl, err := kube.ResolveKubectl(s.runner)
	if err != nil || kubectl == "" {
		return "ok"
	}
	pctx, cancel := context.WithTimeout(ctx, 6*time.Second)
	defer cancel()
	if _, err := s.runner.Run(pctx, kube.Spec{Name: kubectl, Args: []string{"--context", st.KubeContext, "--request-timeout=4s", "get", "--raw=/version"}}); err != nil {
		return "unreachable"
	}
	return "ok"
}

// macVMAdvice says, on macOS with no engine answering, which apps that provide
// a Linux VM for containers are installed and how to start one.
func (s *Server) macVMAdvice() (detail, command string) {
	const colima = "colima start --cpu 4 --memory 8 --disk 60 --vm-type vz --mount-type virtiofs"
	type app struct{ name, command string }
	var found []app
	if _, err := s.runner.LookPath("orbctl"); err == nil || fileExists("/Applications/OrbStack.app") {
		found = append(found, app{"OrbStack", "open -a OrbStack"})
	}
	if fileExists("/Applications/Docker.app") {
		found = append(found, app{"Docker Desktop", "open -a Docker"})
	}
	if _, err := s.runner.LookPath("colima"); err == nil {
		found = append(found, app{"Colima", colima})
	}
	if _, err := s.runner.LookPath("podman"); err == nil {
		found = append(found, app{"Podman", "podman machine start"})
	}
	if len(found) == 0 {
		return "No Linux VM for containers is installed. macOS needs one to run AX on this computer: install OrbStack, Docker Desktop or Colima, or connect to a remote cluster instead.",
			"brew install docker colima && " + colima
	}
	names := make([]string, len(found))
	for i, a := range found {
		names[i] = a.name
	}
	verb, which := "is", "it"
	if len(found) > 1 {
		verb, which = "are", "one"
	}
	return fmt.Sprintf("%s %s installed, but no Linux VM is running. Start %s with at least 6 GiB of RAM, or connect to a remote cluster instead.", strings.Join(names, ", "), verb, which),
		found[0].command
}

func nonEmptyLines(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			out = append(out, l)
		}
	}
	return out
}

// lastLine is the last thing a command said, for an error message.
func lastLine(s string) string {
	lines := nonEmptyLines(s)
	if len(lines) == 0 {
		return ""
	}
	return lines[len(lines)-1]
}

// exitStatusRe finds the code in an error like "exit status 2".
var exitStatusRe = regexp.MustCompile(`exit status (\d+)`)

// exitCodeOf is the exit code of a command that failed, or 0 when the error
// doesn't carry one.
func exitCodeOf(err error) int {
	var ee *exec.ExitError
	if errors.As(err, &ee) {
		return ee.ExitCode()
	}
	if err != nil {
		if m := exitStatusRe.FindStringSubmatch(err.Error()); m != nil {
			n, _ := strconv.Atoi(m[1])
			return n
		}
	}
	return 0
}

// handleEnvCancel serves POST /api/env/cancel: it interrupts the command that
// runs. What it has already done stays done; running it again picks up there.
func (s *Server) handleEnvCancel(w http.ResponseWriter, r *http.Request) {
	s.opMu.Lock()
	running := s.currentOp != nil && s.currentOp.Status == "running"
	cancel := s.extras.opCancel
	if running {
		s.currentOp.Canceled = true
	}
	s.opMu.Unlock()
	if !running || cancel == nil {
		writeError(w, http.StatusConflict, "nothing is running")
		return
	}
	cancel()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
