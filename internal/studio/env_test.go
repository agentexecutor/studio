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
	"os/exec"
	"runtime"
	"strings"
	"testing"

	"github.com/agentexecutor/studio/internal/kube"
)

// engineRunner is a computer where nothing runs. installed says whether the
// docker command is on PATH.
type engineRunner struct{ installed bool }

func (r engineRunner) LookPath(file string) (string, error) {
	if file == "podman" || (file == "docker" && !r.installed) {
		return "", exec.ErrNotFound
	}
	return "/usr/bin/" + file, nil
}

func (engineRunner) Run(context.Context, kube.Spec) (kube.Result, error) {
	return kube.Result{ExitCode: 1}, errors.New("not running")
}

// The container runtime check tells an engine that isn't installed from one
// that is installed and stopped: only the second can be started.
func TestEnvStatusContainerRuntimeCheck(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("the check has its own words on macOS")
	}
	t.Setenv("CONTAINER_CLI", "")
	check := func(installed bool) PreflightItem {
		t.Helper()
		srv, err := NewServer(Options{Addr: "127.0.0.1:0", Runner: engineRunner{installed: installed}})
		if err != nil {
			t.Fatal(err)
		}
		status := srv.collectEnvStatus(context.Background())
		if status.CanStartLocal {
			t.Errorf("installed=%v: setup must wait for a running container runtime", installed)
		}
		for _, item := range status.Preflight {
			if item.ID == "container_engine" {
				return item
			}
		}
		t.Fatalf("installed=%v: no container_engine check in %+v", installed, status.Preflight)
		return PreflightItem{}
	}

	missing := check(false)
	if missing.Status != "fail" || missing.Command != "" || !strings.Contains(missing.Detail, "isn't installed") {
		t.Errorf("not installed: got %+v, want a failure that says so and offers no command to start it", missing)
	}
	stopped := check(true)
	if stopped.Status != "fail" || stopped.Command != "sudo systemctl start docker" || strings.Contains(stopped.Detail, "isn't installed") {
		t.Errorf("installed but stopped: got %+v, want the command that starts it", stopped)
	}
}
