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
	"strings"
	"testing"

	"github.com/agentexecutor/studio/internal/kube"
)

// secretRunner answers `kubectl get secret` from a fixed set of secrets
// (name -> key names), the way the go-template Studio passes prints them.
type secretRunner struct {
	secrets map[string][]string
	fail    bool
	args    *[]string
}

func (r secretRunner) LookPath(file string) (string, error) { return "/usr/bin/" + file, nil }

func (r secretRunner) Run(_ context.Context, spec kube.Spec) (kube.Result, error) {
	*r.args = spec.Args
	if r.fail {
		return kube.Result{Stderr: "error: the server could not be reached"}, errors.New("exit status 1")
	}
	for i, a := range spec.Args {
		if a == "secret" && i+1 < len(spec.Args) {
			keys, ok := r.secrets[spec.Args[i+1]]
			if !ok {
				return kube.Result{}, nil // --ignore-not-found prints nothing
			}
			return kube.Result{Stdout: "found\n" + strings.Join(keys, "\n") + "\n"}, nil
		}
	}
	return kube.Result{}, errors.New("unexpected command")
}

func TestCredentialSecretStatus(t *testing.T) {
	var args []string
	runner := secretRunner{secrets: map[string][]string{"gemini-api-creds": {"GEMINI_API_KEY"}, "empty": {}}, args: &args}
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "ax", Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	cookie, _ := bootstrapTestSession(t, h)
	get := func(query string) (int, map[string]any) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/secrets/credential/status?"+query, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var body map[string]any
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		return rec.Code, body
	}

	code, body := get("context=ax-local&name=gemini-api-creds&key=GEMINI_API_KEY")
	if code != http.StatusOK || body["exists"] != true || body["hasKey"] != true {
		t.Fatalf("stored key: %d %v", code, body)
	}
	if got := strings.Join(args, " "); !strings.HasPrefix(got, "--context ax-local -n ax-system get secret gemini-api-creds --ignore-not-found -o go-template=") {
		t.Errorf("kubectl arguments = %q", got)
	}
	if strings.Contains(strings.Join(args, " "), "jsonpath") || strings.Contains(strings.Join(args, " "), "-o json") {
		t.Errorf("Studio must not ask kubectl for values: %q", args)
	}
	if code, body := get("name=gemini-api-creds&key=OTHER_KEY"); code != http.StatusOK || body["exists"] != true || body["hasKey"] != false {
		t.Errorf("secret without the key: %d %v", code, body)
	}
	if code, body := get("name=anthropic-api-creds&key=ANTHROPIC_API_KEY"); code != http.StatusOK || body["exists"] != false || body["hasKey"] != false {
		t.Errorf("missing secret: %d %v", code, body)
	}
	for _, bad := range []string{"name=Bad_Name&key=K", "name=ok&key=bad%20key", "name=ok&key=K&context=--kubeconfig=/x"} {
		if code, _ := get(bad); code != http.StatusBadRequest {
			t.Errorf("%s: got %d, want 400", bad, code)
		}
	}

	// Without a session, nothing is read.
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/secrets/credential/status?name=gemini-api-creds&key=GEMINI_API_KEY", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("without a session: got %d, want 401", rec.Code)
	}

	// A cluster that can't be reached says why.
	failing, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "ax", Runner: secretRunner{fail: true, args: &args}})
	if err != nil {
		t.Fatal(err)
	}
	fh := failing.Handler()
	fc, _ := bootstrapTestSession(t, fh)
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/secrets/credential/status?name=gemini-api-creds&key=GEMINI_API_KEY", nil)
	req.AddCookie(fc)
	rec = httptest.NewRecorder()
	fh.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "could not be reached") {
		t.Errorf("unreachable cluster: %d %s", rec.Code, rec.Body.String())
	}
}
