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
	"path/filepath"
	"testing"
)

func TestTooOldReason(t *testing.T) {
	for _, tc := range []struct{ name, output, want string }{
		{"go flag package", "Usage:\n  ax local <start|stop|status|delete> [flags]\nError: flag provided but not defined: -o\n", "flag provided but not defined: -o"},
		{"unknown command first", "unknown command: promote\nAX CLI - Autonomous agent execution control\n\nUsage:\n", "unknown command: promote"},
		{"cobra flag", `Error: unknown shorthand flag: 'o' in -o`, "unknown shorthand flag: 'o' in -o"},
		{"another failure", "Error: Cannot connect to the Docker daemon\n", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := tooOldReason(tc.output); got != tc.want {
				t.Errorf("tooOldReason() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestAXUpdateCommand(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	axBin := filepath.Join(home, ".ax", "bin")
	for _, tc := range []struct{ name, version, dir, want string }{
		{"a commit with no release yet is built with go install", "v0.3.2-0.20261118234833-f35661116010", axBin,
			`GOBIN="$HOME/.ax/bin" go install github.com/google/ax/cmd/ax@v0.3.2-0.20261118234833-f35661116010`},
		{"a release comes from install.sh", "v0.4.0", axBin,
			"curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | sh"},
		{"a pre-release is asked for by name", "v0.4.0-rc.1", axBin,
			"curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | AX_VERSION=v0.4.0-rc.1 sh"},
		{"an unknown version takes the latest release", "", axBin,
			"curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | sh"},
		{"another directory replaces the ax there", "v0.4.0", "/opt/ax tools/bin",
			"curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | AX_INSTALL_DIR='/opt/ax tools/bin' sh"},
		{"a directory under home is written with $HOME", "v0.3.2-0.20261118234833-f35661116010", filepath.Join(home, "bin"),
			`GOBIN="$HOME/bin" go install github.com/google/ax/cmd/ax@v0.3.2-0.20261118234833-f35661116010`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := axUpdateCommand(tc.version, tc.dir); got != tc.want {
				t.Errorf("axUpdateCommand(%q, %q) =\n  %s\nwant\n  %s", tc.version, tc.dir, got, tc.want)
			}
		})
	}
}

func TestAXInstallDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if got, want := (&Server{axBinary: "/usr/local/bin/ax"}).axInstallDir(), "/usr/local/bin"; got != want {
		t.Errorf("an ax Studio runs from a path is replaced there: got %q, want %q", got, want)
	}
	if got, want := (&Server{axBinary: "ax"}).axInstallDir(), filepath.Join(home, ".ax", "bin"); got != want {
		t.Errorf("an ax Studio didn't find goes where install.sh puts it: got %q, want %q", got, want)
	}
}
