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
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agentexecutor/studio/internal/kube"
	axclient "github.com/google/ax/client"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
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

func TestTaskChangesAndApplyLocal(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}

	repoDir := t.TempDir()
	runGit := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", repoDir}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v (%s)", args, err, string(out))
		}
	}
	runGit("init", "-b", "main")
	runGit("config", "user.name", "Test")
	runGit("config", "user.email", "test@example.com")
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# Demo\nLine 1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "README.md")
	runGit("commit", "-m", "initial")

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcSrv := grpc.NewServer()
	v1alpha1.RegisterAXServer(grpcSrv, &stubAXServer{
		task: &v1alpha1.Task{
			Metadata: &v1alpha1.ObjectMeta{Name: "demo-task", Atespace: "default"},
			Spec:     &v1alpha1.TaskSpec{Debug: true, Workspace: &v1alpha1.WorkspaceRef{Name: "ws1"}},
			Status:   &v1alpha1.TaskStatus{State: v1alpha1.TaskState_TASK_STATE_WORKING, Actor: "actor-1"},
		},
		ws: &v1alpha1.Workspace{
			Metadata: &v1alpha1.ObjectMeta{Name: "ws1", Atespace: "default"},
			Spec: &v1alpha1.WorkspaceSpec{
				Setup: &v1alpha1.WorkspaceSetup{
					Git: []*v1alpha1.GitRepo{{Name: "origin", Repo: "https://github.com/example/demo.git", Dir: "."}},
				},
			},
		},
	})
	go func() { _ = grpcSrv.Serve(ln) }()
	t.Cleanup(grpcSrv.Stop)

	sampleTrackedDiff := "diff --git a/README.md b/README.md\nindex 1111111..2222222 100644\n--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,3 @@\n # Demo\n Line 1\n+Added by AX agent\n"
	sampleUntrackedDiff := "diff --git a/dev/null b/notes.txt\nnew file mode 100644\n--- /dev/null\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+hello from sandbox\n"

	srv, err := NewServer(Options{
		Addr: "127.0.0.1:0",
		ResolveServer: func(context.Context, axclient.Options) (string, error) {
			return "http://" + ln.Addr().String(), nil
		},
		GuestExec: func(_ context.Context, _, _, _, _ string, cmd []string, _ string) (string, string, int, error) {
			j := strings.Join(cmd, " ")
			switch {
			case strings.Contains(j, "rev-parse --show-toplevel"):
				return "/workspace\n", "", 0, nil
			case strings.Contains(j, "rev-parse --abbrev-ref HEAD"):
				return "main\n", "", 0, nil
			case strings.Contains(j, "status --porcelain"):
				return " M README.md\n?? notes.txt\n", "", 0, nil
			case strings.Contains(j, "diff HEAD"):
				return sampleTrackedDiff, "", 0, nil
			case strings.Contains(j, "diff --no-index"):
				return sampleUntrackedDiff, "", 1, nil
			default:
				return "", "", 0, nil
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)

	// 1. Inspect changes.
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/tasks/changes?task=demo-task", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("changes returned %d: %s", rec.Code, rec.Body.String())
	}
	var changes TaskChangesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &changes); err != nil {
		t.Fatal(err)
	}
	if !changes.Available || len(changes.Files) != 2 {
		t.Fatalf("expected 2 changed files, got %+v", changes)
	}

	// 2. Apply changes onto the local git repo.
	bodyBytes, _ := json.Marshal(map[string]string{
		"task":          "demo-task",
		"localRepoPath": repoDir,
	})
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/tasks/apply-local", bytes.NewReader(bodyBytes))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("apply-local returned %d: %s", rec.Code, rec.Body.String())
	}

	readmeAfter, err := os.ReadFile(filepath.Join(repoDir, "README.md"))
	if err != nil || !strings.Contains(string(readmeAfter), "Added by AX agent") {
		t.Fatalf("expected README.md to contain applied agent line, got %q (%v)", string(readmeAfter), err)
	}
	notesAfter, err := os.ReadFile(filepath.Join(repoDir, "notes.txt"))
	if err != nil || strings.TrimSpace(string(notesAfter)) != "hello from sandbox" {
		t.Fatalf("expected untracked notes.txt to be created by git apply, got %q (%v)", string(notesAfter), err)
	}

	// 3. Push the sandbox changes to a branch named after the task.
	bodyBytes, _ = json.Marshal(map[string]string{"task": "demo-task"})
	req = httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/tasks/push-branch", bytes.NewReader(bodyBytes))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	var pushed PushBranchResult
	if err := json.Unmarshal(rec.Body.Bytes(), &pushed); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("push-branch returned %d: %s (%v)", rec.Code, rec.Body.String(), err)
	}
	if pushed.Branch != "ax/demo-task" || pushed.RepoDir != "/workspace" {
		t.Fatalf("unexpected push-branch result: %+v", pushed)
	}
}

// argsRunner reports the arguments of each command it is asked to run.
type argsRunner struct{ ran chan []string }

func (r argsRunner) LookPath(file string) (string, error) { return "/usr/bin/" + file, nil }

func (r argsRunner) Run(_ context.Context, spec kube.Spec) (kube.Result, error) {
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

func TestValidateAXArgs(t *testing.T) {
	sub, err := validateAXArgs([]string{"--context", "local", "-a", "default", "promote", "task", "demo", "--to", "team-gke", "--preflight-only"})
	if err != nil || sub != "promote" {
		t.Fatalf("validateAXArgs(promote) = (%q, %v), want (promote, nil)", sub, err)
	}
	for _, bad := range [][]string{
		nil,
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
