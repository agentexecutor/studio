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
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"

	axclient "github.com/google/ax/client"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/emptypb"
)

// taskStubServer is an ax-server that keeps tasks and gateways in memory.
type taskStubServer struct {
	v1alpha1.UnimplementedAXServer
	mu         sync.Mutex
	tasks      map[string]*v1alpha1.Task
	gateways   map[string]*v1alpha1.Gateway
	workspaces map[string]*v1alpha1.Workspace
	listLimit  int64 // the limit the last ListTasks asked for
}

func (s *taskStubServer) GetGateway(_ context.Context, req *v1alpha1.GetGatewayRequest) (*v1alpha1.Gateway, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.gateways[req.GetAtespace()+"/"+req.GetName()]
	if g == nil {
		return nil, status.Errorf(codes.NotFound, "gateway %s/%s not found", req.GetAtespace(), req.GetName())
	}
	return g, nil
}

func (s *taskStubServer) find(atespace, name string) (*v1alpha1.Task, error) {
	t := s.tasks[atespace+"/"+name]
	if t == nil {
		return nil, status.Errorf(codes.NotFound, "task %s/%s not found", atespace, name)
	}
	return t, nil
}

func (s *taskStubServer) ListTasks(_ context.Context, req *v1alpha1.ListTasksRequest) (*v1alpha1.ListTasksResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	resp := &v1alpha1.ListTasksResponse{}
	s.listLimit = req.GetLimit()
	for _, t := range s.tasks {
		if t.GetMetadata().GetAtespace() == req.GetAtespace() {
			resp.Tasks = append(resp.Tasks, t)
		}
	}
	return resp, nil
}

func (s *taskStubServer) GetTask(_ context.Context, req *v1alpha1.GetTaskRequest) (*v1alpha1.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.find(req.GetAtespace(), req.GetName())
}

func (s *taskStubServer) SuspendTask(_ context.Context, req *v1alpha1.SuspendTaskRequest) (*v1alpha1.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t, err := s.find(req.GetAtespace(), req.GetName())
	if err != nil {
		return nil, err
	}
	t.Status.State = v1alpha1.TaskState_TASK_STATE_SUSPENDED
	return t, nil
}

func (s *taskStubServer) ResumeTask(_ context.Context, req *v1alpha1.ResumeTaskRequest) (*v1alpha1.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.find(req.GetAtespace(), req.GetName()); err != nil {
		return nil, err
	}
	return nil, status.Error(codes.ResourceExhausted, "no free workers available")
}

func (s *taskStubServer) DeleteTask(_ context.Context, req *v1alpha1.DeleteTaskRequest) (*emptypb.Empty, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.find(req.GetAtespace(), req.GetName()); err != nil {
		return nil, err
	}
	delete(s.tasks, req.GetAtespace()+"/"+req.GetName())
	return &emptypb.Empty{}, nil
}

