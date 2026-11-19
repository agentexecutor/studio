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

// This file is about an ax that is older than Studio: one without
// `ax local status -o json`. ax can't say then whether AX on this computer is
// set up, so Studio says to update ax, and how, rather than that AX isn't set
// up.

import (
	"os"
	"path/filepath"
	"regexp"
	"runtime/debug"
	"strings"
	"sync"
)

const (
	// stateUnknown is the local cluster's state when ax is too old to report it.
	stateUnknown = "Unknown"
	// axModulePath is the module Studio's ax client comes from.
	axModulePath = "github.com/google/ax"
	// axInstaller is AX's one-line installer, as AX's docs give it.
	axInstaller = "curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | "
)

// AXUpdate says that this ax is too old for Studio, and how to update it.
type AXUpdate struct {
	// Reason is what ax said when Studio asked for its status as JSON.
	Reason string `json:"reason"`
	// Version is the ax this Studio was built against (its go.mod). Empty
	// when the build doesn't say.
	Version string `json:"version,omitempty"`
	// Command installs that ax, or a later one, where Studio runs ax from.
	Command string `json:"command"`
}

// axTooOldError is why `ax local status -o json` failed when ax doesn't know
// the command or one of its flags.
type axTooOldError struct{ reason string }

func (e *axTooOldError) Error() string { return e.reason }

var (
	// axTooOldRe matches what ax prints for a flag or a command it doesn't
	// have: Go's flag package, and cobra's words for the same.
	axTooOldRe = regexp.MustCompile(`(?i)flag provided but not defined|unknown (shorthand )?flag|unknown command`)
	// pseudoVersionRe matches a Go pseudo-version: a commit with no release
	// tag, such as v0.3.2-0.20261118234833-f35661116010.
	pseudoVersionRe = regexp.MustCompile(`\d{14}-[0-9a-f]{12}$`)
	// shellWordRe matches a word the shell reads as it is.
	shellWordRe = regexp.MustCompile(`^[A-Za-z0-9_@%+=:,./-]+$`)
)

// tooOldReason returns the line of ax's output that says it doesn't know a
// flag or a command, without "Error: ", or "" when there is none.
func tooOldReason(output string) string {
	for _, line := range strings.Split(output, "\n") {
		if line = strings.TrimSpace(line); axTooOldRe.MatchString(line) {
			return strings.TrimSpace(strings.TrimPrefix(line, "Error:"))
		}
	}
	return ""
}

// builtAgainstAX is the ax version this Studio was built against, from its
// build info. It is empty when the build doesn't say, or replaces the module.
var builtAgainstAX = sync.OnceValue(func() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return ""
	}
	for _, dep := range info.Deps {
		if dep.Path == axModulePath {
			if dep.Replace != nil {
				return ""
			}
			return dep.Version
		}
	}
	return ""
})

// axUpdate is what the UI shows for an ax that is too old: what it said, and
// the command that installs one that is new enough where Studio runs it from.
func (s *Server) axUpdate(reason string) *AXUpdate {
	version := builtAgainstAX()
	return &AXUpdate{Reason: reason, Version: version, Command: axUpdateCommand(version, s.axInstallDir())}
}

// axInstallDir is the directory of the ax Studio runs (--ax-bin, or the one
// it found), so that an update replaces that one. Else it is ~/.ax/bin.
func (s *Server) axInstallDir() string {
	if filepath.IsAbs(s.axBinary) {
		return filepath.Dir(s.axBinary)
	}
	return defaultAXInstallDir()
}

// defaultAXInstallDir is where install.sh puts ax unless told otherwise.
func defaultAXInstallDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		return ""
	}
	return filepath.Join(home, ".ax", "bin")
}

// axUpdateCommand is the command that installs ax at version, or a later one,
// into dir. A release comes from AX's install.sh: the latest release, or a
// pre-release by name, since the latest release is older than it. A commit
// that has no release yet is built with go install.
func axUpdateCommand(version, dir string) string {
	if pseudoVersionRe.MatchString(version) {
		cmd := "go install " + axModulePath + "/cmd/ax@" + version
		if dir == "" {
			return cmd
		}
		return "GOBIN=" + shellPath(dir) + " " + cmd
	}
	var env []string
	if strings.HasPrefix(version, "v") && strings.Contains(version, "-") {
		env = append(env, "AX_VERSION="+version)
	}
	if dir != "" && dir != defaultAXInstallDir() {
		env = append(env, "AX_INSTALL_DIR="+shellPath(dir))
	}
	return axInstaller + strings.Join(append(env, "sh"), " ")
}

// shellPath writes a path for a shell command: under the home directory as
// "$HOME/...", else quoted when the shell would read it differently.
func shellPath(path string) string {
	home, _ := os.UserHomeDir()
	if home != "" && strings.HasPrefix(path, home+string(filepath.Separator)) {
		if rest := path[len(home):]; shellWordRe.MatchString(rest) {
			return `"$HOME` + rest + `"`
		}
	}
	if shellWordRe.MatchString(path) {
		return path
	}
	return "'" + strings.ReplaceAll(path, "'", `'\''`) + "'"
}
