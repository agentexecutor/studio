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
	"os/exec"
	"os/user"
	"strings"
	"time"
	"unicode/utf8"
)

// userName is the name of the person using this computer, which Home greets.
// Name is empty when this computer doesn't know it; the UI then greets
// without a name rather than guess one from the login.
type userName struct {
	Name string `json:"name"`
	// Source says where Name came from: "account" (the full name on this
	// computer's account), "git" (git's user.name), or "" when neither is set.
	Source string `json:"source"`
}

// maxNameLen caps a name read from the system, in characters.
const maxNameLen = 80

var (
	// accountName returns the full name and the login of the account Studio
	// runs as.
	accountName = func() (name, login string) {
		u, err := user.Current()
		if err != nil {
			return "", ""
		}
		return u.Name, u.Username
	}
	// gitUserName returns git's global user.name, or "".
	gitUserName = func(ctx context.Context) string {
		ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		out, err := exec.CommandContext(ctx, "git", "config", "--global", "user.name").Output()
		if err != nil {
			return ""
		}
		return string(out)
	}
)

// lookupUserName finds the user's name: the account's full name first, then
// git's user.name. A full name that is just the login isn't a name.
func lookupUserName(ctx context.Context) userName {
	full, login := accountName()
	if n := cleanUserName(full); n != "" && !strings.EqualFold(n, login) {
		return userName{Name: n, Source: "account"}
	}
	if n := cleanUserName(gitUserName(ctx)); n != "" && !strings.EqualFold(n, login) {
		return userName{Name: n, Source: "git"}
	}
	return userName{}
}

// cleanUserName keeps the name in a GECOS field ("Full Name,Room,Phone"),
// trimmed, without control characters, and at most maxNameLen characters.
func cleanUserName(s string) string {
	s, _, _ = strings.Cut(s, ",")
	s = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return ' '
		}
		return r
	}, s)
	s = strings.Join(strings.Fields(s), " ")
	if !utf8.ValidString(s) {
		return ""
	}
	if r := []rune(s); len(r) > maxNameLen {
		s = strings.TrimSpace(string(r[:maxNameLen]))
	}
	return s
}

// user reads the user's name the first time Home asks for it. A request that
// goes away doesn't cut the lookup short, since the answer is kept.
func (s *Server) user(ctx context.Context) userName {
	s.userOnce.Do(func() { s.userName = lookupUserName(context.WithoutCancel(ctx)) })
	return s.userName
}
