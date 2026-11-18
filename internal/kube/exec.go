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

// Package kube provides self-contained host preflight, kubeconfig context,
// port-forward tunnel, and allow-listed CLI execution helpers for AX Studio.
package kube

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

const (
	minKernelMajor       = 6
	minKernelMinor       = 8
	minRecommendedMemGiB = 6.0
)

var kernelVersionRe = regexp.MustCompile(`^(\d+)\.(\d+)`)

// Spec describes an allow-listed external command invocation.
type Spec struct {
	Name   string
	Args   []string
	Env    []string
	Dir    string
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

// Result captures the stdout, stderr, and exit code of a command run.
type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// Runner abstracts subprocess execution for hermetic unit testing.
type Runner interface {
	Run(ctx context.Context, spec Spec) (Result, error)
	LookPath(file string) (string, error)
}

// OSRunner executes commands on the host operating system.
type OSRunner struct{}

// LookPath searches for an executable in PATH.
func (OSRunner) LookPath(file string) (string, error) {
	return exec.LookPath(file)
}

// Run executes spec and captures its output and exit code.
func (OSRunner) Run(ctx context.Context, spec Spec) (Result, error) {
	cmd := exec.CommandContext(ctx, spec.Name, spec.Args...)
	if spec.Dir != "" {
		cmd.Dir = spec.Dir
	}
	if len(spec.Env) > 0 {
		cmd.Env = append(os.Environ(), spec.Env...)
	}
	if spec.Stdin != nil {
		cmd.Stdin = spec.Stdin
	}

	var stdoutBuf, stderrBuf bytes.Buffer
	if spec.Stdout != nil {
		cmd.Stdout = io.MultiWriter(&stdoutBuf, spec.Stdout)
	} else {
		cmd.Stdout = &stdoutBuf
	}
	if spec.Stderr != nil {
		cmd.Stderr = io.MultiWriter(&stderrBuf, spec.Stderr)
	} else {
		cmd.Stderr = &stderrBuf
	}

	err := cmd.Run()
	res := Result{
		Stdout:   stdoutBuf.String(),
		Stderr:   stderrBuf.String(),
		ExitCode: 0,
	}
	if err != nil {
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			res.ExitCode = exitErr.ExitCode()
		} else {
			res.ExitCode = 1
		}
		return res, err
	}
	return res, nil
}

// BinDir returns the managed AX tool directory (~/.ax/bin, $AX_HOME/bin, or $AX_BIN_DIR).
func BinDir() string {
	if dir := strings.TrimSpace(os.Getenv("AX_BIN_DIR")); dir != "" {
		return dir
	}
	if axHome := strings.TrimSpace(os.Getenv("AX_HOME")); axHome != "" {
		return filepath.Join(axHome, "bin")
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".ax", "bin")
	}
	return ""
}

func resolveManagedOrPathTool(r Runner, envOverride, binaryName string) (string, error) {
	if r == nil {
		r = OSRunner{}
	}
	if envOverride != "" {
		if explicit := strings.TrimSpace(os.Getenv(envOverride)); explicit != "" {
			if st, err := os.Stat(explicit); err == nil && !st.IsDir() {
				return explicit, nil
			}
			if p, err := r.LookPath(explicit); err == nil {
				return p, nil
			}
		}
	}
	if dir := BinDir(); dir != "" {
		candidate := filepath.Join(dir, binaryName)
		if st, err := os.Stat(candidate); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return candidate, nil
		}
	}
	return r.LookPath(binaryName)
}

// ResolveAXBinary locates the installed `ax` CLI (~/.ax/bin/ax or PATH).
func ResolveAXBinary(r Runner) string {
	if p, err := resolveManagedOrPathTool(r, "AX_BIN", "ax"); err == nil && p != "" {
		return p
	}
	return "ax"
}

// ResolveKubectl locates `kubectl` in ~/.ax/bin or PATH.
func ResolveKubectl(r Runner) (string, error) {
	return resolveManagedOrPathTool(r, "", "kubectl")
}

// ResolveKind locates `kind` in ~/.ax/bin or PATH.
func ResolveKind(r Runner) (string, error) {
	return resolveManagedOrPathTool(r, "", "kind")
}

// ContainerRuntime identifies the host container engine CLI and whether it is Podman.
type ContainerRuntime struct {
	Binary   string
	IsPodman bool
}

// ContainerHostInfo summarizes the container daemon's underlying Linux host or VM.
type ContainerHostInfo struct {
	KernelVersion string
	MemTotalBytes int64
	Rootless      bool
}

// ResolveContainerRuntime locates a running Docker or Podman engine.
func ResolveContainerRuntime(ctx context.Context, r Runner) (ContainerRuntime, error) {
	if r == nil {
		r = OSRunner{}
	}
	if explicit := strings.TrimSpace(os.Getenv("CONTAINER_CLI")); explicit != "" {
		p, err := r.LookPath(explicit)
		if err != nil {
			return ContainerRuntime{}, fmt.Errorf("CONTAINER_CLI=%q not found: %w", explicit, err)
		}
		res, _ := r.Run(ctx, Spec{Name: p, Args: []string{"--version"}})
		return ContainerRuntime{
			Binary:   p,
			IsPodman: strings.Contains(strings.ToLower(res.Stdout+filepath.Base(p)), "podman"),
		}, nil
	}

	for _, candidate := range []struct {
		name     string
		isPodman bool
	}{
		{name: "docker", isPodman: false},
		{name: "podman", isPodman: true},
	} {
		p, err := r.LookPath(candidate.name)
		if err != nil {
			continue
		}
		if _, err := r.Run(ctx, Spec{Name: p, Args: []string{"info"}}); err == nil {
			return ContainerRuntime{Binary: p, IsPodman: candidate.isPodman}, nil
		}
	}
	if runtime.GOOS == "darwin" {
		return ContainerRuntime{}, errors.New("no running container engine found on macOS: start OrbStack, Docker Desktop, or Colima")
	}
	return ContainerRuntime{}, errors.New("no running container engine found: install and start Docker or rootful Podman")
}

