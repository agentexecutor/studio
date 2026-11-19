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
	"errors"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

// clusterRunner answers the commands a cluster check, the tools check and the
// environment operations run. It records each command line.
type clusterRunner struct {
	mu      sync.Mutex
	calls   []string
	paths   map[string]string             // LookPath answers; missing means not found
	answers func(line string) kube.Result // by the command line, "name arg arg…"
}

func (r *clusterRunner) LookPath(file string) (string, error) {
	if p, ok := r.paths[file]; ok {
		return p, nil
	}
	return "", exec.ErrNotFound
}

func (r *clusterRunner) Run(_ context.Context, spec kube.Spec) (kube.Result, error) {
	line := strings.Join(append([]string{spec.Name}, spec.Args...), " ")
	r.mu.Lock()
	r.calls = append(r.calls, line)
	r.mu.Unlock()
	res := r.answers(line)
	if res.ExitCode != 0 {
		return res, errors.New("exit status 1")
	}
	return res, nil
}

func (r *clusterRunner) called(part string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, c := range r.calls {
		if strings.Contains(c, part) {
			return true
		}
	}
	return false
}

// A cluster that runs Agent Substrate and AX, on an older node kernel, without
// one of the certificate APIs or a default StorageClass.
func teamCluster(line string) kube.Result {
	switch {
	case strings.Contains(line, "version -o json"):
		return kube.Result{Stdout: `{"clientVersion":{"gitVersion":"v1.36.0"},"serverVersion":{"gitVersion":"v1.37.2-gke.1100"}}`}
	case strings.Contains(line, "get nodes"):
		return kube.Result{Stdout: "6.6.0-1012-gke|amd64|True\n6.6.0-1012-gke|amd64|False\n"}
	case strings.Contains(line, "api-resources"):
		return kube.Result{Stdout: "certificatesigningrequests.certificates.k8s.io\nclustertrustbundles.certificates.k8s.io\n"}
	case strings.Contains(line, "get storageclass"):
		return kube.Result{Stdout: "standard-rwo|\n"}
	case strings.Contains(line, "atenet-router"):
		return kube.Result{Stdout: "ate-api-server|3/3\natenet-router|/2\n"}
	case strings.Contains(line, "get workerpools"):
		return kube.Result{Stdout: "2/2\n0/1\n"}
	case strings.Contains(line, "get deployment ax-server"):
		return kube.Result{Stdout: "1/1|ghcr.io/google/ax/ax-server@sha256:abc"}
	}
	return kube.Result{ExitCode: 1, Stderr: "unexpected: " + line}
}

func newEnvTestServer(t *testing.T, r *clusterRunner) *Server {
	t.Helper()
	// The tools and kubectl come from this runner, not from a real ~/.ax/bin.
	t.Setenv("AX_BIN_DIR", t.TempDir())
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", Runner: r, AXBinary: "ax"})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func TestClusterCheckSaysWhatAClusterOffersAndWhatIsOnIt(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: teamCluster}
	srv := newEnvTestServer(t, r)
	c := srv.checkCluster(context.Background(), "gke-team-dev")
	if c.Error != "" || c.Kubernetes != "v1.37.2-gke.1100" {
		t.Fatalf("unexpected check: %+v", c)
	}
	byID := map[string]PreflightItem{}
	for _, it := range c.Requirements {
		byID[it.ID] = it
	}
	for id, want := range map[string]struct{ status, detail string }{
		"version": {"ok", "v1.37.2-gke.1100"},
		"nodes":   {"warn", "1/2 Ready · kernel 6.6.0-1012-gke is older than 6.8"},
		"apis":    {"fail", "doesn't serve podcertificaterequests"},
		"storage": {"warn", "ax-postgres needs one for its 10Gi volume"},
	} {
		got := byID[id]
		if got.Status != want.status || !strings.Contains(got.Detail, want.detail) {
			t.Errorf("%s: got %+v, want %s containing %q", id, got, want.status, want.detail)
		}
	}
	if c.Substrate == nil || *c.Substrate != (Replicas{3, 3}) || c.Router == nil || *c.Router != (Replicas{0, 2}) {
		t.Errorf("Substrate: got %+v and router %+v", c.Substrate, c.Router)
	}
	if c.WorkerPools != (Replicas{1, 2}) {
		t.Errorf("worker pools: got %+v, want 1 of 2 ready", c.WorkerPools)
	}
	if c.AX == nil || *c.AX != (Replicas{1, 1}) || c.AXImage != "ghcr.io/google/ax/ax-server@sha256:abc" {
		t.Errorf("AX: got %+v %q", c.AX, c.AXImage)
	}
	// Every command names the cluster and only reads.
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, line := range r.calls {
		if !strings.Contains(line, "--context gke-team-dev") {
			t.Errorf("a check names the cluster on every call: %s", line)
		}
		for _, verb := range []string{" apply", " delete", " create", " patch", " edit"} {
			if strings.Contains(line, verb+" ") {
				t.Errorf("a check only reads: %s", line)
			}
		}
	}
}

