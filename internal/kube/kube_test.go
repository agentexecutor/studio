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

package kube

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

type recordingRunner struct {
	specs []Spec
}

func (r *recordingRunner) LookPath(file string) (string, error) {
	return "/usr/bin/" + file, nil
}

func (r *recordingRunner) Run(_ context.Context, spec Spec) (Result, error) {
	r.specs = append(r.specs, spec)
	return Result{Stdout: "ok\n", ExitCode: 0}, nil
}

func TestValidateName(t *testing.T) {
	for _, valid := range []string{"a", "my-task-1", "local"} {
		if err := ValidateName(valid); err != nil {
			t.Errorf("ValidateName(%q) unexpected error: %v", valid, err)
		}
	}
	for _, invalid := range []string{"", "-flag", "UpperCase", "bad_underscore", strings.Repeat("a", 64)} {
		if err := ValidateName(invalid); err == nil {
			t.Errorf("ValidateName(%q) expected error, got nil", invalid)
		}
	}
}

func TestExecInTaskSandboxPositionalArgs(t *testing.T) {
	rec := &recordingRunner{}
	_, _, _, err := ExecInTaskSandbox(
		context.Background(),
		rec,
		"/usr/local/bin/ax",
		"default",
		"demo-task",
		"local",
		"ax-system",
		[]string{"git", "diff", "--no-index", "--", "/dev/null", "notes with space.txt"},
		"/workspace/repo",
	)
	if err != nil {
		t.Fatalf("ExecInTaskSandbox unexpected error: %v", err)
	}
	if len(rec.specs) != 1 {
		t.Fatalf("expected 1 recorded command, got %d", len(rec.specs))
	}
	wantArgs := []string{
		"--context", "local",
		"-n", "ax-system",
		"-a", "default",
		"ssh", "demo-task", "--",
		"/bin/sh", "-c", `cd "$1" && shift && exec "$@"`, "sh", "/workspace/repo",
		"git", "diff", "--no-index", "--", "/dev/null", "notes with space.txt",
	}
	if !reflect.DeepEqual(rec.specs[0].Args, wantArgs) {
		t.Fatalf("unexpected args:\ngot:  %#v\nwant: %#v", rec.specs[0].Args, wantArgs)
	}
}
