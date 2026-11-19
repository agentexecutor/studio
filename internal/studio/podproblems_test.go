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

	"github.com/agentexecutor/studio/internal/kube"
)

// stuckPods is a cluster where ax-server's image can't be pulled (the pod
// only says it backs off), Substrate's API server keeps crashing, a worker
// can't be scheduled, and the rest is fine or still starting.
const stuckPods = `{"items":[
 {"metadata":{"namespace":"ax-system","name":"ax-postgres-0"},"status":{"containerStatuses":[{"name":"postgres","image":"postgres:16","state":{"running":{}}}]}},
 {"metadata":{"namespace":"ate-system","name":"ate-api-server-7d9"},"status":{"containerStatuses":[{"name":"api","image":"ghcr.io/agent-substrate/api:v1","state":{"waiting":{"reason":"CrashLoopBackOff","message":"back-off 40s restarting failed container"}},"lastState":{"terminated":{"reason":"Error","exitCode":2,"message":"open /etc/ate/config.yaml: no such file"}}}]}},
 {"metadata":{"namespace":"ate-workers","name":"worker-0"},"status":{"conditions":[{"type":"PodScheduled","status":"False","reason":"Unschedulable","message":"0/1 nodes are available: 1 Insufficient memory."}]}},
 {"metadata":{"namespace":"ax-system","name":"ax-server-5c8"},"status":{"containerStatuses":[{"name":"ax-server","image":"ghcr.io/google/ax/ax-server@sha256:abc","state":{"waiting":{"reason":"ImagePullBackOff","message":"Back-off pulling image \"ghcr.io/google/ax/ax-server@sha256:abc\""}}}]}},
 {"metadata":{"namespace":"ax-system","name":"ax-migrate-1"},"status":{"initContainerStatuses":[{"name":"wait","image":"busybox","state":{"waiting":{"reason":"PodInitializing"}}}]}}
]}`

// pullEvents has an older and a newer pull failure for ax-server.
const pullEvents = `{"items":[
 {"involvedObject":{"kind":"Pod","namespace":"ax-system","name":"ax-server-5c8"},"message":"Failed to pull image \"ghcr.io/google/ax/ax-server@sha256:abc\": old","lastTimestamp":"2026-11-19T10:00:00Z"},
 {"involvedObject":{"kind":"Pod","namespace":"ax-system","name":"ax-server-5c8"},"message":"Failed to pull image \"ghcr.io/google/ax/ax-server@sha256:abc\": rpc error: code = Unknown desc = failed to resolve reference: Head \"https://ghcr.io/v2/google/ax/ax-server/manifests/sha256:abc\": dial tcp 140.82.112.33:443: i/o timeout","lastTimestamp":"2026-11-19T10:04:00Z"},
 {"involvedObject":{"kind":"Pod","namespace":"ax-system","name":"ax-server-5c8"},"message":"Error: ImagePullBackOff","lastTimestamp":"2026-11-19T10:05:00Z"}
]}`

func TestParsePodProblemsPutsPullsFirst(t *testing.T) {
	got := parsePodProblems(stuckPods)
	want := []PodProblem{
		{Namespace: "ax-system", Pod: "ax-server-5c8", Container: "ax-server", Image: "ghcr.io/google/ax/ax-server@sha256:abc", Reason: "ImagePullBackOff", Message: `Back-off pulling image "ghcr.io/google/ax/ax-server@sha256:abc"`},
		{Namespace: "ate-system", Pod: "ate-api-server-7d9", Container: "api", Image: "ghcr.io/agent-substrate/api:v1", Reason: "CrashLoopBackOff", Message: "Last exit: Error, exit code 2. open /etc/ate/config.yaml: no such file"},
		{Namespace: "ate-workers", Pod: "worker-0", Reason: "Unschedulable", Message: "0/1 nodes are available: 1 Insufficient memory."},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d problems, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("problem %d:\n got %+v\nwant %+v", i, got[i], want[i])
		}
	}
	if parsePodProblems("not json") != nil {
		t.Error("output that isn't JSON has no problems")
	}
}

func TestPullErrorsComeFromTheLatestEvent(t *testing.T) {
	problems := parsePodProblems(stuckPods)
	addPullErrors(problems, pullEvents)
	if !strings.HasSuffix(problems[0].Message, "dial tcp 140.82.112.33:443: i/o timeout") {
		t.Errorf("the pull's own error should replace the back-off: %q", problems[0].Message)
	}
	if !strings.HasPrefix(problems[1].Message, "Last exit") {
		t.Errorf("only pulls take a pull event: %q", problems[1].Message)
	}
}

