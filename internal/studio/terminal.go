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
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/creack/pty"
)

// --- Terminal sessions (`ax ssh` only) ---
//
// A shell in a task's sandbox is `ax ssh <task>`, run on this computer under a
// pseudo-terminal. What it prints reaches the browser as "sessionData" events
// carrying base64 of the raw bytes (a character split between two reads
// arrives whole), and keystrokes come back, as they are, in
// POST /api/sessions/write. Ctrl-C and Ctrl-D are keystrokes like any other.
//
// AX runs a command in a sandbox on plain pipes, with no terminal of its own,
// so ax ssh runs termShellScript there. It gives the shell a terminal inside
// the sandbox and tells Studio which one, so a resize can reach it. Without the
// tools for that, the shell runs on the pipes a line at a time, as before.

const (
	defaultTermCols = 80
	defaultTermRows = 24
	maxTermCols     = 1000
	maxTermRows     = 1000
	// maxTermSessions caps the shells open at once across all tasks.
	maxTermSessions = 32
	termReadSize    = 16 * 1024

	// Closing a shell: how long to wait after an end of input for it to exit,
	// and how long the whole close may take before ax ssh is killed here.
	termEOFWait        = 2 * time.Second
	termCloseBudget    = 12 * time.Second
	termShutdownBudget = 3 * time.Second
	// termDrainWait is how long the output may take to finish after ax ssh exits.
	termDrainWait = 2 * time.Second
	// termRemoteTimeout bounds each command Studio runs in the sandbox for a shell.
	termRemoteTimeout = 30 * time.Second
)

var termSessionIDRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$`)

// GuestExecFunc executes a non-interactive command inside a task's sandbox actor.
// A shell uses it to resize the terminal in the sandbox and to stop a busy one.
type GuestExecFunc func(ctx context.Context, atespace, taskName, kubeContext, axNamespace string, command []string, cwd string) (stdout, stderr string, exitCode int, err error)

// termShellScript is what ax ssh runs in the sandbox for a shell. It opens a
// terminal there with util-linux script (or else Python's pty module), reports
// it with a private OSC sequence, ESC ] 6973 ; ax-studio ; pty ; <tty> ; <pid>
// BEL, where pid holds the terminal, and starts bash, or sh. Without either it
// reports line mode and runs sh -i on the pipes. ROWS and COLS are replaced
// with the first size before it runs.
const termShellScript = `inner='stty rows ROWS cols COLS 2>/dev/null; printf "\033]6973;ax-studio;pty;%s;%s\007" "$(tty)" "$PPID"; export TERM=xterm-256color COLORTERM=truecolor; if command -v bash >/dev/null 2>&1; then exec bash -i; fi; exec sh -i'
case "$(script -V 2>/dev/null)" in
*util-linux*) script -qfec "$inner" /dev/null; exit $? ;;
esac
if command -v python3 >/dev/null 2>&1; then
  exec python3 -c 'import pty, sys; pty.spawn(["/bin/sh", "-c", sys.argv[1]])' "$inner"
