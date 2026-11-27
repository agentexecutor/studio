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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
)

type stubAXServer struct {
	v1alpha1.UnimplementedAXServer
	task *v1alpha1.Task
	ws   *v1alpha1.Workspace
}

func (s *stubAXServer) GetTask(_ context.Context, _ *v1alpha1.GetTaskRequest) (*v1alpha1.Task, error) {
	return s.task, nil
}

func (s *stubAXServer) GetWorkspace(_ context.Context, _ *v1alpha1.GetWorkspaceRequest) (*v1alpha1.Workspace, error) {
	return s.ws, nil
}

func bootstrapTestSession(t *testing.T, h http.Handler) (*http.Cookie, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/bootstrap", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("bootstrap returned %d: %s", rec.Code, rec.Body.String())
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == sessionCookieName {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("expected HttpOnly SameSite=Strict session cookie, got %+v", cookie)
	}
	var body struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body.CSRFToken == "" {
		t.Fatalf("expected csrfToken in bootstrap response, got %s", rec.Body.String())
	}
	return cookie, body.CSRFToken
}

func TestValidateLoopbackAddr(t *testing.T) {
	for _, bad := range []string{"0.0.0.0:8080", ":8080", "192.168.1.10:8080", "[::]:8080"} {
		if err := ValidateLoopbackAddr(bad); err == nil {
			t.Errorf("expected non-loopback address %q to be rejected", bad)
		}
	}
	for _, good := range []string{"127.0.0.1:8080", "localhost:8080", "[::1]:8080", "127.0.0.1:0"} {
		if err := ValidateLoopbackAddr(good); err != nil {
			t.Errorf("expected loopback address %q to pass, got %v", good, err)
		}
	}
}