func TestPodProblemHints(t *testing.T) {
	pull := func(msg string) PodProblem {
		return PodProblem{Namespace: "ax-system", Pod: "p", Reason: "ErrImagePull", Message: msg}
	}
	for _, tc := range []struct {
		name  string
		p     PodProblem
		local bool
		want  string
	}{
		{"a registry this computer can't reach", pull("dial tcp 140.82.112.33:443: i/o timeout"), true, "IPv4Forwarding"},
		{"a registry a remote cluster can't reach", pull("TLS handshake timeout"), false, "outbound access"},
		{"a private image", pull("pull access denied, repository does not exist or may require authorization: unauthorized"), false, "credentials"},
		{"an image that isn't there", pull("manifest unknown"), true, "doesn't have this image"},
		{"a pod with no room", PodProblem{Reason: "Unschedulable", Message: "0/1 nodes are available: 1 Insufficient cpu."}, true, "memory or CPU"},
		{"a crash", PodProblem{Namespace: "ate-system", Pod: "api-1", Container: "api", Reason: "CrashLoopBackOff"}, true, "kubectl --context kind-dev -n ate-system logs api-1 -c api --previous"},
		{"something Studio doesn't know", PodProblem{Reason: "CreateContainerConfigError", Message: `secret "x" not found`}, true, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := podProblemHint(tc.p, "kind-dev", tc.local)
			if tc.want == "" && got != "" || !strings.Contains(got, tc.want) {
				t.Errorf("hint = %q, want it to contain %q", got, tc.want)
			}
		})
	}
}

func TestLocalKubeContext(t *testing.T) {
	for name, want := range map[string]string{"": "ax-local", "ax-local": "ax-local", "dev": "kind-dev"} {
		if got := localKubeContext(name); got != want {
			t.Errorf("localKubeContext(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestAllAvailable(t *testing.T) {
	for status, want := range map[string]bool{
		"ax-server (1/1 available in ax-system)": true,
		"ate-api-server (2/2 available)":         true,
		"ax-server (0/1 available in ax-system)": false,
		"ate-api-server (1/2 available)":         false,
		"NotInstalled":                           false,
		"N/A":                                    false,
		"available":                              true,
		"unavailable":                            false,
	} {
		if got := allAvailable(status); got != want {
			t.Errorf("allAvailable(%q) = %v, want %v", status, got, want)
		}
	}
}

// stuckSetup is a computer where `ax local start` times out waiting for
// ax-server, whose image can't be pulled.
func stuckSetup(line string) kube.Result {
	switch {
	case strings.Contains(line, " local start "):
		return kube.Result{ExitCode: 1, Stdout: "==> Deploying ax-postgres and ax-server (ax-system)...\n", Stderr: "error: timed out waiting for the condition\n"}
	case strings.Contains(line, " local status -o json"):
		// The cluster runs, but ax-server isn't available: the failure still stands.
		return kube.Result{Stdout: `{"name":"ax-local","state":"Running","kubeContext":"ax-local","substrateStatus":"ate-api-server (1/1 available)","axStatus":"ax-server (0/1 available in ax-system)","host":{"runtime":"docker"}}`}
	case strings.Contains(line, "get pods -A -o json"):
		return kube.Result{Stdout: stuckPods}
	case strings.Contains(line, "get events -A"):
		return kube.Result{Stdout: pullEvents}
	}
	return kube.Result{}
}

func TestAFailedSetupSaysWhichPodsCantStart(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: stuckSetup}
	srv := newEnvTestServer(t, r)
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(`{"purpose":"setup"}`))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("local up returned %d: %s", rec.Code, rec.Body.String())
	}
	srv.opWg.Wait()

	// The API carries the problems, so an agent reads them as data.
	resp := srv.collectEnvStatus(t.Context())
	op := resp.Operation
	if op == nil || op.Status != "failed" || len(op.Problems) != 3 {
		t.Fatalf("expected a failed setup with 3 problems, got %+v", op)
	}
	first := op.Problems[0]
	if first.Pod != "ax-server-5c8" || !strings.Contains(first.Message, "i/o timeout") || !strings.Contains(first.Hint, "IPv4Forwarding") {
		t.Errorf("the pull that timed out comes first, with its error and a hint: %+v", first)
	}
	body, _ := json.Marshal(op)
	if !strings.Contains(string(body), `"problems":[{"namespace":"ax-system","pod":"ax-server-5c8"`) {
		t.Errorf("the problems are in the operation's JSON: %s", body)
	}
	// Every look at the cluster names the context ax made and only reads.
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, line := range r.calls {
		if strings.HasPrefix(line, "/usr/bin/kubectl") && strings.Contains(line, " get ") && !strings.Contains(line, "--context ax-local") {
			t.Errorf("kubectl names the cluster: %s", line)
		}
	}
}

func TestASetupThatWorksLooksForNothing(t *testing.T) {
	r := &clusterRunner{paths: map[string]string{"kubectl": "/usr/bin/kubectl"}, answers: func(string) kube.Result { return kube.Result{} }}
	srv := newEnvTestServer(t, r)
	h := srv.Handler()
	cookie, csrf := bootstrapTestSession(t, h)
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/env/local/up", strings.NewReader(`{"purpose":"setup"}`))
	req.AddCookie(cookie)
	req.Header.Set(csrfHeaderName, csrf)
	h.ServeHTTP(httptest.NewRecorder(), req)
	srv.opWg.Wait()
	if r.called("get pods -A") {
		t.Error("a setup that worked shouldn't look for pods that can't start")
	}
}