fi
printf '\033]6973;ax-studio;line;;%s\007' "$$"
exec sh -i
`

func termShellCommand(size termSize) string {
	return strings.NewReplacer("ROWS", strconv.Itoa(size.rows), "COLS", strconv.Itoa(size.cols)).Replace(termShellScript)
}

type termSize struct{ cols, rows int }

func validTermSize(cols, rows int) bool {
	return cols >= 1 && cols <= maxTermCols && rows >= 1 && rows <= maxTermRows
}

// termRemote is what termShellScript reported about the sandbox's end.
type termRemote struct {
	mode string // "pty", or "line" when the shell has no terminal in the sandbox
	tty  string // the sandbox's terminal, such as /dev/pts/0
	pid  int    // the process holding that terminal (or the shell, in line mode)
}

var termTTYRE = regexp.MustCompile(`^/dev/pts/[0-9]{1,6}$`)

// parseTermReport reads "pty;/dev/pts/0;42" or "line;;42".
func parseTermReport(s string) (termRemote, bool) {
	parts := strings.Split(s, ";")
	if len(parts) != 3 || (parts[0] != "pty" && parts[0] != "line") {
		return termRemote{}, false
	}
	r := termRemote{mode: parts[0]}
	if r.mode == "pty" && termTTYRE.MatchString(parts[1]) {
		r.tty = parts[1]
	}
	// Never 1, which is the sandbox's init.
	if pid, err := strconv.Atoi(parts[2]); err == nil && pid > 1 {
		r.pid = pid
	}
	return r, true
}

// sshTarget is the task an `ax ssh` command line from the browser names, and
// the cluster it is on.
type sshTarget struct {
	context, atespace, namespace, task string
}

// parseSSHSessionArgs checks a shell's ax command line from the browser: the
// global flags --context, -a/--atespace and -n/--namespace, then `ssh <task>`
// and nothing after it. Studio adds the command the sandbox runs.
func parseSSHSessionArgs(args []string) (sshTarget, error) {
	var t sshTarget
	set := func(flag, v string) error {
		if strings.TrimSpace(v) == "" || strings.HasPrefix(v, "-") {
			return fmt.Errorf("invalid value for %s", flag)
		}
		switch flag {
		case "--context":
			t.context = v
		case "-a", "--atespace":
			t.atespace = v
		default:
			t.namespace = v
		}
		return nil
	}
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--context" || a == "-a" || a == "--atespace" || a == "-n" || a == "--namespace":
			if i+1 >= len(args) {
				return t, fmt.Errorf("missing value for %s", a)
			}
			if err := set(a, args[i+1]); err != nil {
				return t, err
			}
			i++
		case strings.HasPrefix(a, "--context="), strings.HasPrefix(a, "--atespace="), strings.HasPrefix(a, "--namespace="):
			flag, v, _ := strings.Cut(a, "=")
			if err := set(flag, v); err != nil {
				return t, err
			}
		case a == "ssh":
			if i+1 >= len(args) || strings.HasPrefix(args[i+1], "-") {
				return t, errors.New("missing task name for ssh session")
			}
			name := args[i+1]
			if err := kube.ValidateName(name); err != nil || name != strings.TrimSpace(name) {
				return t, fmt.Errorf("invalid task name %q", name)
			}
			if i+2 != len(args) {
				return t, errors.New("session bridge only permits 'ax ssh <task>', without a command")
			}
			t.task = name
			return t, nil
		default:
			return t, fmt.Errorf("session bridge only permits 'ax ssh', got %q", a)
		}
	}
	return t, errors.New("missing ssh subcommand")
}

func validateSSHSessionArgs(args []string) error {
	_, err := parseSSHSessionArgs(args)
	return err
}

// termSession is one shell: ax ssh, the terminal it runs on, and what its
// sandbox end reported.
type termSession struct {
	id     string
	target sshTarget
	cmd    *exec.Cmd
	pty    *os.File
	cooked *termios // the terminal's own settings, for line mode

	// writeMu keeps writes to the terminal whole and in order.
	writeMu sync.Mutex

	mu       sync.Mutex
	remote   termRemote
	want     termSize // the size the browser asked for last
	applied  termSize // the size the sandbox's terminal has
	resizing bool     // a resize is running in the sandbox
	closing  bool

	seq      atomic.Uint64 // output frames sent
	ended    atomic.Bool   // the exit was sent; output after it is dropped
	readDone chan struct{} // the output has been read to its end
	exited   chan struct{} // ax ssh has exited and the exit was sent
}

type startSessionAPIRequest struct {
	ID   string   `json:"id"`
	Args []string `json:"args"`
	Cols int      `json:"cols"`
	Rows int      `json:"rows"`
}

func (s *Server) handleSessionStart(w http.ResponseWriter, r *http.Request) {
	var req startSessionAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !termSessionIDRE.MatchString(req.ID) {
		writeError(w, http.StatusBadRequest, "invalid session id")
		return
	}
	target, err := parseSSHSessionArgs(req.Args)
	if err != nil {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	size := termSize{cols: defaultTermCols, rows: defaultTermRows}
	if req.Cols != 0 || req.Rows != 0 {
		if !validTermSize(req.Cols, req.Rows) {
			writeError(w, http.StatusBadRequest, "invalid terminal size")
			return
		}
		size = termSize{cols: req.Cols, rows: req.Rows}
	}

	s.sessMu.Lock()
	prev := s.sessions[req.ID]
	delete(s.sessions, req.ID)
	if len(s.sessions) >= maxTermSessions {
		s.sessMu.Unlock()
		if prev != nil {
			go s.closeTermSession(prev, termCloseBudget)
		}
		writeError(w, http.StatusTooManyRequests, "too many shells are open; close one first")
		return
	}
	sess, err := s.startTermSession(req.ID, target, req.Args, size)
	if err == nil {
		s.sessions[req.ID] = sess
	}
	s.sessMu.Unlock()
	if prev != nil {
		go s.closeTermSession(prev, termCloseBudget)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("starting ax ssh failed: %v", err))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": req.ID})
}

// startTermSession starts ax ssh on a new terminal and the goroutines that
// send its output and its exit to the browser.
func (s *Server) startTermSession(id string, target sshTarget, args []string, size termSize) (*termSession, error) {
	ptmx, tty, err := pty.Open()
	if err != nil {
		return nil, fmt.Errorf("opening a terminal: %w", err)
	}
	defer tty.Close()
	fail := func(err error) (*termSession, error) {
		_ = ptmx.Close()
		return nil, err
	}
	cooked, err := getTermios(ptmx)
	if err != nil {
		return fail(fmt.Errorf("reading terminal settings: %w", err))
	}
	// The terminal passes every byte through untouched: the sandbox's own
	// terminal echoes, edits lines and turns Ctrl-C into an interrupt.
	raw := makeRawTermios(*cooked)
	if err := setTermios(ptmx, &raw); err != nil {
		return fail(fmt.Errorf("setting terminal mode: %w", err))
	}
	if err := pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(size.cols), Rows: uint16(size.rows)}); err != nil {
		return fail(fmt.Errorf("sizing the terminal: %w", err))
	}

	argv := append([]string{"-n", s.axNamespace}, args...)
	argv = append(argv, "--", "/bin/sh", "-c", termShellCommand(size))
	cmd := exec.Command(s.axBinary, argv...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = tty, tty, tty
	// A session of its own, with the terminal as its controlling terminal, so
	// its process group can be killed as one.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}
	if err := cmd.Start(); err != nil {
		return fail(err)
	}

	sess := &termSession{
		id:       id,
		target:   target,
		cmd:      cmd,
		pty:      ptmx,
		cooked:   cooked,
		want:     size,
		applied:  size,
		readDone: make(chan struct{}),
		exited:   make(chan struct{}),
	}
	s.termWG.Add(2)
	go func() {
		defer s.termWG.Done()
		s.readTerm(sess)
	}()
	go func() {
		defer s.termWG.Done()
		s.waitTerm(sess)
	}()
	return sess, nil
}

// readTerm sends what ax ssh prints to the browser until the terminal closes.
func (s *Server) readTerm(sess *termSession) {
	defer close(sess.readDone)
	out := termOutput{scanning: true}
	buf := make([]byte, termReadSize)
	for {
		n, err := sess.pty.Read(buf)
		if n > 0 {
			show, report, found := out.feed(buf[:n])
			if found {
				s.applyTermReport(sess, report)
			}
			s.sendTermOutput(sess, show)
		}
		if err != nil {
			s.sendTermOutput(sess, out.flush())
			return
		}
	}
}

func (s *Server) sendTermOutput(sess *termSession, p []byte) {
	if len(p) == 0 || sess.ended.Load() {
		return
	}
	s.hub.PublishFlow("sessionData", map[string]any{
		"id":   sess.id,
		"data": base64.StdEncoding.EncodeToString(p),
		"seq":  sess.seq.Add(1),
	})
}

// applyTermReport acts on what termShellScript reported: a shell without a
// terminal in the sandbox gets this terminal's line editing and echo back, and
// a terminal there gets the size the browser asked for meanwhile.
func (s *Server) applyTermReport(sess *termSession, report string) {
	remote, ok := parseTermReport(report)
	if !ok {
		return
	}
	sess.mu.Lock()
	sess.remote = remote
	start := remote.tty != "" && !sess.resizing && !sess.closing && sess.want != sess.applied
	if start {
		sess.resizing = true
	}
	sess.mu.Unlock()
	if remote.mode == "line" {
		cooked := *sess.cooked
		cooked.Iflag |= termIUTF8
		_ = setTermios(sess.pty, &cooked)
	}
	if start {
		s.termWG.Add(1)
		go func() {
			defer s.termWG.Done()
			s.resizeRemote(sess)
		}()
	}
}

// waitTerm waits for ax ssh to exit, lets its last output through, and tells
// the browser.
func (s *Server) waitTerm(sess *termSession) {
	waitErr := sess.cmd.Wait()
	code := 0
	if waitErr != nil {
		code = 1
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			code = exitErr.ExitCode()
			if ws, ok := exitErr.Sys().(syscall.WaitStatus); ok && ws.Signaled() {
				code = 128 + int(ws.Signal())
			}
		}
	}
	select {
	case <-sess.readDone:
	case <-time.After(termDrainWait):
	}
	sess.ended.Store(true)
	_ = sess.pty.Close()
	s.sessMu.Lock()
	if cur, ok := s.sessions[sess.id]; ok && cur == sess {
		delete(s.sessions, sess.id)
	}
	s.sessMu.Unlock()
	s.hub.PublishFlow("sessionExit", map[string]any{
		"id":     sess.id,
		"status": code,
	})
	close(sess.exited)
}

func (sess *termSession) waitExit(d time.Duration) bool {
	if d <= 0 {
		select {
		case <-sess.exited:
			return true
		default:
			return false
		}
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-sess.exited:
		return true
	case <-t.C:
		return false
	}
}

// sendEOF types Ctrl-U and Ctrl-D: erase what is typed on the line, then end
// the input. A shell at its prompt exits on that, as it does when you type it.
// With a terminal in the sandbox the keys go to it; in line mode the terminal
// here turns them into the end of ax ssh's input. (Switching this terminal to
// line mode for the Ctrl-D wouldn't do: a read already waiting in raw mode
// doesn't end on it.) It can block while the terminal's input is full, so it
// runs on its own.
func (sess *termSession) sendEOF() {
	sess.writeMu.Lock()
	defer sess.writeMu.Unlock()
	_, _ = sess.pty.Write([]byte{0x15, 0x04})
}

// killLocal kills ax ssh and whatever is left in its process group.
func (sess *termSession) killLocal() {
	p := sess.cmd.Process
	if p == nil || sess.waitExit(0) {
		return
	}
	_ = syscall.Kill(-p.Pid, syscall.SIGKILL)
	_ = p.Kill()
}

// closeTermSession ends a shell within budget. First it types Ctrl-U Ctrl-D,
// so a shell at its prompt exits and ax ssh cleans up after itself (its
// kubectl port-forward too). A shell still busy is stopped in the sandbox by
// killing what holds its terminal there, which ends ax ssh the same way. Only
// when that fails is ax ssh killed here, with its process group.
func (s *Server) closeTermSession(sess *termSession, budget time.Duration) {
	sess.mu.Lock()
	if sess.closing {
		sess.mu.Unlock()
		sess.waitExit(budget)
		return
	}
	sess.closing = true
	remote := sess.remote
	sess.mu.Unlock()

	deadline := time.Now().Add(budget)
	go sess.sendEOF()
	if sess.waitExit(min(termEOFWait, budget/3)) {
		return
	}
	if remote.pid > 1 {
		ctx, cancel := context.WithDeadline(context.Background(), deadline.Add(-budget/4))
		_, _, _, _ = s.remoteTermExec(ctx, sess, []string{"/bin/sh", "-c", `kill -9 "$1"`, "sh", strconv.Itoa(remote.pid)})
		cancel()
		if sess.waitExit(time.Until(deadline)) {
			return
		}
	}
	sess.killLocal()
	sess.waitExit(termDrainWait + time.Second)
}

// remoteTermExec runs a command in the shell's sandbox.
func (s *Server) remoteTermExec(ctx context.Context, sess *termSession, command []string) (string, string, int, error) {
	if s.guestExec == nil {
		return "", "", 1, errors.New("guest execution unavailable")
	}
	ns := sess.target.namespace
	if ns == "" {
		ns = s.axNamespace
	}
	return s.guestExec(ctx, sess.target.atespace, sess.target.task, sess.target.context, ns, command, "")
}

// resizeRemote gives the sandbox's terminal the size the browser asked for
// last. ax ssh doesn't pass a size on, so it runs stty in the sandbox, once for
// each run of resizes.
func (s *Server) resizeRemote(sess *termSession) {
	for {
		sess.mu.Lock()
		want, tty := sess.want, sess.remote.tty
		if want == sess.applied || sess.closing || tty == "" {
			sess.resizing = false
			sess.mu.Unlock()
			return
		}
		sess.mu.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), termRemoteTimeout)
		_, _, _, _ = s.remoteTermExec(ctx, sess, []string{"/bin/sh", "-c", `stty rows "$1" cols "$2" < "$3"`, "sh", strconv.Itoa(want.rows), strconv.Itoa(want.cols), tty})
		cancel()
		// A failed resize isn't tried again until the next one.
		sess.mu.Lock()
		sess.applied = want
		sess.mu.Unlock()
	}
}

type sessionInputAPIRequest struct {
	ID   string `json:"id"`
	Data string `json:"data"`
	// Binary says each character of Data is one byte (xterm.js sends some
	// mouse reports this way).
	Binary bool `json:"binary"`
}

func (s *Server) lookupTermSession(id string) *termSession {
	s.sessMu.Lock()
	defer s.sessMu.Unlock()
	return s.sessions[id]
}

func (s *Server) handleSessionWrite(w http.ResponseWriter, r *http.Request) {
	var req sessionInputAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	data := []byte(req.Data)
	if req.Binary {
		data = make([]byte, 0, len(req.Data))
		for _, c := range req.Data {
			if c > 0xff {
				writeError(w, http.StatusBadRequest, "binary data must be bytes")
				return
			}
			data = append(data, byte(c))
		}
	}
	sess := s.lookupTermSession(req.ID)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	sess.writeMu.Lock()
	_, err := sess.pty.Write(data)
	sess.writeMu.Unlock()
	if err != nil {
		writeError(w, http.StatusConflict, "the shell has ended")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type resizeSessionAPIRequest struct {
	ID   string `json:"id"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Server) handleSessionResize(w http.ResponseWriter, r *http.Request) {
	var req resizeSessionAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validTermSize(req.Cols, req.Rows) {
		writeError(w, http.StatusBadRequest, "invalid terminal size")
		return
	}
	sess := s.lookupTermSession(req.ID)
	if sess == nil {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	size := termSize{cols: req.Cols, rows: req.Rows}
	if err := pty.Setsize(sess.pty, &pty.Winsize{Cols: uint16(size.cols), Rows: uint16(size.rows)}); err != nil {
		writeError(w, http.StatusConflict, "the shell has ended")
		return
	}
	sess.mu.Lock()
	sess.want = size
	start := sess.remote.tty != "" && !sess.resizing && !sess.closing && size != sess.applied
	if start {
		sess.resizing = true
	}
	sess.mu.Unlock()
	if start {
		s.termWG.Add(1)
		go func() {
			defer s.termWG.Done()
			s.resizeRemote(sess)
		}()
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type closeSessionAPIRequest struct {
	ID string `json:"id"`
}

func (s *Server) handleSessionClose(w http.ResponseWriter, r *http.Request) {
	var req closeSessionAPIRequest
	if err := decodeJSONBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.sessMu.Lock()
	sess := s.sessions[req.ID]
	delete(s.sessions, req.ID)
	s.sessMu.Unlock()
	if sess != nil {
		go s.closeTermSession(sess, termCloseBudget)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// closeAllSessions ends every shell as Studio shuts down.
func (s *Server) closeAllSessions() {
	s.sessMu.Lock()
	all := make([]*termSession, 0, len(s.sessions))
	for id, sess := range s.sessions {
		all = append(all, sess)
		delete(s.sessions, id)
	}
	s.sessMu.Unlock()
	var wg sync.WaitGroup
	for _, sess := range all {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.closeTermSession(sess, termShutdownBudget)
		}()
	}
	wg.Wait()
	// Shells closed a moment ago may still be finishing.
	done := make(chan struct{})
	go func() {
		s.termWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(termShutdownBudget):
	}
}

// termMarker starts termShellScript's report in the output.
var termMarker = []byte("\x1b]6973;ax-studio;")

// termMarkerMax is the longest report kept back while waiting for its end.
const termMarkerMax = 512

// termOutput turns what ax ssh prints into what the browser shows. Until the
// sandbox reports its terminal, the output is ax's own, such as why it could
// not connect, written to a terminal that changes nothing, so each bare "\n"
// becomes "\r\n" there. The report itself is taken out.
type termOutput struct {
	scanning bool   // the report hasn't come yet
	pending  []byte // bytes kept back that may be the start of the report
	lastCR   bool   // the last byte shown before the report was "\r"
}

// feed returns what to show for p, and the report when p completes it.
func (o *termOutput) feed(p []byte) (show []byte, report string, found bool) {
	if !o.scanning {
		return p, "", false
	}
	buf := append(o.pending, p...)
	o.pending = nil
	if i := bytes.Index(buf, termMarker); i >= 0 {
		end := bytes.IndexByte(buf[i:], '\a')
		if end < 0 {
			if len(buf)-i <= termMarkerMax {
				o.pending = append([]byte(nil), buf[i:]...)
				return o.crlf(buf[:i]), "", false
			}
			o.scanning = false
			return o.crlf(buf), "", false
		}
		report = string(buf[i+len(termMarker) : i+end])
		o.scanning = false
		show = append(o.crlf(buf[:i]), buf[i+end+1:]...)
		return show, report, true
	}
	k := markerPrefixLen(buf)
	if k > 0 {
		o.pending = append([]byte(nil), buf[len(buf)-k:]...)
	}
	return o.crlf(buf[:len(buf)-k]), "", false
}

// flush returns what was kept back, once the output has ended.
func (o *termOutput) flush() []byte {
	if !o.scanning || len(o.pending) == 0 {
		return nil
	}
	p := o.pending
	o.pending = nil
	return o.crlf(p)
}

func (o *termOutput) crlf(p []byte) []byte {
	if len(p) == 0 {
		return nil
	}
	out := make([]byte, 0, len(p)+8)
	for _, b := range p {
		if b == '\n' && !o.lastCR {
			out = append(out, '\r')
		}
		out = append(out, b)
		o.lastCR = b == '\r'
	}
	return out
}

// markerPrefixLen is the length of the longest end of buf that begins termMarker.
func markerPrefixLen(buf []byte) int {
	for k := min(len(buf), len(termMarker)-1); k > 0; k-- {
		if bytes.Equal(buf[len(buf)-k:], termMarker[:k]) {
			return k
		}
	}
	return 0
}