// newTaskTestServer starts a stub ax-server holding one task and returns a
// Studio handler that reaches it, with a session to call it.
func newTaskTestServer(t *testing.T) (http.Handler, *http.Cookie, string, *taskStubServer) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	stub := &taskStubServer{tasks: map[string]*v1alpha1.Task{
		"default/fix-flaky-tests": {
			ApiVersion: "ax.io/v1alpha1",
			Kind:       "Task",
			Metadata:   &v1alpha1.ObjectMeta{Name: "fix-flaky-tests", Atespace: "default"},
			Spec: &v1alpha1.TaskSpec{
				Goal:      &v1alpha1.Goal{Text: "Fix the flaky tests."},
				SessionId: "session-1",
				Debug:     true,
			},
			Status: &v1alpha1.TaskStatus{State: v1alpha1.TaskState_TASK_STATE_WORKING},
		},
	}, gateways: map[string]*v1alpha1.Gateway{}, workspaces: map[string]*v1alpha1.Workspace{
		"default/ws-fix": {ApiVersion: "ax.io/v1alpha1", Kind: "Workspace", Metadata: &v1alpha1.ObjectMeta{Name: "ws-fix", Atespace: "default"},
			Status: &v1alpha1.WorkspaceStatus{Phase: "Failed", LastSetupError: "git clone: repository not found"}},
	}}
	// A Gateway as Studio writes one: the model's host, where the key is added, and the hosts it may reach.
	gw := &v1alpha1.Gateway{}
	if err := protojson.Unmarshal([]byte(`{"apiVersion":"ax.io/v1alpha1","kind":"Gateway","metadata":{"name":"gw-fix","atespace":"default"},
		"spec":{"egress":[{"https":{"hostnames":["generativelanguage.googleapis.com"],"effects":{"replaceHeaders":[{"header":"x-goog-api-key","credentialUri":"ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY"}]}}},
		{"https":{"hostnames":["github.com","pypi.org"]}}]}}`), gw); err != nil {
		t.Fatal(err)
	}
	stub.gateways["default/gw-fix"] = gw
	grpcSrv := grpc.NewServer()
	v1alpha1.RegisterAXServer(grpcSrv, stub)
	go func() { _ = grpcSrv.Serve(ln) }()
	t.Cleanup(grpcSrv.Stop)

	srv, err := NewServer(Options{
		Addr: "127.0.0.1:0",
		ResolveServer: func(context.Context, axclient.Options) (string, error) {
			return "http://" + ln.Addr().String(), nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	return h, cookie, csrf, stub
}

func TestTaskEndpoints(t *testing.T) {
	h, cookie, csrf, stub := newTaskTestServer(t)

	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080"+path, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	post := func(path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080"+path, strings.NewReader(body))
		req.AddCookie(cookie)
		req.Header.Set(csrfHeaderName, csrf)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	type taskDoc struct {
		Kind     string `json:"kind"`
		Metadata struct {
			Name string `json:"name"`
		} `json:"metadata"`
		Spec struct {
			Goal struct {
				Text string `json:"text"`
			} `json:"goal"`
			SessionID string `json:"sessionId"`
			Debug     bool   `json:"debug"`
		} `json:"spec"`
		Status struct {
			State string `json:"state"`
		} `json:"status"`
	}

	// 1. The list carries each task as data: names, the goal and the state by name.
	rec := get("/api/tasks?context=ax-local&atespace=default")
	if rec.Code != http.StatusOK {
		t.Fatalf("list returned %d: %s", rec.Code, rec.Body.String())
	}
	var list struct {
		Tasks []taskDoc `json:"tasks"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decoding list: %v", err)
	}
	if len(list.Tasks) != 1 {
		t.Fatalf("expected 1 task, got %d: %s", len(list.Tasks), rec.Body.String())
	}
	if got := list.Tasks[0]; got.Metadata.Name != "fix-flaky-tests" || got.Spec.Goal.Text != "Fix the flaky tests." ||
		got.Spec.SessionID != "session-1" || !got.Spec.Debug || got.Status.State != "TASK_STATE_WORKING" {
		t.Errorf("unexpected task in list: %+v", got)
	}

	// 2. An atespace with no tasks is an empty list, not null.
	rec = get("/api/tasks?atespace=other")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"tasks":[]`) {
		t.Errorf("expected an empty list for another atespace, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. One task comes as data and as a YAML file in the API's field order.
	rec = get("/api/tasks/get?context=ax-local&name=fix-flaky-tests")
	if rec.Code != http.StatusOK {
		t.Fatalf("get returned %d: %s", rec.Code, rec.Body.String())
	}
	var one struct {
		Task taskDoc `json:"task"`
		YAML string  `json:"yaml"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &one); err != nil {
		t.Fatalf("decoding task: %v", err)
	}
	if one.Task.Kind != "Task" || one.Task.Metadata.Name != "fix-flaky-tests" {
		t.Errorf("unexpected task: %+v", one.Task)
	}
	for _, want := range []string{"apiVersion: ax.io/v1alpha1\n", "kind: Task\n", "\n  name: fix-flaky-tests\n", "\n  debug: true\n", "\n  state: TASK_STATE_WORKING\n"} {
		if !strings.Contains(one.YAML, want) {
			t.Errorf("expected %q in the task file, got:\n%s", want, one.YAML)
		}
	}
	if kind, spec := strings.Index(one.YAML, "kind:"), strings.Index(one.YAML, "spec:"); kind < 0 || spec < kind {
		t.Errorf("expected the task file to keep the API's field order, got:\n%s", one.YAML)
	}
	if strings.ContainsAny(one.YAML, "{}") {
		t.Errorf("expected block-style YAML, got:\n%s", one.YAML)
	}

	// 4. A task that isn't there is a 404 with ax-server's message.
	rec = get("/api/tasks/get?name=missing")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "not found") || !strings.Contains(rec.Body.String(), `"code":"NotFound"`) {
		t.Errorf("expected 404 with ax-server's message, got %d: %s", rec.Code, rec.Body.String())
	}

	// 5. Names that could be read as flags or paths are refused before any call.
	for _, path := range []string{
		"/api/tasks/get?name=--help",
		"/api/tasks/get?name=../x",
		"/api/tasks?context=--kubeconfig",
		"/api/tasks?atespace=Bad_Name",
	} {
		if rec = get(path); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for %s, got %d: %s", path, rec.Code, rec.Body.String())
		}
	}

	// 6. Suspend reaches ax-server.
	rec = post("/api/tasks/suspend", `{"context":"ax-local","atespace":"default","name":"fix-flaky-tests"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("suspend returned %d: %s", rec.Code, rec.Body.String())
	}
	stub.mu.Lock()
	state := stub.tasks["default/fix-flaky-tests"].GetStatus().GetState()
	stub.mu.Unlock()
	if state != v1alpha1.TaskState_TASK_STATE_SUSPENDED {
		t.Errorf("expected the task to be suspended, got %v", state)
	}

	// 7. A refusal from ax-server comes back with its message and code.
	rec = post("/api/tasks/resume", `{"name":"fix-flaky-tests"}`)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "no free workers available") || !strings.Contains(rec.Body.String(), `"code":"ResourceExhausted"`) {
		t.Errorf("expected ax-server's refusal, got %d: %s", rec.Code, rec.Body.String())
	}

	// 8. Changes need the CSRF token, and reads need the session.
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/tasks/delete", strings.NewReader(`{"name":"fix-flaky-tests"}`))
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for a delete without the CSRF token, got %d", rec.Code)
	}
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/tasks", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for a list without a session, got %d", rec.Code)
	}

	// 9. Delete removes the task.
	rec = post("/api/tasks/delete", `{"name":"fix-flaky-tests"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete returned %d: %s", rec.Code, rec.Body.String())
	}
	if rec = get("/api/tasks"); !strings.Contains(rec.Body.String(), `"tasks":[]`) {
		t.Errorf("expected no tasks after the delete, got %s", rec.Body.String())
	}
}

func TestGatewayEndpointSaysWhatATaskCanReach(t *testing.T) {
	h, cookie, _, _ := newTaskTestServer(t)
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080"+path, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}

	// 1. A Gateway comes as data: each rule's hosts, and the header a key is added to.
	rec := get("/api/gateways/get?context=ax-local&atespace=default&name=gw-fix")
	if rec.Code != http.StatusOK {
		t.Fatalf("get returned %d: %s", rec.Code, rec.Body.String())
	}
	var one struct {
		Gateway struct {
			Kind string `json:"kind"`
			Spec struct {
				Egress []struct {
					HTTPS struct {
						Hostnames []string `json:"hostnames"`
						Effects   struct {
							ReplaceHeaders []struct {
								Header string `json:"header"`
							} `json:"replaceHeaders"`
						} `json:"effects"`
					} `json:"https"`
				} `json:"egress"`
			} `json:"spec"`
		} `json:"gateway"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &one); err != nil {
		t.Fatalf("decoding gateway: %v", err)
	}
	g := one.Gateway
	if g.Kind != "Gateway" || len(g.Spec.Egress) != 2 {
		t.Fatalf("unexpected gateway: %s", rec.Body.String())
	}
	if got := g.Spec.Egress[0].HTTPS; strings.Join(got.Hostnames, ",") != "generativelanguage.googleapis.com" ||
		len(got.Effects.ReplaceHeaders) != 1 || got.Effects.ReplaceHeaders[0].Header != "x-goog-api-key" {
		t.Errorf("expected the model's host with its key header, got %+v", got)
	}
	if got := strings.Join(g.Spec.Egress[1].HTTPS.Hostnames, ","); got != "github.com,pypi.org" {
		t.Errorf("expected the allowed hosts, got %q", got)
	}

	// 2. A Gateway that isn't there is a 404 with ax-server's message.
	if rec = get("/api/gateways/get?name=gw-missing"); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "not found") {
		t.Errorf("expected 404 with ax-server's message, got %d: %s", rec.Code, rec.Body.String())
	}

	// 3. Names that could be read as flags or paths are refused before any call, and a session is required.
	for _, path := range []string{"/api/gateways/get?name=--help", "/api/gateways/get?name=../x", "/api/gateways/get?context=--kubeconfig&name=gw-fix"} {
		if rec = get(path); rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400 for %s, got %d: %s", path, rec.Code, rec.Body.String())
		}
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/gateways/get?name=gw-fix", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without a session, got %d", rec.Code)
	}
}

