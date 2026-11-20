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
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/creack/pty"
)

func TestParseSSHSessionArgs(t *testing.T) {
	for _, tc := range []struct {
		args []string
		want sshTarget
	}{
		{[]string{"ssh", "demo"}, sshTarget{task: "demo"}},
		{[]string{"--context", "kind-ax-local", "-a", "default", "ssh", "demo"}, sshTarget{context: "kind-ax-local", atespace: "default", task: "demo"}},
		{[]string{"--context=gke_x", "--atespace=team", "-n", "ax-test", "ssh", "fix-tests-1"}, sshTarget{context: "gke_x", atespace: "team", namespace: "ax-test", task: "fix-tests-1"}},
		{[]string{"--namespace=ax-test", "--atespace", "team", "ssh", "demo"}, sshTarget{atespace: "team", namespace: "ax-test", task: "demo"}},
	} {
		got, err := parseSSHSessionArgs(tc.args)
		if err != nil || got != tc.want {
			t.Errorf("parseSSHSessionArgs(%q) = %+v, %v; want %+v", tc.args, got, err, tc.want)
		}
	}
	for _, bad := range [][]string{
		nil,
		{"--context", "local"},
		{"get", "tasks"},
		{"ssh"},
		{"ssh", "-h"},
		{"ssh", "Demo"},
		{"ssh", "../demo"},
		{"ssh", " demo"},
		// Studio adds the command the sandbox runs; the browser can't.
		{"ssh", "demo", "--", "rm", "-rf", "/"},
		{"ssh", "demo", "ls"},
		{"--context", "-x", "ssh", "demo"},
		{"--context=", "ssh", "demo"},
		{"-a"},
		{"--kubeconfig", "/tmp/x", "ssh", "demo"},
		{"--server", "http://evil", "ssh", "demo"},
	} {
		if err := validateSSHSessionArgs(bad); err == nil {
			t.Errorf("validateSSHSessionArgs(%q) succeeded, want an error", bad)
		}
	}
}

func TestTermShellCommandHasTheFirstSize(t *testing.T) {
	got := termShellCommand(termSize{cols: 132, rows: 43})
	if !strings.Contains(got, "stty rows 43 cols 132") || strings.Contains(got, "ROWS") || strings.Contains(got, "COLS") {
		t.Fatalf("termShellCommand = %q", got)
	}
}

