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
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/google/ax/pkg/apis/v1alpha1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// moveStub is an ax-server for one cluster: tasks start suspended, resume to Working and suspend back.
type moveStub struct {
	v1alpha1.UnimplementedAXServer
	mu         sync.Mutex
	tasks      map[string]*v1alpha1.Task
	workspaces map[string]*v1alpha1.Workspace
	gateways   map[string]*v1alpha1.Gateway
	calls      []string
}

func newMoveStub() *moveStub {
	return &moveStub{tasks: map[string]*v1alpha1.Task{}, workspaces: map[string]*v1alpha1.Workspace{}, gateways: map[string]*v1alpha1.Gateway{}}
}

func (s *moveStub) log(c string) { s.calls = append(s.calls, c) }

func (s *moveStub) GetTask(_ context.Context, r *v1alpha1.GetTaskRequest) (*v1alpha1.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t := s.tasks[r.GetAtespace()+"/"+r.GetName()]; t != nil {
		return proto.Clone(t).(*v1alpha1.Task), nil
	}
	return nil, status.Errorf(codes.NotFound, "task %s not found", r.GetName())
}
func (s *moveStub) GetWorkspace(_ context.Context, r *v1alpha1.GetWorkspaceRequest) (*v1alpha1.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if w := s.workspaces[r.GetAtespace()+"/"+r.GetName()]; w != nil {
		return w, nil
	}
	return nil, status.Errorf(codes.NotFound, "workspace %s not found", r.GetName())
}
func (s *moveStub) GetGateway(_ context.Context, r *v1alpha1.GetGatewayRequest) (*v1alpha1.Gateway, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if g := s.gateways[r.GetAtespace()+"/"+r.GetName()]; g != nil {
		return g, nil
	}
	return nil, status.Errorf(codes.NotFound, "gateway %s not found", r.GetName())
}
func (s *moveStub) CreateTask(_ context.Context, r *v1alpha1.CreateTaskRequest) (*v1alpha1.Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := proto.Clone(r.GetTask()).(*v1alpha1.Task)
	if t.GetStatus() != nil || t.GetMetadata().GetUid() != "" {
		return nil, status.Error(codes.InvalidArgument, "status and uid are the server's")
	}
	if g := t.GetSpec().GetGateway().GetName(); g != "" && s.gateways[t.Metadata.Atespace+"/"+g] == nil {
		return nil, status.Errorf(codes.FailedPrecondition, "gateway %s not found", g)
	}
	t.Status = &v1alpha1.TaskStatus{State: v1alpha1.TaskState_TASK_STATE_SUSPENDED}
	s.tasks[t.Metadata.Atespace+"/"+t.Metadata.Name] = t
	s.log("create task " + t.Metadata.Atespace + "/" + t.Metadata.Name)
	return t, nil
}
func (s *moveStub) CreateWorkspace(_ context.Context, r *v1alpha1.CreateWorkspaceRequest) (*v1alpha1.Workspace, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	w := r.GetWorkspace()
	s.workspaces[w.Metadata.Atespace+"/"+w.Metadata.Name] = w
	s.log("create workspace " + w.Metadata.Name)
	return w, nil
}
func (s *moveStub) CreateGateway(_ context.Context, r *v1alpha1.CreateGatewayRequest) (*v1alpha1.Gateway, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	g := r.GetGateway()
	s.gateways[g.Metadata.Atespace+"/"+g.Metadata.Name] = g
	s.log("create gateway " + g.Metadata.Name)
	return g, nil
}
func (s *moveStub) setState(atespace, name string, st v1alpha1.TaskState, verb string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	t := s.tasks[atespace+"/"+name]
	if t == nil {
		return status.Errorf(codes.NotFound, "task %s not found", name)
	}
	t.Status.State = st
	s.log(verb + " " + atespace + "/" + name)
	return nil
}
func (s *moveStub) ResumeTask(_ context.Context, r *v1alpha1.ResumeTaskRequest) (*v1alpha1.Task, error) {
	return nil, s.setState(r.GetAtespace(), r.GetName(), v1alpha1.TaskState_TASK_STATE_WORKING, "resume")
}
func (s *moveStub) SuspendTask(_ context.Context, r *v1alpha1.SuspendTaskRequest) (*v1alpha1.Task, error) {
	return nil, s.setState(r.GetAtespace(), r.GetName(), v1alpha1.TaskState_TASK_STATE_SUSPENDED, "suspend")
}
func (s *moveStub) DeleteTask(_ context.Context, r *v1alpha1.DeleteTaskRequest) (*v1alpha1.DeleteTaskResponse, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.tasks, r.GetAtespace()+"/"+r.GetName())
	s.log("delete " + r.GetAtespace() + "/" + r.GetName())
	return &v1alpha1.DeleteTaskResponse{}, nil
}

