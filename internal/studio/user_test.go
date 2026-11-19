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
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubUserName makes the account and git say the given names, for one test.
func stubUserName(t *testing.T, full, login, git string) {
	t.Helper()
	oldAccount, oldGit := accountName, gitUserName
	accountName = func() (string, string) { return full, login }
	gitUserName = func(context.Context) string { return git }
	t.Cleanup(func() { accountName, gitUserName = oldAccount, oldGit })
}

func TestLookupUserNamePrefersTheAccountThenGit(t *testing.T) {
	for _, tc := range []struct {
		desc, full, login, git string
		want                   userName
	}{
		{desc: "the account's full name, without the rest of its GECOS field", full: "Ada Lovelace,Room 4,555-0100", login: "ada", git: "Someone Else",
			want: userName{Name: "Ada Lovelace", Source: "account"}},
		{desc: "git's user.name when the account has none", full: "", login: "grace", git: "Grace Hopper\n",
			want: userName{Name: "Grace Hopper", Source: "git"}},
		{desc: "a full name that is only the login is not a name", full: "rajithal", login: "rajithal", git: "",
			want: userName{}},
		{desc: "git's name that is only the login is not a name either", full: "", login: "yuchen", git: "yuchen",
			want: userName{}},
		{desc: "control characters and extra spaces are dropped", full: "  Zhou\tYuchen \x1b[31m ", login: "yz", git: "",
			want: userName{Name: "Zhou Yuchen [31m", Source: "account"}},
		{desc: "nothing known", full: "", login: "x", git: "",
			want: userName{}},
	} {
		t.Run(tc.desc, func(t *testing.T) {
			stubUserName(t, tc.full, tc.login, tc.git)
			if got := lookupUserName(context.Background()); got != tc.want {
				t.Errorf("lookupUserName() = %+v, want %+v", got, tc.want)
			}
		})
	}
	if got := cleanUserName(strings.Repeat("é", 100)); len([]rune(got)) != maxNameLen {
		t.Errorf("expected a long name cut to %d characters, got %d", maxNameLen, len([]rune(got)))
	}
}

func TestBootstrapGreetsTheUserByName(t *testing.T) {
	stubUserName(t, "Rajitha Leonhard,,,", "rajithal", "")
	srv, err := NewServer(Options{Addr: "127.0.0.1:0"})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/api/bootstrap", nil)
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	var body struct {
		User userName `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding bootstrap: %v (%s)", err, rec.Body.String())
	}
	if body.User != (userName{Name: "Rajitha Leonhard", Source: "account"}) {
		t.Errorf("bootstrap user = %+v", body.User)
	}
}