func TestParseTermReport(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want termRemote
		ok   bool
	}{
		{"pty;/dev/pts/3;42", termRemote{mode: "pty", tty: "/dev/pts/3", pid: 42}, true},
		{"line;;7", termRemote{mode: "line", pid: 7}, true},
		// A terminal that isn't a pts, and init's pid, are never used.
		{"pty;/etc/passwd;1", termRemote{mode: "pty"}, true},
		{"pty;/dev/pts/3;-5", termRemote{mode: "pty", tty: "/dev/pts/3"}, true},
		{"vt;/dev/pts/3;42", termRemote{}, false},
		{"pty;/dev/pts/3", termRemote{}, false},
	} {
		got, ok := parseTermReport(tc.in)
		if got != tc.want || ok != tc.ok {
			t.Errorf("parseTermReport(%q) = %+v, %v; want %+v, %v", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

// The sandbox's report is taken out of the output wherever reads split it.
// Before it, ax's own lines get "\r\n"; after it, bytes pass through as they are.
func TestTermOutputTakesOutTheReport(t *testing.T) {
	stream := "connecting\n\x1b]6973;ax-studio;pty;/dev/pts/0;42\x07root@sandbox:/# ls\n"
	for split := 0; split <= len(stream); split++ {
		o := termOutput{scanning: true}
		var shown []byte
		var report string
		for _, part := range []string{stream[:split], stream[split:]} {
			show, r, found := o.feed([]byte(part))
			shown = append(shown, show...)
			if found {
				report = r
			}
		}
		shown = append(shown, o.flush()...)
		if string(shown) != "connecting\r\nroot@sandbox:/# ls\n" || report != "pty;/dev/pts/0;42" {
			t.Fatalf("split at %d: shown %q, report %q", split, shown, report)
		}
	}

	// Output with no report (ax couldn't connect) is shown whole.
	o := termOutput{scanning: true}
	var shown []byte
	for _, part := range []string{"Error: task \"x\" is Suspended\r\n", "try again\n\x1b]69"} {
		show, _, _ := o.feed([]byte(part))
		shown = append(shown, show...)
	}
	shown = append(shown, o.flush()...)
	if string(shown) != "Error: task \"x\" is Suspended\r\ntry again\r\n\x1b]69" {
		t.Fatalf("shown %q", shown)
	}

	// Something that only looks like the start of a report isn't held back for long.
	o = termOutput{scanning: true}
	long := "\x1b]6973;ax-studio;" + strings.Repeat("x", termMarkerMax+10)
	show, _, found := o.feed([]byte(long))
	if found || string(show) != long || o.scanning {
		t.Fatalf("long: found %v, scanning %v, shown %d bytes", found, o.scanning, len(show))
	}
}

// writeFakeAX writes an executable ax that runs body.
func writeFakeAX(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "ax")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	return path
}

// termHarness is a Studio server whose ax is a script, with a browser
// connection to its events.
type termHarness struct {
	t      *testing.T
	srv    *Server
	h      http.Handler
	cookie *http.Cookie
	csrf   string
	events *hubClient
	remote chan []string // commands run in the sandbox
}

func newTermHarness(t *testing.T, axBody string, guest GuestExecFunc) *termHarness {
	t.Helper()
	th := &termHarness{t: t, remote: make(chan []string, 16)}
	if guest == nil {
		guest = func(_ context.Context, _, _, _, _ string, command []string, _ string) (string, string, int, error) {
			th.remote <- command
			return "", "", 0, nil
		}
	}
	srv, err := NewServer(Options{Addr: "127.0.0.1:0", AXBinary: writeFakeAX(t, axBody), AXNamespace: "ax-test", GuestExec: guest})
	if err != nil {
		t.Fatal(err)
	}
	th.srv = srv
	th.h = srv.Handler()
	th.cookie, th.csrf = bootstrapTestSession(t, th.h)
	th.events = &hubClient{ch: make(chan []byte, hubQueue), gone: make(chan struct{})}
	srv.hub.mu.Lock()
	srv.hub.clients[th.events] = struct{}{}
	srv.hub.mu.Unlock()
	t.Cleanup(srv.closeAllSessions)
	return th
}

func (th *termHarness) post(path string, body any) *httptest.ResponseRecorder {
	th.t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		th.t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080"+path, strings.NewReader(string(b)))
	req.AddCookie(th.cookie)
	req.Header.Set(csrfHeaderName, th.csrf)
	rec := httptest.NewRecorder()
	th.h.ServeHTTP(rec, req)
	return rec
}

// output collects what session id shows until it contains want.
func (th *termHarness) output(id, want string) string {
	th.t.Helper()
	var got []byte
	deadline := time.After(10 * time.Second)
	for !strings.Contains(string(got), want) {
		select {
		case msg := <-th.events.ch:
			var ev struct {
				Type    string `json:"type"`
				Payload struct {
					ID   string `json:"id"`
					Data string `json:"data"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(msg, &ev); err != nil {
				th.t.Fatal(err)
			}
			if ev.Type != "sessionData" || ev.Payload.ID != id {
				continue
			}
			b, err := base64.StdEncoding.DecodeString(ev.Payload.Data)
			if err != nil {
				th.t.Fatalf("sessionData is not base64: %v", err)
			}
			got = append(got, b...)
		case <-deadline:
			th.t.Fatalf("waiting for %q, got %q", want, got)
		}
	}
	return string(got)
}

// exit waits for session id's exit and returns its status.
func (th *termHarness) exit(id string) int {
	th.t.Helper()
	deadline := time.After(15 * time.Second)
	for {
		select {
		case msg := <-th.events.ch:
			var ev struct {
				Type    string `json:"type"`
				Payload struct {
					ID     string `json:"id"`
					Status int    `json:"status"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(msg, &ev); err != nil {
				th.t.Fatal(err)
			}
			if ev.Type == "sessionExit" && ev.Payload.ID == id {
				return ev.Payload.Status
			}
		case <-deadline:
			th.t.Fatalf("session %s didn't exit", id)
		}
	}
}

func (th *termHarness) session(id string) *termSession {
	th.srv.sessMu.Lock()
	defer th.srv.sessMu.Unlock()
	return th.srv.sessions[id]
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		b, err := os.ReadFile(path)
		if err == nil && len(b) > 0 {
			return string(b)
		}
		if time.Now().After(deadline) {
			t.Fatalf("reading %s: %v", path, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestTerminalSession(t *testing.T) {
	dir := t.TempDir()
	// Like a shell, it runs lines until "bye"; then, as bash at its prompt
	// would, it takes the next keys and ends.
	th := newTermHarness(t, `printf '%s\n' "$@" > `+dir+`/args
printf 'connecting\n'
printf '\033]6973;ax-studio;pty;/dev/pts/7;4242\007'
printf 'ready\n'
while IFS= read -r line && [ "$line" != bye ]; do
  printf 'got:%s\n' "$line"
done
head -c 2 | od -An -tx1 > `+dir+`/keys
exit 0
`, nil)

	args := []string{"--context", "kind-ax-local", "-a", "default", "ssh", "demo"}
	if rec := th.post("/api/sessions/start", map[string]any{"id": "sh-1", "args": args, "cols": 100, "rows": 30}); rec.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", rec.Code, rec.Body.String())
	}
	out := th.output("sh-1", "ready\n")
	// ax's own line gets "\r\n"; the sandbox's report never reaches the browser.
	if out != "connecting\r\nready\n" {
		t.Fatalf("output = %q", out)
	}
	ran := readFile(t, dir+"/args")
	if !strings.HasPrefix(ran, "-n\nax-test\n--context\nkind-ax-local\n-a\ndefault\nssh\ndemo\n--\n/bin/sh\n-c\n") || !strings.Contains(ran, "stty rows 30 cols 100") {
		t.Fatalf("ax ran with %q", ran)
	}

	// Keystrokes reach the terminal as they are, and it doesn't echo them:
	// the sandbox's terminal does.
	if rec := th.post("/api/sessions/write", map[string]any{"id": "sh-1", "data": "héllo\n"}); rec.Code != http.StatusOK {
		t.Fatalf("write returned %d: %s", rec.Code, rec.Body.String())
	}
	if out := th.output("sh-1", "got:héllo\n"); out != "got:héllo\n" {
		t.Fatalf("output after write = %q", out)
	}
	if rec := th.post("/api/sessions/write", map[string]any{"id": "sh-1", "data": "\u00ffz\n", "binary": true}); rec.Code != http.StatusOK {
		t.Fatalf("binary write returned %d: %s", rec.Code, rec.Body.String())
	}
	if out := th.output("sh-1", "z\n"); out != "got:\xffz\n" {
		t.Fatalf("output after binary write = %q", out)
	}
	for _, bad := range []map[string]any{
		{"id": "sh-1", "data": "€", "binary": true},
	} {
		if rec := th.post("/api/sessions/write", bad); rec.Code != http.StatusBadRequest {
			t.Errorf("write %v returned %d, want 400", bad, rec.Code)
		}
	}
	if rec := th.post("/api/sessions/write", map[string]any{"id": "nope", "data": "x"}); rec.Code != http.StatusNotFound {
		t.Errorf("write to an unknown session returned %d, want 404", rec.Code)
	}

	// A resize sizes the terminal here, and the sandbox's terminal it reported.
	if rec := th.post("/api/sessions/resize", map[string]any{"id": "sh-1", "cols": 120, "rows": 40}); rec.Code != http.StatusOK {
		t.Fatalf("resize returned %d: %s", rec.Code, rec.Body.String())
	}
	ws, err := pty.GetsizeFull(th.session("sh-1").pty)
	if err != nil || ws.Cols != 120 || ws.Rows != 40 {
		t.Fatalf("terminal size = %+v, %v", ws, err)
	}
	select {
	case cmd := <-th.remote:
		if got := strings.Join(cmd, " "); got != `/bin/sh -c stty rows "$1" cols "$2" < "$3" sh 40 120 /dev/pts/7` {
			t.Fatalf("resize ran %q in the sandbox", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the sandbox's terminal wasn't resized")
	}
	for _, bad := range []map[string]any{
		{"id": "sh-1", "cols": 0, "rows": 40},
		{"id": "sh-1", "cols": 80, "rows": -1},
		{"id": "sh-1", "cols": maxTermCols + 1, "rows": 40},
		{"id": "sh-1", "cols": 80, "rows": maxTermRows + 1},
	} {
		if rec := th.post("/api/sessions/resize", bad); rec.Code != http.StatusBadRequest {
			t.Errorf("resize %v returned %d, want 400", bad, rec.Code)
		}
	}
	if rec := th.post("/api/sessions/resize", map[string]any{"id": "nope", "cols": 80, "rows": 24}); rec.Code != http.StatusNotFound {
		t.Errorf("resize of an unknown session returned %d, want 404", rec.Code)
	}

	// Closing types Ctrl-U Ctrl-D, so a shell at its prompt exits on its own.
	if rec := th.post("/api/sessions/write", map[string]any{"id": "sh-1", "data": "bye\n"}); rec.Code != http.StatusOK {
		t.Fatalf("write returned %d", rec.Code)
	}
	if rec := th.post("/api/sessions/close", map[string]any{"id": "sh-1"}); rec.Code != http.StatusOK {
		t.Fatalf("close returned %d: %s", rec.Code, rec.Body.String())
	}
	if code := th.exit("sh-1"); code != 0 {
		t.Fatalf("exit status %d, want 0", code)
	}
	if keys := strings.Join(strings.Fields(readFile(t, dir+"/keys")), " "); keys != "15 04" {
		t.Fatalf("close typed %q, want Ctrl-U Ctrl-D", keys)
	}
	if th.session("sh-1") != nil {
		t.Fatal("the session is still open")
	}
	select {
	case cmd := <-th.remote:
		t.Fatalf("a shell that exits on Ctrl-D needs nothing run in the sandbox, ran %q", cmd)
	default:
	}
}

func TestTerminalSessionStartIsChecked(t *testing.T) {
	th := newTermHarness(t, "exit 0\n", nil)
	for _, tc := range []struct {
		body map[string]any
		want int
	}{
		{map[string]any{"id": "sh-1", "args": []string{"ssh", "demo", "--", "id"}}, http.StatusForbidden},
		{map[string]any{"id": "sh-1", "args": []string{"get", "tasks"}}, http.StatusForbidden},
		{map[string]any{"id": "", "args": []string{"ssh", "demo"}}, http.StatusBadRequest},
		{map[string]any{"id": "sh 1", "args": []string{"ssh", "demo"}}, http.StatusBadRequest},
		{map[string]any{"id": strings.Repeat("a", 97), "args": []string{"ssh", "demo"}}, http.StatusBadRequest},
		{map[string]any{"id": "sh-1", "args": []string{"ssh", "demo"}, "cols": 0, "rows": 24}, http.StatusBadRequest},
		{map[string]any{"id": "sh-1", "args": []string{"ssh", "demo"}, "cols": 80, "rows": 100000}, http.StatusBadRequest},
	} {
		if rec := th.post("/api/sessions/start", tc.body); rec.Code != tc.want {
			t.Errorf("start %v returned %d, want %d: %s", tc.body, rec.Code, tc.want, rec.Body.String())
		}
	}

	// Without the CSRF token nothing starts.
	req := httptest.NewRequest(http.MethodPost, "http://127.0.0.1:8080/api/sessions/start", strings.NewReader(`{"id":"sh-1","args":["ssh","demo"]}`))
	req.AddCookie(th.cookie)
	rec := httptest.NewRecorder()
	th.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("start without a CSRF token returned %d, want 403", rec.Code)
	}
	if th.session("sh-1") != nil {
		t.Error("a session was started")
	}
}

// A shell that ends on its own reports its exit status, with its last output.
func TestTerminalSessionExitStatus(t *testing.T) {
	th := newTermHarness(t, "printf 'Error: task \"demo\" is in state \"Suspended\"\\n'\nexit 3\n", nil)
	if rec := th.post("/api/sessions/start", map[string]any{"id": "sh-2", "args": []string{"ssh", "demo"}}); rec.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", rec.Code, rec.Body.String())
	}
	if out := th.output("sh-2", "\r\n"); out != "Error: task \"demo\" is in state \"Suspended\"\r\n" {
		t.Fatalf("output = %q", out)
	}
	if code := th.exit("sh-2"); code != 3 {
		t.Fatalf("exit status %d, want 3", code)
	}
}

// Without a terminal in the sandbox, the terminal here edits lines and echoes.
func TestTerminalSessionLineMode(t *testing.T) {
	th := newTermHarness(t, `printf '\033]6973;ax-studio;line;;55\007'
printf 'ready\n'
while IFS= read -r line; do
  printf 'got:%s\n' "$line"
done
`, nil)
	if rec := th.post("/api/sessions/start", map[string]any{"id": "sh-3", "args": []string{"ssh", "demo"}}); rec.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", rec.Code, rec.Body.String())
	}
	th.output("sh-3", "ready")
	// Enter sends "\r"; a backspace erases the typo.
	if rec := th.post("/api/sessions/write", map[string]any{"id": "sh-3", "data": "lx\x7fs\r"}); rec.Code != http.StatusOK {
		t.Fatalf("write returned %d", rec.Code)
	}
	if out := th.output("sh-3", "got:ls\r\n"); !strings.HasPrefix(out, "l") {
		t.Fatalf("output = %q, want the typed line echoed first", out)
	}
	// Here Ctrl-D ends ax ssh's input, which ends the shell.
	if rec := th.post("/api/sessions/close", map[string]any{"id": "sh-3"}); rec.Code != http.StatusOK {
		t.Fatalf("close returned %d", rec.Code)
	}
	if code := th.exit("sh-3"); code != 0 {
		t.Fatalf("exit status %d, want 0", code)
	}
}

// A busy shell ignores the end of its input. Closing it stops what holds its
// terminal in the sandbox, which ends ax ssh.
func TestTerminalSessionCloseStopsABusyShell(t *testing.T) {
	dir := t.TempDir()
	var th *termHarness
	th = newTermHarness(t, `echo $$ > `+dir+`/pid
printf '\033]6973;ax-studio;pty;/dev/pts/1;4242\007'
trap '' HUP INT
while :; do sleep 1; done
`, func(_ context.Context, _, _, _, _ string, command []string, _ string) (string, string, int, error) {
		th.remote <- command
		if strings.Contains(strings.Join(command, " "), "kill -9") {
			// The sandbox's terminal is gone, so ax ssh exits.
			pid, _ := strconv.Atoi(strings.TrimSpace(readFile(t, dir+"/pid")))
			_ = syscall.Kill(pid, syscall.SIGKILL)
		}
		return "", "", 0, nil
	})
	if rec := th.post("/api/sessions/start", map[string]any{"id": "sh-4", "args": []string{"ssh", "demo"}}); rec.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", rec.Code, rec.Body.String())
	}
	readFile(t, dir+"/pid")
	deadline := time.Now().Add(5 * time.Second)
	for {
		sess := th.session("sh-4")
		sess.mu.Lock()
		reported := sess.remote.pid == 4242
		sess.mu.Unlock()
		if reported {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the report didn't arrive")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if rec := th.post("/api/sessions/close", map[string]any{"id": "sh-4"}); rec.Code != http.StatusOK {
		t.Fatalf("close returned %d", rec.Code)
	}
	select {
	case cmd := <-th.remote:
		if got := strings.Join(cmd, " "); got != `/bin/sh -c kill -9 "$1" sh 4242` {
			t.Fatalf("close ran %q in the sandbox", got)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("close didn't stop the sandbox's terminal")
	}
	if code := th.exit("sh-4"); code != 128+int(syscall.SIGKILL) {
		t.Fatalf("exit status %d", code)
	}
}

// When nothing else ends it, ax ssh is killed here with its process group.
func TestTerminalSessionCloseKillsTheProcessGroup(t *testing.T) {
	dir := t.TempDir()
	th := newTermHarness(t, `sleep 300 &
echo $! > `+dir+`/child
trap '' HUP INT TERM
while :; do sleep 1; done
`, nil)
	if rec := th.post("/api/sessions/start", map[string]any{"id": "sh-5", "args": []string{"ssh", "demo"}}); rec.Code != http.StatusOK {
		t.Fatalf("start returned %d: %s", rec.Code, rec.Body.String())
	}
	child, err := strconv.Atoi(strings.TrimSpace(readFile(t, dir+"/child")))
	if err != nil {
		t.Fatal(err)
	}
	sess := th.session("sh-5")
	th.srv.sessMu.Lock()
	delete(th.srv.sessions, "sh-5")
	th.srv.sessMu.Unlock()
	start := time.Now()
	th.srv.closeTermSession(sess, 3*time.Second)
	if !sess.waitExit(0) {
		t.Fatal("ax ssh is still running")
	}
	if d := time.Since(start); d > 6*time.Second {
		t.Fatalf("closing took %v", d)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !processGone(child) {
		if time.Now().After(deadline) {
			t.Fatalf("process %d in ax ssh's process group is still running", child)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// processGone says whether pid has exited (a zombie waiting to be reaped counts).
func processGone(pid int) bool {
	if syscall.Kill(pid, 0) != nil {
		return true
	}
	b, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat")
	if err != nil {
		return false
	}
	// The state follows the command name, which is in parentheses.
	s := string(b)
	i := strings.LastIndexByte(s, ')')
	return i > 0 && i+2 < len(s) && s[i+2] == 'Z'
}

// Terminal output waits for a slow browser rather than being dropped.
func TestPublishFlowWaitsForASlowReader(t *testing.T) {
	h := NewHub()
	c := &hubClient{ch: make(chan []byte, 1), gone: make(chan struct{})}
	h.clients[c] = struct{}{}
	got := make(chan int, 100)
	go func() {
		for msg := range c.ch {
			var ev struct {
				Payload int `json:"payload"`
			}
			_ = json.Unmarshal(msg, &ev)
			got <- ev.Payload
			time.Sleep(2 * time.Millisecond)
		}
	}()
	for i := 0; i < 50; i++ {
		h.PublishFlow("sessionData", i)
	}
	for i := 0; i < 50; i++ {
		select {
		case n := <-got:
			if n != i {
				t.Fatalf("event %d arrived as %d", i, n)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("event %d never arrived", i)
		}
	}
	close(c.ch)
}