func TestServesWebUIAtRootAndReactPagesUnderClassic(t *testing.T) {
	uxFS := fstest.MapFS{
		"index.html": {Data: []byte("<!doctype html><title>new ux</title>")},
		"env.js":     {Data: []byte("window.AX_STUDIO = null;\n")},
		"app.js":     {Data: []byte("// app\n")},
	}
	reactFS := fstest.MapFS{
		"index.html":    {Data: []byte("<!doctype html><title>react pages</title>")},
		"assets/app.js": {Data: []byte("// react\n")},
	}
	serve := func(h http.Handler, path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080"+path, nil))
		return rec
	}

	srv, err := NewServer(Options{Addr: "127.0.0.1:0", UXFS: uxFS, StaticFS: reactFS})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()

	// The web UI is at the root, under the same strict policy as the API.
	rec := serve(h, "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "new ux") {
		t.Errorf("expected the web UI at /, got %d: %s", rec.Code, rec.Body.String())
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") {
		t.Errorf("expected the strict script policy on the web UI, got %q", csp)
	}
	if rec = serve(h, "/app.js"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "// app") {
		t.Errorf("expected the web UI's script at /app.js, got %d", rec.Code)
	}
	// The UI keeps its place in the URL fragment, so an unknown path is not the page.
	if rec = serve(h, "/tasks/demo"); rec.Code != http.StatusNotFound {
		t.Errorf("expected 404 for an unknown path, got %d", rec.Code)
	}

	// The server answers /env.js itself, in place of the file's "no server" copy.
	rec = serve(h, "/env.js")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/javascript") {
		t.Fatalf("expected /env.js as a script, got %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); !strings.HasPrefix(body, "window.AX_STUDIO = {") || !strings.Contains(body, `"server":true`) || !strings.Contains(body, `"classic":"/classic/"`) {
		t.Errorf("unexpected /env.js: %s", body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("expected /env.js not to be stored, got Cache-Control %q", got)
	}

	// The React pages are under /classic/.
	if rec = serve(h, "/classic/"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "react pages") {
		t.Errorf("expected the React pages at /classic/, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec = serve(h, "/classic/assets/app.js"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "// react") {
		t.Errorf("expected the React bundle under /classic/assets/, got %d", rec.Code)
	}

	// A binary built without the React pages says so, and the web UI isn't offered a link to them.
	srv, err = NewServer(Options{Addr: "127.0.0.1:0", UXFS: uxFS, StaticFS: fstest.MapFS{}})
	if err != nil {
		t.Fatal(err)
	}
	if body := serve(srv.Handler(), "/env.js").Body.String(); strings.Contains(body, "classic") {
		t.Errorf("expected no link to the React pages when they aren't built, got %s", body)
	}
}

func TestEmbeddedWebUIHasNoInlineScripts(t *testing.T) {
	srv, err := NewServer(Options{Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected the embedded web UI at /, got %d", rec.Code)
	}
	page := rec.Body.String()
	// The content security policy only runs scripts loaded from files.
	for _, tag := range strings.Split(page, "<script")[1:] {
		if open := tag[:strings.Index(tag, ">")]; !strings.Contains(open, "src=") {
			t.Errorf("the page has a script written into it, which the content security policy blocks: <script%s>", open)
		}
	}
	for _, src := range []string{`src="boot.js"`, `src="env.js"`, `src="api.js"`, `src="live.js"`, `src="app.js"`} {
		if !strings.Contains(page, src) {
			t.Errorf("expected the page to load %s", src)
		}
	}
}

// A file the agent added in a new directory is a change like any other: it is
// listed with its patch, and the full patch creates it.
func TestTaskChangesListNewFilesInNewDirectories(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("# Demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	runGit("add", "README.md")
	runGit("commit", "-m", "initial")
	if err := os.MkdirAll(filepath.Join(repoDir, "notes", "deep"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repoDir, "notes", "deep", "why.md"), []byte("The clock was read twice.\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	grpcSrv := grpc.NewServer()
	v1alpha1.RegisterAXServer(grpcSrv, &stubAXServer{
		task: &v1alpha1.Task{
			Metadata: &v1alpha1.ObjectMeta{Name: "demo-task", Atespace: "default"},
			Spec:     &v1alpha1.TaskSpec{Debug: true},
			Status:   &v1alpha1.TaskStatus{State: v1alpha1.TaskState_TASK_STATE_WORKING, Actor: "actor-1"},
		},
	})
	go func() { _ = grpcSrv.Serve(ln) }()
	t.Cleanup(grpcSrv.Stop)

	srv, err := NewServer(Options{
		Addr: "127.0.0.1:0",
		ResolveServer: func(context.Context, axclient.Options) (string, error) {
			return "http://" + ln.Addr().String(), nil
		},
		// The sandbox is the repository above: git runs for real.
		GuestExec: func(ctx context.Context, _, _, _, _ string, cmd []string, _ string) (string, string, int, error) {
			c := exec.CommandContext(ctx, cmd[0], cmd[1:]...)
			c.Dir = repoDir
			var stdout, stderr bytes.Buffer
			c.Stdout, c.Stderr = &stdout, &stderr
			err := c.Run()
			var exit *exec.ExitError
			if errors.As(err, &exit) {
				return stdout.String(), stderr.String(), exit.ExitCode(), nil
			}
			return stdout.String(), stderr.String(), 0, err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, _ := bootstrapTestSession(t, h)

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
	if !changes.Available || len(changes.Files) != 1 {
		t.Fatalf("want the one new file, got %+v", changes)
	}
	f := changes.Files[0]
	if f.Path != "notes/deep/why.md" || f.Status != "?" || f.Additions != 1 {
		t.Errorf("new file = %+v, want notes/deep/why.md, status ?, 1 addition", f)
	}
	if !strings.Contains(f.Patch, "+++ b/notes/deep/why.md") || !strings.Contains(changes.FullPatch, "+The clock was read twice.") {
		t.Errorf("the patch should create the file:\n%s", changes.FullPatch)
	}
}
