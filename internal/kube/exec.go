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

// Package kube runs the ax and kubectl commands AX Studio needs and validates
// the names it passes to them.
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
	"strings"
)

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

// KubeconfigPaths returns the kubeconfig files contexts are read from:
// $KUBECONFIG when it is set, otherwise ~/.kube/config.
func KubeconfigPaths() []string {
	if p := os.Getenv("KUBECONFIG"); p != "" {
		var out []string
		for _, item := range filepath.SplitList(p) {
			if item != "" {
				out = append(out, item)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return []string{filepath.Join(home, ".kube", "config")}
	}
	return nil
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
