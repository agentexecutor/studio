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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/agentexecutor/studio/internal/kube"
)

// localStatusRunner answers `ax local status -o json` with a fixed result.
type localStatusRunner struct {
	stdout, stderr string
	err            error
	args           []string
}

func (r *localStatusRunner) LookPath(file string) (string, error) { return "/usr/bin/" + file, nil }

func (r *localStatusRunner) Run(_ context.Context, spec kube.Spec) (kube.Result, error) {
	if !strings.Contains(strings.Join(spec.Args, " "), "local status") {
		return kube.Result{ExitCode: 1}, errors.New("not stubbed")
	}
	r.args = spec.Args
	return kube.Result{Stdout: r.stdout, Stderr: r.stderr}, r.err
}

func newStatusServer(t *testing.T, runner kube.Runner) *Server {
	t.Helper()
	kubeconfig := filepath.Join(t.TempDir(), "config")
	const contexts = `apiVersion: v1
kind: Config
current-context: ax-local
contexts:
- name: ax-local
  context: {cluster: kind-ax-local, user: kind-ax-local}
- name: team-gke
  context: {cluster: gke-cluster, user: gke-user}
`
	if err := os.WriteFile(kubeconfig, []byte(contexts), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("KUBECONFIG", kubeconfig)
	t.Setenv("KUBECONTEXT", "")
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: "ax", AXNamespace: "ax-test", Runner: runner})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func preflightItem(t *testing.T, resp EnvStatusResponse, id string) PreflightItem {
	t.Helper()
	for _, p := range resp.Preflight {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("no %q preflight item in %+v", id, resp.Preflight)
	return PreflightItem{}
}

func TestEnvStatusFromAXLocalStatus(t *testing.T) {
	runner := &localStatusRunner{stdout: `{
  "name": "ax-local",
  "backend": "kind",
  "state": "Running",
  "kubeContext": "ax-local",
  "nodes": ["ax-local-control-plane"],
  "substrateStatus": "ate-api-server (1/1 available)",
  "axStatus": "ax-server (1/1 available in ax-test)",
  "host": {"runtime": "docker", "kernelVersion": "6.12.5", "memTotalBytes": 8589934592, "rootless": false, "error": "", "warning": ""}
}`}
	resp := newStatusServer(t, runner).collectEnvStatus(context.Background())

	if got, want := strings.Join(runner.args, " "), "-n ax-test local status -o json"; got != want {
		t.Fatalf("ax arguments = %q, want %q", got, want)
	}
	if resp.Local.State != "Running" || resp.Local.KubeContext != "ax-local" || resp.Local.AXStatus != "ax-server (1/1 available in ax-test)" {
		t.Errorf("unexpected local cluster: %+v", resp.Local)
	}
	if resp.ContainerRuntime != "docker" || resp.ContainerKernel != "6.12.5" || resp.ContainerMemBytes != 8589934592 {
		t.Errorf("unexpected container host: runtime=%q kernel=%q mem=%d", resp.ContainerRuntime, resp.ContainerKernel, resp.ContainerMemBytes)
	}
	if item := preflightItem(t, resp, "container_engine"); item.Status != "ok" || item.Detail != "docker ready · kernel 6.12.5 · 8.0 GiB RAM" {
		t.Errorf("unexpected container engine item: %+v", item)
	}

	// The contexts come from the kubeconfig, through the ax client.
	if resp.CurrentContext != "ax-local" || len(resp.Contexts) != 2 {
		t.Fatalf("unexpected contexts: current=%q %+v", resp.CurrentContext, resp.Contexts)
	}
	if c := resp.Contexts[0]; c.Name != "ax-local" || !c.Current || !c.IsLocal {
		t.Errorf("unexpected first context: %+v", c)
	}
	if c := resp.Contexts[1]; c.Name != "team-gke" || c.Cluster != "gke-cluster" || c.Current || c.IsLocal {
		t.Errorf("unexpected second context: %+v", c)
	}
}

func TestEnvStatusHostProblems(t *testing.T) {
	t.Run("host that ax local start would refuse", func(t *testing.T) {
		runner := &localStatusRunner{stdout: `{"name":"N/A","state":"NotFound","kubeContext":"N/A","substrateStatus":"N/A","axStatus":"N/A",
			"host":{"runtime":"","error":"no running container engine found"}}`}
		resp := newStatusServer(t, runner).collectEnvStatus(context.Background())
		item := preflightItem(t, resp, "container_engine")
		if item.Status != "fail" || item.Detail == "" {
			t.Errorf("unexpected container engine item: %+v", item)
		}
		if resp.CanStartLocal || resp.Local.State != stateNotFound {
			t.Errorf("expected a blocked start and no cluster, got canStart=%v local=%+v", resp.CanStartLocal, resp.Local)
		}
	})

	t.Run("warning does not block a start", func(t *testing.T) {
		runner := &localStatusRunner{stdout: `{"state":"NotFound","host":{"runtime":"docker","kernelVersion":"6.12.5","memTotalBytes":4294967296,"warning":"container host has 4.0 GiB RAM"}}`}
		resp := newStatusServer(t, runner).collectEnvStatus(context.Background())
		if item := preflightItem(t, resp, "container_engine"); item.Status != "warn" || item.Detail != "container host has 4.0 GiB RAM" {
			t.Errorf("unexpected container engine item: %+v", item)
		}
	})

	t.Run("ax without a JSON status", func(t *testing.T) {
		runner := &localStatusRunner{stderr: "Usage: ax local ...\nError: flag provided but not defined: -o\n", err: errors.New("exit status 1")}
		resp := newStatusServer(t, runner).collectEnvStatus(context.Background())
		item := preflightItem(t, resp, "container_engine")
		if item.Status != "warn" || !strings.Contains(item.Detail, "flag provided but not defined: -o") {
			t.Errorf("unexpected container engine item: %+v", item)
		}
		if resp.Local.State != stateNotFound || resp.Local.Name != "N/A" {
			t.Errorf("expected the placeholder local cluster, got %+v", resp.Local)
		}
	})
}