// Settings shows what this Studio is, which ax it runs and which kubeconfig its
// clusters come from, so the bootstrap response carries them.
func TestBootstrapDescribesThisStudio(t *testing.T) {
	cfg := filepath.Join(t.TempDir(), "kubeconfig")
	t.Setenv("KUBECONFIG", cfg)
	for _, tc := range []struct {
		version, want string
	}{
		{version: "v0.2.0", want: "v0.2.0"},
		{version: "", want: "dev"},
	} {
		srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "/opt/ax/bin/ax", Version: tc.version})
		if err != nil {
			t.Fatalf("NewServer: %v", err)
		}
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/bootstrap", nil)
		rec := httptest.NewRecorder()
		srv.Handler().ServeHTTP(rec, req)
		var body struct {
			StudioVersion string `json:"studioVersion"`
			AXBinary      string `json:"axBinary"`
			Kubeconfig    string `json:"kubeconfig"`
			AXNamespace   string `json:"axNamespace"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("decoding bootstrap: %v (%s)", err, rec.Body.String())
		}
		if body.StudioVersion != tc.want || body.AXBinary != "/opt/ax/bin/ax" || body.Kubeconfig != cfg || body.AXNamespace != v1alpha1.DefaultSystemNamespace {
			t.Errorf("Version %q: bootstrap = %+v", tc.version, body)
		}
	}
}

func TestServerSecurityControls(t *testing.T) {
	srv, err := NewServer(Options{Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	h := srv.Handler()

	// 1. /healthz works unauthenticated and sets strict security headers.
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 on /healthz, got %d", rec.Code)
	}
	if got := rec.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("expected X-Frame-Options=DENY, got %q", got)
	}
	if got := rec.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("expected X-Content-Type-Options=nosniff, got %q", got)
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") {
		t.Errorf("expected strict script-src in CSP, got %q", csp)
	}

	// 2. DNS rebinding Host header rejected.
	req = httptest.NewRequest(http.MethodGet, "http://evil.example.com:8080/healthz", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for non-loopback Host header, got %d", rec.Code)
	}

	// 3. Cross-origin browser request rejected.
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/ax/exec", strings.NewReader(`{}`))
	req.Header.Set("Origin", "https://attacker.example")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for foreign Origin, got %d", rec.Code)
	}

	// 4. Disallowed HTTP methods rejected.
	req = httptest.NewRequest(http.MethodDelete, "http://127.0.0.1:8080/api/env/status", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("expected 405 for DELETE, got %d", rec.Code)
	}

	// 5. Unauthenticated /api/env/status rejected with 401.
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/env/status", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without session cookie, got %d", rec.Code)
	}

	cookie, csrf := bootstrapTestSession(t, h)

	// 6. State-changing POST without CSRF token rejected with 403.
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/ax/exec", strings.NewReader(`{"program":"ax","args":["version"]}`))
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 without CSRF token, got %d", rec.Code)
	}

	// 7. Programs other than ax, subcommands the UI does not use, and
	// arbitrary file flags are rejected by the exec allow-list.
	for _, payload := range []string{
		`{"program":"/bin/sh","args":["-c","id"]}`,
		`{"program":"kubectl","args":["config","current-context"]}`,
		`{"program":"ax","args":["local","delete"]}`,
		`{"program":"ax","args":["apply","-f","/etc/passwd"]}`,
	} {
		req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/ax/exec", strings.NewReader(payload))
		req.AddCookie(cookie)
		req.Header.Set(csrfHeaderName, csrf)
		rec = httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("expected 403 for payload %s, got %d", payload, rec.Code)
		}
	}
}

type argsRunner struct {
	ran  chan []string
	help string
}

func (r argsRunner) LookPath(file string) (string, error) { return "/usr/bin/" + file, nil }

func (r argsRunner) Run(_ context.Context, spec kube.Spec) (kube.Result, error) {
	// Studio reads `ax local start --help` once for the flags this ax takes.
	if len(spec.Args) > 0 && spec.Args[len(spec.Args)-1] == "--help" {
		return kube.Result{Stdout: r.help}, nil
	}
	r.ran <- spec.Args
	return kube.Result{}, nil
}

func TestLocalUpPassesImageOverrides(t *testing.T) {
	runner := argsRunner{ran: make(chan []string, 1)}
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "ax", Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)

	body := `{"name":"ax-local","workers":2,"serverImage":"example.com/ax-server:v1","runnerVolumeImage":"example.com/ax-runner-volume:v1"}`
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(body))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("local/up returned %d: %s", rec.Code, rec.Body.String())
	}

	got := strings.Join(<-runner.ran, " ")
	want := "-n ax-system local start --name ax-local --workers 2 --server-image example.com/ax-server:v1 --runner-volume-image example.com/ax-runner-volume:v1"
	if got != want {
		t.Fatalf("ax arguments = %q, want %q", got, want)
	}

	// A flag-like image reference never reaches the command line.
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(`{"runnerVolumeImage":"--help"}`))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a flag-like image, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLocalUpUsesStudiosImagesByDefault(t *testing.T) {
	t.Setenv("AX_SERVER_IMAGE", "")
	t.Setenv("AX_DEFAULT_TASK_IMAGE", "")
	start := func(t *testing.T, help string) string {
		t.Helper()
		runner := argsRunner{ran: make(chan []string, 1), help: help}
		srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "ax", Runner: runner})
		if err != nil {
			t.Fatal(err)
		}
		h := srv.Handler()
		cookie, csrf := bootstrapTestSession(t, h)
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(`{"purpose":"setup"}`))
		req.AddCookie(cookie)
		req.Header.Set(csrfHeaderName, csrf)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusAccepted {
			t.Fatalf("local/up returned %d: %s", rec.Code, rec.Body.String())
		}
		return strings.Join(<-runner.ran, " ")
	}
	got := start(t, "  --server-image string\n  --default-task-image string\n")
	if want := "--server-image " + DefaultServerImage + " --default-task-image " + DefaultTaskImage; !strings.HasSuffix(got, want) {
		t.Errorf("ax arguments = %q, want them to end with %q", got, want)
	}
	// An ax without --default-task-image still gets the server image.
	if got := start(t, "  --server-image string\n"); strings.Contains(got, "--default-task-image") || !strings.Contains(got, "--server-image "+DefaultServerImage) {
		t.Errorf("ax arguments = %q", got)
	}
	// An image in Studio's environment wins: ax reads it from there.
	t.Setenv("AX_SERVER_IMAGE", "example.com/ax-server:v2")
	if got := start(t, ""); strings.Contains(got, "--server-image") {
		t.Errorf("with AX_SERVER_IMAGE set, ax arguments = %q", got)
	}
	t.Setenv("AX_SERVER_IMAGE", "")
	// An ax that takes --runner-volume-image gets Studio's runner volume, so
	// agent images without a runner of their own (agy-cli) can start.
	t.Setenv("AX_RUNNER_VOLUME_IMAGE", "")
	if got := start(t, "  --server-image string\n  --runner-volume-image string\n"); !strings.HasSuffix(got, "--server-image "+DefaultServerImage+" --runner-volume-image "+DefaultRunnerVolumeImage) {
		t.Errorf("ax arguments = %q, want the runner volume", got)
	}
	t.Setenv("AX_RUNNER_VOLUME_IMAGE", "example.com/ax-runner-volume:v2")
	if got := start(t, "  --server-image string\n  --runner-volume-image string\n"); strings.Contains(got, "--runner-volume-image") {
		t.Errorf("with AX_RUNNER_VOLUME_IMAGE set, ax arguments = %q", got)
	}
}

func TestValidateAXArgs(t *testing.T) {
	sub, err := validateAXArgs([]string{"--context", "ax-local", "-a", "default", "suspend", "task", "demo"})
	if err != nil || sub != "suspend" {
		t.Fatalf("validateAXArgs(suspend) = (%q, %v), want (suspend, nil)", sub, err)
	}
	for _, bad := range [][]string{
		nil,
		{"--context", "ax-local", "promote", "task", "demo", "--to", "team-gke"},
		{"--context", "local"},
		{"local", "delete"},
		{"--kubeconfig", "/tmp/x", "get", "tasks"},
		{"apply", "--file", "/etc/passwd"},
	} {
		if _, err := validateAXArgs(bad); err == nil {
			t.Errorf("validateAXArgs(%q) succeeded, want an error", bad)
		}
	}
}