func TestClusterCheckSaysWhyItCouldNotReachTheCluster(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: func(line string) kube.Result {
		return kube.Result{ExitCode: 1, Stdout: `{"clientVersion":{"gitVersion":"v1.36.0"}}`, Stderr: "E1118 reflector\nUnable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout\n"}
	}}
	srv := newEnvTestServer(t, r)
	c := srv.checkCluster(context.Background(), "gke-broken")
	if c.Error != "Unable to connect to the server: dial tcp 34.118.12.7:443: i/o timeout" || len(c.Requirements) != 0 || c.AX != nil {
		t.Errorf("unexpected check: %+v", c)
	}
	// Without kubectl at all, the check says so.
	srv2 := newEnvTestServer(t, &clusterRunner{answers: teamCluster})
	if c := srv2.checkCluster(context.Background(), "gke-team-dev"); !strings.Contains(c.Error, "kubectl isn't installed") {
		t.Errorf("no kubectl: got %+v", c)
	}
}

func TestToolsSayWhereEachIsAndWhatAxDownloads(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"ax": "/opt/ax/bin/ax", "kind": "/usr/local/bin/kind"}, answers: func(line string) kube.Result {
		switch {
		case strings.HasSuffix(line, "ax version"):
			return kube.Result{Stdout: "ax version v1alpha1\n"}
		case strings.HasSuffix(line, "kind version"):
			return kube.Result{Stdout: "kind v0.20.0 go1.21 linux/amd64\n"}
		}
		return kube.Result{ExitCode: 1}
	}}
	srv := newEnvTestServer(t, r)
	tools := srv.collectTools(context.Background(), true)
	want := []ToolInfo{
		{Name: "ax", Version: "v1alpha1", Status: "ok", Detail: "/opt/ax/bin/ax"},
		{Name: "kubectl", Status: "none", Detail: "Not installed. ax downloads it into ~/.ax/bin when you set up AX on this computer."},
		{Name: "kind", Version: "v0.20.0", Status: "warn", Detail: "The kind at /usr/local/bin/kind is older than v0.32.0. ax downloads a newer one into ~/.ax/bin when you set up AX on this computer."},
	}
	if len(tools) != len(want) {
		t.Fatalf("got %+v", tools)
	}
	for i := range want {
		if tools[i] != want[i] {
			t.Errorf("tool %d: got %+v, want %+v", i, tools[i], want[i])
		}
	}
	// Kept for a minute: asking again doesn't run the tools again.
	n := len(r.calls)
	srv.collectTools(context.Background(), false)
	if len(r.calls) != n {
		t.Errorf("expected the tools to be kept, got new calls: %v", r.calls[n:])
	}
	// An ax that can't be found says how to fix it.
	srv2 := newEnvTestServer(t, &clusterRunner{answers: func(string) kube.Result { return kube.Result{ExitCode: 1} }})
	if got := srv2.collectTools(context.Background(), true)[0]; got.Status != "fail" || !strings.Contains(got.Detail, "--ax-bin") {
		t.Errorf("missing ax: got %+v", got)
	}
}

