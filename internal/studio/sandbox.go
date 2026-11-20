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
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

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