func serveStub(t *testing.T, stub v1alpha1.AXServer) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	g := grpc.NewServer()
	v1alpha1.RegisterAXServer(g, stub)
	go func() { _ = g.Serve(ln) }()
	t.Cleanup(g.Stop)
	return "http://" + ln.Addr().String()
}

// newMoveTestServer is Studio with ax-local holding a task (with a Gateway and a workspace) and gke-team-dev empty.
func newMoveTestServer(t *testing.T) (*Server, http.Handler, *http.Cookie, string, *moveStub, *moveStub) {
	t.Helper()
	src, dst := newMoveStub(), newMoveStub()
	task := &v1alpha1.Task{}
	if err := protojson.Unmarshal([]byte(`{"apiVersion":"ax.io/v1alpha1","kind":"Task","metadata":{"name":"fix-tests","atespace":"default","uid":"u-1","labels":{"team":"platform"}},
		"spec":{"sessionId":"s-1","debug":true,"workspace":{"name":"ws-fix"},"gateway":{"name":"gw-fix"},"goal":{"spec":"Fix the tests."}},"status":{"state":"TASK_STATE_WORKING"}}`), task); err != nil {
		t.Fatal(err)
	}
	src.tasks["default/fix-tests"] = task
	src.workspaces["default/ws-fix"] = &v1alpha1.Workspace{Metadata: &v1alpha1.ObjectMeta{Name: "ws-fix", Atespace: "default", Uid: "u-ws"}, Status: &v1alpha1.WorkspaceStatus{Phase: "Ready"}}
	gw := &v1alpha1.Gateway{}
	if err := protojson.Unmarshal([]byte(`{"metadata":{"name":"gw-fix","atespace":"default"},"spec":{"egress":[{"https":{"hostnames":["generativelanguage.googleapis.com"],"effects":{"replaceHeaders":[{"header":"x-goog-api-key","credentialUri":"ate-secret://k8s.io/default/ax-system/gemini-api-creds/GEMINI_API_KEY"}]}}}]}}`), gw); err != nil {
		t.Fatal(err)
	}
	src.gateways["default/gw-fix"] = gw
	addrs := map[string]string{"ax-local": serveStub(t, src), "gke-team-dev": serveStub(t, dst)}
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", ResolveServer: func(o kube.TunnelOptions) (string, error) { return addrs[o.Context], nil }})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	return srv, h, cookie, csrf, src, dst
}

func postMove(t *testing.T, h http.Handler, cookie *http.Cookie, csrf, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/tasks/move", strings.NewReader(body))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func waitOp(t *testing.T, srv *Server) EnvOpSnapshot {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		srv.opMu.Lock()
		st := *srv.currentOp
		st.Logs = append([]string(nil), srv.currentOp.Logs...)
		srv.opMu.Unlock()
		if st.Status != "running" {
			return st
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the operation didn't finish")
	return EnvOpSnapshot{}
}

func TestMoveDryRunSaysWhatItWouldDoAndWhatStopsIt(t *testing.T) {
	_, h, cookie, csrf, _, dst := newMoveTestServer(t)
	rec := postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"gke-team-dev","dryRun":true}`)
	var plan MovePlan
	if err := json.Unmarshal(rec.Body.Bytes(), &plan); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("dry run returned %d: %s", rec.Code, rec.Body.String())
	}
	got := []string{}
	for _, it := range plan.Items {
		got = append(got, it.Kind+":"+it.Name+":"+it.Action)
	}
	if strings.Join(got, ",") != "gateway:gw-fix:create,workspace:ws-fix:create,task:fix-tests:create" || len(plan.Problems) != 0 {
		t.Errorf("plan: %v, problems %v", got, plan.Problems)
	}
	if len(plan.Keys) != 1 || plan.Keys[0] != "gemini-api-creds" || plan.Path != "/workspace" || !plan.Debug {
		t.Errorf("keys %v, path %q, debug %v", plan.Keys, plan.Path, plan.Debug)
	}
	if len(dst.calls) != 0 {
		t.Errorf("a dry run changes nothing there: %v", dst.calls)
	}
	// The same place, and a name that's taken, are problems.
	rec = postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"ax-local","dryRun":true}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &plan)
	if len(plan.Problems) != 1 || !strings.Contains(plan.Problems[0], "Pick another cluster or atespace") {
		t.Errorf("same place: %v", plan.Problems)
	}
	dst.tasks["default/fix-tests"] = &v1alpha1.Task{Metadata: &v1alpha1.ObjectMeta{Name: "fix-tests", Atespace: "default"}, Status: &v1alpha1.TaskStatus{}}
	rec = postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"gke-team-dev","dryRun":true}`)
	_ = json.Unmarshal(rec.Body.Bytes(), &plan)
	if len(plan.Problems) != 1 || !strings.Contains(plan.Problems[0], "Turn on Replace") {
		t.Errorf("taken: %v", plan.Problems)
	}
	if rec := postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"gke-team-dev","original":"vanish"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("an unknown choice for the original is refused, got %d", rec.Code)
	}
}

