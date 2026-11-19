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
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
)

// workerLog is what an Agent Substrate worker logs, as recorded on a real cluster: the actor's lifecycle, gVisor
// starting its sandbox, AX's task runner, the agent's own output, another task's line, the worker's own lines, and a
// line that isn't JSON.
const workerLog = `I1118 05:33:51.396061     222 cli.go:282] **************** gVisor ****************
{"logging.googleapis.com/labels":{"ate.actor.name":"fix-flaky","ate.atespace":"default"},"message":"Actor starting","time":"2026-11-18T05:33:41.594500831Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"_sandbox","ate.actor.name":"fix-flaky","ate.atespace":"default"},"message":"I1118 05:33:41.641874     107 cli.go:282] sandbox","time":"2026-11-18T05:33:41.641Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"guest","ate.actor.name":"fix-flaky","ate.atespace":"default"},"message":"I1118 05:33:41.706683     134 cli.go:282] **************** gVisor ****************","time":"2026-11-18T05:33:41.706Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"guest","ate.actor.name":"fix-flaky","ate.atespace":"default"},"message":"time=2026-11-18T05:33:41.943Z level=INFO msg=\"started task command\" pid=9","time":"2026-11-18T05:33:41.944Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"guest","ate.actor.name":"fix-flaky","ate.atespace":"default"},"message":"2026/11/18 05:33:42 ERROR agent failed err=\"tls: failed to verify certificate\"","time":"2026-11-18T05:33:42.258Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"guest","ate.actor.name":"fix-flaky-two","ate.atespace":"default"},"message":"not this task","time":"2026-11-18T05:33:42.300Z"}
{"logging.googleapis.com/labels":{"ate.actor.container.name":"guest","ate.actor.name":"fix-flaky","ate.atespace":"team"},"message":"same name, another atespace","time":"2026-11-18T05:33:42.400Z"}
{"time":"2026-11-18T05:33:42.500Z","level":"INFO","msg":"About to run runsc start fix-flaky","container":"guest"}
`

func TestFilterTaskLogKeepsOneTasksLinesAndSaysWhoPrintedEach(t *testing.T) {
	got := filterTaskLog(workerLog, "default", "fix-flaky", time.Time{})
	want := []TaskLogLine{
		{Time: "2026-11-18T05:33:41.594500831Z", Source: "event", Text: "Actor starting"},
		{Time: "2026-11-18T05:33:41.706Z", Source: "sandbox", Text: "I1118 05:33:41.706683     134 cli.go:282] **************** gVisor ****************"},
		{Time: "2026-11-18T05:33:41.944Z", Source: "runner", Text: `time=2026-11-18T05:33:41.943Z level=INFO msg="started task command" pid=9`},
		{Time: "2026-11-18T05:33:42.258Z", Source: "agent", Text: `2026/11/18 05:33:42 ERROR agent failed err="tls: failed to verify certificate"`},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d lines, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("line %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
	// From a time on: lines of that same second can come again (kubectl reads from the second), earlier ones don't.
	later := filterTaskLog(workerLog, "default", "fix-flaky", time.Date(2026, 11, 18, 5, 33, 42, 100e6, time.UTC))
	if len(later) != 1 || later[0].Source != "agent" {
		t.Errorf("since: got %+v", later)
	}
}

func TestTaskLogsReadsEveryWorkerAndNamesTheCommand(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: func(line string) kube.Result {
		switch {
		case strings.Contains(line, "get pods -A -l ate.dev/worker-pool"):
			return kube.Result{Stdout: "ate-workers\nate-workers\n"}
		case strings.Contains(line, "-n ate-workers logs -l ate.dev/worker-pool"):
			return kube.Result{Stdout: workerLog}
		}
		return kube.Result{ExitCode: 1, Stderr: "unexpected: " + line}
	}}
	srv := newEnvTestServer(t, r)
	h := srv.Handler()
	cookie, _ := bootstrapTestSession(t, h)
	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080"+path, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := get("/api/tasks/logs?context=ax-local&name=Bad_Name"); rec.Code != http.StatusBadRequest {
		t.Errorf("a name that isn't a task's: got %d", rec.Code)
	}
	if rec := get("/api/tasks/logs?context=ax-local&name=fix-flaky&since=yesterday"); rec.Code != http.StatusBadRequest {
		t.Errorf("since that isn't a time: got %d", rec.Code)
	}
	rec := get("/api/tasks/logs?context=ax-local&atespace=default&name=fix-flaky")
	var res TaskLogsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("logs returned %d: %s", rec.Code, rec.Body.String())
	}
	if len(res.Lines) != 4 || len(res.Namespaces) != 1 || res.Namespaces[0] != "ate-workers" {
		t.Errorf("unexpected answer: %+v", res)
	}
	if res.Command != "kubectl --context ax-local -n ate-workers logs -l ate.dev/worker-pool --all-containers --prefix=false --since=24h" {
		t.Errorf("command: %q", res.Command)
	}
	if !r.called("--since=24h") || !r.called("--tail=20000") {
		t.Errorf("expected a bounded read of the last day, got %v", r.calls)
	}
	// A cluster without workers has nothing to read, which isn't an error.
	r2 := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: func(string) kube.Result { return kube.Result{} }}
	srv2 := newEnvTestServer(t, r2)
	res2, err := srv2.taskLogs(t.Context(), "gke-team-dev", "default", "fix-flaky", time.Time{})
	if err != nil || len(res2.Lines) != 0 || res2.Lines == nil || len(res2.Namespaces) != 0 {
		t.Errorf("no workers: %+v, %v", res2, err)
	}
}