func TestOperationStagesMoveForwardOnAxProgressLinesOnly(t *testing.T) {
	srv := newEnvTestServer(t, &clusterRunner{answers: func(string) kube.Result { return kube.Result{} }})
	done := make(chan struct{})
	_, err := srv.startEnvOperation("local-up", "ax-local", "kind", func(ctx context.Context, w *opLogWriter) error {
		defer close(done)
		for _, l := range []string{
			"==> Creating Kind cluster \"ax-local\"...",
			"    Waiting for Substrate pods", // not an ax step: no stage change
			"==> Installing Agent Substrate v1.0.0 (ate-system)...",
			"==> Creating gVisor WorkerPool \"default\" (1 worker)...",
			"==> Deploying ax-postgres and ax-server (ax-system)...",
			"==> Checking the Kind cluster again", // names an earlier layer: stays on ax
		} {
			_, _ = w.Write([]byte(l + "\n"))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	<-done
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		srv.opMu.Lock()
		st := *srv.currentOp
		srv.opMu.Unlock()
		if st.Status == "ok" {
			if st.Stage != "ax" || st.Step != "Checking the Kind cluster again" || len(st.StageStarted) != 4 {
				t.Errorf("got stage %q, step %q, stages %v", st.Stage, st.Step, st.StageStarted)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the operation didn't finish")
}

func TestUninstallAndCancelGoThroughTheServer(t *testing.T) {
	block := make(chan struct{})
	r := &clusterRunner{answers: func(line string) kube.Result {
		if strings.Contains(line, " uninstall") {
			<-block
		}
		return kube.Result{}
	}}
	srv := newEnvTestServer(t, r)
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	post := func(path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080"+path, strings.NewReader(body))
		req.AddCookie(cookie)
		req.Header.Set(csrfHeaderName, csrf)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post("/api/env/uninstall", `{"context":"--kubeconfig=/etc/x"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("a context that reads as a flag is refused, got %d", rec.Code)
	}
	if rec := post("/api/env/cancel", `{}`); rec.Code != http.StatusConflict {
		t.Errorf("nothing to cancel: got %d", rec.Code)
	}
	rec := post("/api/env/uninstall", `{"context":"gke-team-dev"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("uninstall returned %d: %s", rec.Code, rec.Body.String())
	}
	var op EnvOpSnapshot
	_ = json.Unmarshal(rec.Body.Bytes(), &op)
	if op.Action != "remote-uninstall" || op.Target != "gke-team-dev" {
		t.Errorf("unexpected operation: %+v", op)
	}
	deadline := time.Now().Add(2 * time.Second)
	for !r.called("ax --context gke-team-dev -n ax-system uninstall") && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !r.called("ax --context gke-team-dev -n ax-system uninstall") {
		t.Fatalf("expected ax uninstall on the cluster, got %v", r.calls)
	}
	if rec := post("/api/env/cancel", `{}`); rec.Code != http.StatusOK {
		t.Fatalf("cancel returned %d: %s", rec.Code, rec.Body.String())
	}
	close(block)
	for time.Now().Before(deadline.Add(time.Second)) {
		srv.opMu.Lock()
		st := *srv.currentOp
		srv.opMu.Unlock()
		if st.Status != "running" {
			if st.Status != "failed" || !st.Canceled || st.Error != "Canceled" {
				t.Errorf("a cancelled command ends as Canceled, got %+v", st)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("the cancelled operation didn't end")
}

func TestClusterCheckEndpointNeedsASessionAndAContext(t *testing.T) {
	srv := newEnvTestServer(t, &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: teamCluster})
	h := srv.Handler()
	cookie, _ := bootstrapTestSession(t, h)
	get := func(path string, withCookie bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080"+path, nil)
		if withCookie {
			req.AddCookie(cookie)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := get("/api/env/check?context=gke-team-dev", false); rec.Code != http.StatusUnauthorized {
		t.Errorf("without a session: got %d", rec.Code)
	}
	if rec := get("/api/env/check?context=--kubeconfig", true); rec.Code != http.StatusBadRequest {
		t.Errorf("a context that reads as a flag: got %d", rec.Code)
	}
	rec := get("/api/env/check?context=gke-team-dev", true)
	var c ClusterCheck
	if err := json.Unmarshal(rec.Body.Bytes(), &c); err != nil || rec.Code != http.StatusOK || c.Context != "gke-team-dev" || len(c.Requirements) != 4 {
		t.Errorf("check returned %d: %s", rec.Code, rec.Body.String())
	}
}

func TestLocalUpRecordsWhatItWasStartedFor(t *testing.T) {
	r := &clusterRunner{answers: func(string) kube.Result { return kube.Result{} }}
	srv := newEnvTestServer(t, r)
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	post := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(body))
		req.AddCookie(cookie)
		req.Header.Set(csrfHeaderName, csrf)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := post(`{"purpose":"reinstall everything"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("an unknown purpose is refused, got %d", rec.Code)
	}
	rec := post(`{"purpose":"repair","serverImage":"registry.example.com/ax/ax-server@sha256:` + strings.Repeat("a", 64) + `"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("local up returned %d: %s", rec.Code, rec.Body.String())
	}
	var op EnvOpSnapshot
	_ = json.Unmarshal(rec.Body.Bytes(), &op)
	if op.Action != "local-up" || op.Purpose != "repair" {
		t.Errorf("unexpected operation: %+v", op)
	}
	srv.opWg.Wait()
	srv.opMu.Lock()
	defer srv.opMu.Unlock()
	if srv.currentOp.Purpose != "repair" {
		t.Errorf("the finished operation lost its purpose: %+v", srv.currentOp)
	}
}