// InspectContainerHost queries Docker or Podman for its Linux kernel, memory, and rootless mode.
func InspectContainerHost(ctx context.Context, r Runner, rt ContainerRuntime) (ContainerHostInfo, bool) {
	format := "{{.KernelVersion}}|{{.MemTotal}}|{{.SecurityOptions}}"
	if rt.IsPodman {
		format = "{{.Host.Kernel}}|{{.Host.MemTotal}}|{{.Host.Security.Rootless}}"
	}
	res, err := r.Run(ctx, Spec{
		Name: rt.Binary,
		Args: []string{"info", "--format", format},
	})
	if err != nil {
		return ContainerHostInfo{}, false
	}
	line := strings.TrimSpace(res.Stdout)
	if line == "" {
		return ContainerHostInfo{}, false
	}
	parts := strings.SplitN(line, "|", 3)
	if len(parts) < 3 {
		return ContainerHostInfo{}, false
	}
	memBytes, _ := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	secField := strings.ToLower(strings.TrimSpace(parts[2]))
	rootless := secField == "true" || strings.Contains(secField, "name=rootless")
	return ContainerHostInfo{
		KernelVersion: strings.TrimSpace(parts[0]),
		MemTotalBytes: memBytes,
		Rootless:      rootless,
	}, true
}

// ValidateContainerHost checks kernel (>= 6.8), rootful mode, and memory capacity.
func ValidateContainerHost(info ContainerHostInfo, isPodman bool, hostOS string, warnOut io.Writer) error {
	if info.Rootless {
		if isPodman {
			return errors.New("rootless Podman is not supported for 'ax local' (requires rootful mode): run 'podman machine stop && podman machine set --rootful && podman machine start' or use Colima / OrbStack / Docker Desktop")
		}
		return errors.New("rootless Docker is not supported for 'ax local' (requires rootful mode): use a rootful Docker engine (or Colima / OrbStack / Docker Desktop on macOS)")
	}
	if maj, minVer, ok := parseKernelMajorMinor(info.KernelVersion); ok {
		if maj < minKernelMajor || (maj == minKernelMajor && minVer < minKernelMinor) {
			vmHint := "upgrade your host Linux kernel to >= 6.8"
			if hostOS == "darwin" {
				vmHint = "upgrade your macOS container Linux VM (Colima / OrbStack / Docker Desktop) to a Linux >= 6.8 kernel"
			}
			return fmt.Errorf("container host Linux kernel %q is older than %d.%d (required by Agent Substrate's OverlayFS lowerdir+ image cache): %s",
				info.KernelVersion, minKernelMajor, minKernelMinor, vmHint)
		}
	}
	if info.MemTotalBytes > 0 && warnOut != nil {
		gib := float64(info.MemTotalBytes) / (1024 * 1024 * 1024)
		if gib < minRecommendedMemGiB {
			if hostOS == "darwin" {
				fmt.Fprintf(warnOut, "==> Warning: container VM has %.1f GiB RAM (< %.1f GiB recommended); increase VM memory (e.g. 'colima stop && colima start --cpu 4 --memory 8 --disk 60 --vm-type vz').\n", gib, minRecommendedMemGiB)
			} else {
				fmt.Fprintf(warnOut, "==> Warning: container host has %.1f GiB RAM (< %.1f GiB recommended); pods may stay Pending under load.\n", gib, minRecommendedMemGiB)
			}
		}
	}
	return nil
}

func parseKernelMajorMinor(raw string) (int, int, bool) {
	m := kernelVersionRe.FindStringSubmatch(strings.TrimSpace(raw))
	if len(m) != 3 {
		return 0, 0, false
	}
	maj, err1 := strconv.Atoi(m[1])
	minVer, err2 := strconv.Atoi(m[2])
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return maj, minVer, true
}

// ExecInTaskSandbox executes a non-interactive command inside a debug-enabled
// task sandbox by invoking `ax ssh <task> -- ...` with positional arguments only
// (zero shell string interpolation).
func ExecInTaskSandbox(ctx context.Context, r Runner, axBinary, atespace, taskName, kubeContext, axNamespace string, command []string, cwd string) (string, string, int, error) {
	if r == nil {
		r = OSRunner{}
	}
	if err := ValidateName(taskName); err != nil {
		return "", "", 1, fmt.Errorf("invalid task name: %w", err)
	}
	if len(command) == 0 {
		return "", "", 1, errors.New("empty sandbox command")
	}
	if strings.HasPrefix(kubeContext, "-") || strings.HasPrefix(atespace, "-") || strings.HasPrefix(axNamespace, "-") {
		return "", "", 1, errors.New("invalid context or namespace flag")
	}
	if axBinary == "" {
		axBinary = ResolveAXBinary(r)
	}

	var args []string
	if kubeContext != "" {
		args = append(args, "--context", kubeContext)
	}
	if axNamespace != "" {
		args = append(args, "-n", axNamespace)
	}
	if atespace != "" {
		args = append(args, "-a", atespace)
	}
	args = append(args, "ssh", taskName, "--")
	if strings.TrimSpace(cwd) != "" {
		args = append(args, "/bin/sh", "-c", `cd "$1" && shift && exec "$@"`, "sh", cwd)
	}
	args = append(args, command...)

	res, err := r.Run(ctx, Spec{
		Name: axBinary,
		Args: args,
	})
	return res.Stdout, res.Stderr, res.ExitCode, err
}