func TestMoveCopiesWhatTheTaskBindsStartsItThereAndPausesTheOriginal(t *testing.T) {
	srv, h, cookie, csrf, src, dst := newMoveTestServer(t)
	rec := postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"gke-team-dev","toAtespace":"team","original":"suspend"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("move returned %d: %s", rec.Code, rec.Body.String())
	}
	var op EnvOpSnapshot
	_ = json.Unmarshal(rec.Body.Bytes(), &op)
	if op.Action != "task-move" || op.Target != "fix-tests" || op.To != "gke-team-dev/team" {
		t.Errorf("unexpected operation: %+v", op)
	}
	done := waitOp(t, srv)
	if done.Status != "ok" {
		t.Fatalf("move failed: %+v", done)
	}
	if got := strings.Join(dst.calls, ","); got != "create gateway gw-fix,create workspace ws-fix,create task team/fix-tests,resume team/fix-tests" {
		t.Errorf("there: %s", got)
	}
	if got := strings.Join(src.calls, ","); got != "suspend default/fix-tests" {
		t.Errorf("here: %s", got)
	}
	moved := dst.tasks["team/fix-tests"]
	if moved.GetSpec().GetSessionId() != "s-1" || moved.GetMetadata().GetLabels()["team"] != "platform" || moved.GetStatus().GetState() != v1alpha1.TaskState_TASK_STATE_WORKING {
		t.Errorf("the copy keeps its session and labels, and runs: %+v", moved)
	}
	if !strings.Contains(strings.Join(done.Logs, "\n"), "==> Creating the Gateway gw-fix on gke-team-dev (atespace team)") {
		t.Errorf("progress: %v", done.Logs)
	}
}

func TestMoveCanCopyTheFilesAndDeleteTheOriginal(t *testing.T) {
	srv, h, cookie, csrf, src, dst := newMoveTestServer(t)
	var piped []string
	srv.extras.pipeAX = func(_ context.Context, from, to []string) error {
		piped = append(piped, strings.Join(from, " "), strings.Join(to, " "))
		return nil
	}
	// The workspace and Gateway are already there.
	dst.workspaces["default/ws-fix"] = src.workspaces["default/ws-fix"]
	dst.gateways["default/gw-fix"] = src.gateways["default/gw-fix"]
	rec := postMove(t, h, cookie, csrf, `{"context":"ax-local","name":"fix-tests","toContext":"gke-team-dev","original":"delete","copyFiles":true}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("move returned %d: %s", rec.Code, rec.Body.String())
	}
	if done := waitOp(t, srv); done.Status != "ok" {
		t.Fatalf("move failed: %+v", done)
	}
	if got := strings.Join(dst.calls, ","); got != "create task default/fix-tests,resume default/fix-tests,suspend default/fix-tests,resume default/fix-tests" {
		t.Errorf("there: %s", got)
	}
	if len(piped) != 2 || !strings.HasSuffix(piped[0], "--context ax-local -a default ssh fix-tests -- tar cf - -C /workspace .") ||
		!strings.HasSuffix(piped[1], "--context gke-team-dev -a default ssh fix-tests -- tar xf - -C /workspace") {
		t.Errorf("piped: %v", piped)
	}
	if _, ok := src.tasks["default/fix-tests"]; ok {
		t.Errorf("the original is deleted: %v", src.calls)
	}
}

func TestExitCodeOf(t *testing.T) {
	for in, want := range map[string]int{"exit status 2": 2, "starting: no such file": 0, "": 0} {
		var err error
		if in != "" {
			err = errorString(in)
		}
		if got := exitCodeOf(err); got != want {
			t.Errorf("exitCodeOf(%q) = %d, want %d", in, got, want)
		}
	}
}

type errorString string

func (e errorString) Error() string { return string(e) }
