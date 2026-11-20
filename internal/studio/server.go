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

// Package studio serves the local AX Studio Web UI and Backend-for-Frontend
// (BFF) API on 127.0.0.1.
package studio

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/agentexecutor/studio/internal/kube"
	"github.com/agentexecutor/studio/ux"
	axclient "github.com/google/ax/client"
	"github.com/google/ax/pkg/apis/v1alpha1"
)

const (
	// DefaultAddr is the loopback address AX Studio binds to by default.
	DefaultAddr       = "127.0.0.1:8080"
	sessionCookieName = "ax_studio_session"
	csrfHeaderName    = "X-AX-CSRF-Token"
	sessionTTL        = 12 * time.Hour
	maxJSONBodyBytes  = 2 * 1024 * 1024 // 2 MiB cap for YAML manifests / API requests
)

// Options configures a local AX Studio server instance.
type Options struct {
	Addr        string
	AXNamespace string
	AXBinary    string
	// Version is the ax-studio build version, shown in Settings.
	Version string
	// UXFS holds the web UI served at the root. It defaults to the files
	// embedded from the ux directory.
	UXFS          fs.FS
	Runner        kube.Runner
	ResolveServer ServerResolver
	GuestExec     GuestExecFunc
	OnListening   func(boundURL string)
	OnShutdown    func()
}

// Server hosts the AX Studio embedded web app and loopback API endpoints.
//
// TODO(security): Multi-user OAuth/OIDC, MFA, password hashing, and malware/CDR
// file-upload scanning are intentionally omitted because `ax-studio` is a
// single-user local loopback CLI process (127.0.0.1) with no user database or
// arbitrary file-upload storage, authenticated via per-process 256-bit
// cryptographic session + CSRF tokens.
type Server struct {
	addr           string
	axNamespace    string
	axBinary       string
	version        string
	uxFS           fs.FS
	runner         kube.Runner
	resolveServer  ServerResolver
	guestExec      GuestExecFunc
	onListening    func(string)
	onShutdown     func()
	hub            *Hub
	sessionToken   string
	csrfToken      string
	sessionExpires time.Time

	rateMu     sync.Mutex
	rateTokens float64
	rateLast   time.Time

	opMu           sync.Mutex
	currentOp      *EnvOpSnapshot
	opWg           sync.WaitGroup
	shutdownCtx    context.Context
	shutdownCancel context.CancelFunc

	// sessions are the shells open in task sandboxes (terminal.go), by id.
	// termWG counts their goroutines, so shutdown can wait for them.
	sessMu   sync.Mutex
	sessions map[string]*termSession
	termWG   sync.WaitGroup

	// dialMu guards dialLocks, which holds one lock per kube context so that
	// only one caller at a time finds or starts the tunnel to its ax-server.
	dialMu    sync.Mutex
	dialLocks map[string]*sync.Mutex

	// userOnce reads the user's name once, for Home's greeting.
	userOnce sync.Once
	userName userName

	// extras is what the environment checks keep between calls, and the
	// running operation's cancel function.
	extras envExtras
}

// NewServer constructs a configured AX Studio server and initializes its
// ephemeral cryptographic session credentials.
func NewServer(opts Options) (*Server, error) {
	addr := strings.TrimSpace(opts.Addr)
	if addr == "" {
		addr = DefaultAddr
	}
	if err := ValidateLoopbackAddr(addr); err != nil {
		return nil, err
	}

	uxFS := opts.UXFS
	if uxFS == nil {
		uxFS = ux.FS
	}

	runner := opts.Runner
	if runner == nil {
		runner = kube.OSRunner{}
	}

	axBin := strings.TrimSpace(opts.AXBinary)
	if axBin == "" {
		axBin = kube.ResolveAXBinary(runner)
	}

	axNS := strings.TrimSpace(opts.AXNamespace)
	if axNS == "" {
		axNS = v1alpha1.DefaultSystemNamespace
	}

	resolver := opts.ResolveServer
	if resolver == nil {
		resolver = axclient.ServerURL
	}

	guestExec := opts.GuestExec
	if guestExec == nil {
		guestExec = func(ctx context.Context, atespace, taskName, kubeContext, axNamespace string, command []string, cwd string) (string, string, int, error) {
			execCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
			defer cancel()
			return kube.ExecInTaskSandbox(execCtx, runner, axBin, atespace, taskName, kubeContext, axNamespace, command, cwd)
		}
	}

	sessTok, err := generateSecretHex(32)
	if err != nil {
		return nil, fmt.Errorf("generating session secret: %w", err)
	}
	csrfTok, err := generateSecretHex(32)
	if err != nil {
		return nil, fmt.Errorf("generating CSRF secret: %w", err)
	}

	shutCtx, shutCancel := context.WithCancel(context.Background())

	version := strings.TrimSpace(opts.Version)
	if version == "" {
		version = "dev"
	}

	return &Server{
		addr:           addr,
		axNamespace:    axNS,
		axBinary:       axBin,
		version:        version,
		uxFS:           uxFS,
		runner:         runner,
		resolveServer:  resolver,
		guestExec:      guestExec,
		onListening:    opts.OnListening,
		onShutdown:     opts.OnShutdown,
		hub:            NewHub(),
		sessionToken:   sessTok,
		csrfToken:      csrfTok,
		sessionExpires: time.Now().Add(sessionTTL),
		rateTokens:     400,
		rateLast:       time.Now(),
		shutdownCtx:    shutCtx,
		shutdownCancel: shutCancel,
		sessions:       make(map[string]*termSession),
		dialLocks:      make(map[string]*sync.Mutex),
	}, nil
}

// ValidateLoopbackAddr ensures AX Studio never binds to 0.0.0.0 or a non-loopback interface.
func ValidateLoopbackAddr(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid listen address %q: %w", addr, err)
	}
	if host == "" {
		return errors.New("refusing to bind AX Studio to all interfaces; specify 127.0.0.1:<port> or localhost:<port>")
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("refusing to bind AX Studio to non-loopback host %q (must be 127.0.0.1, ::1, or localhost)", host)
	}
	return nil
}

func generateSecretHex(numBytes int) (string, error) {
	buf := make([]byte, numBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// Handler returns the root HTTP handler with security headers, method allow-list,
// rate limiting, Host/Origin validation, and session/CSRF enforcement.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/api/bootstrap", s.handleBootstrap)
	mux.HandleFunc("/api/events", s.requireSession(s.hub.serveSSE))
	mux.HandleFunc("/api/env/status", s.requireSession(s.handleEnvStatus))
	mux.HandleFunc("/api/env/diagnostics", s.requireSession(s.handleDiagnostics))
	mux.HandleFunc("/api/env/local/up", s.requireMutatingAuth(s.handleLocalUp))
	mux.HandleFunc("/api/env/local/stop", s.requireMutatingAuth(s.handleLocalAction("stop")))
	mux.HandleFunc("/api/env/local/delete", s.requireMutatingAuth(s.handleLocalAction("delete")))
	mux.HandleFunc("/api/env/cancel", s.requireMutatingAuth(s.handleEnvCancel))
	mux.HandleFunc("/api/secrets/credential", s.requireMutatingAuth(s.handleCreateCredentialSecret))
	mux.HandleFunc("/api/secrets/credential/status", s.requireSession(s.handleCredentialSecretStatus))
	mux.HandleFunc("/api/tasks", s.requireSession(s.handleListTasks))
	mux.HandleFunc("/api/tasks/get", s.requireSession(s.handleGetTask))
	mux.HandleFunc("/api/gateways/get", s.requireSession(s.handleGetGateway))
	mux.HandleFunc("/api/gateways", s.requireSession(s.handleListGateways))
	mux.HandleFunc("/api/gateways/delete", s.requireMutatingAuth(s.handleDeleteResource("gateway")))
	mux.HandleFunc("/api/workspaces", s.requireSession(s.handleListWorkspaces))
	mux.HandleFunc("/api/models", s.requireSession(s.handleListModels))
	mux.HandleFunc("/api/workspaces/delete", s.requireMutatingAuth(s.handleDeleteResource("workspace")))
	mux.HandleFunc("/api/tasks/suspend", s.requireMutatingAuth(s.handleTaskAction("suspend")))
	mux.HandleFunc("/api/tasks/resume", s.requireMutatingAuth(s.handleTaskAction("resume")))
	mux.HandleFunc("/api/tasks/delete", s.requireMutatingAuth(s.handleTaskAction("delete")))
	mux.HandleFunc("/api/tasks/logs", s.requireSession(s.handleTaskLogs))
	mux.HandleFunc("/api/ax/exec", s.requireMutatingAuth(s.handleAXExec))
	mux.HandleFunc("/api/sessions/start", s.requireMutatingAuth(s.handleSessionStart))
	mux.HandleFunc("/api/sessions/write", s.requireMutatingAuth(s.handleSessionWrite))
	mux.HandleFunc("/api/sessions/resize", s.requireMutatingAuth(s.handleSessionResize))
	mux.HandleFunc("/api/sessions/close", s.requireMutatingAuth(s.handleSessionClose))
	// The web UI is served at the root.
	mux.HandleFunc("/env.js", s.handleEnvJS)
	mux.Handle("/", s.serveUX())

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		setSecurityHeaders(w, strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/healthz" || r.URL.Path == "/env.js")

		// Strict HTTP method allow-list (GET, HEAD, and POST only).
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		// Mitigate DNS rebinding by rejecting non-loopback Host headers.
		if !isLoopbackHostHeader(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}

		// Reject cross-origin browser requests (strict same-origin loopback check).
		if origin := r.Header.Get("Origin"); origin != "" && !isLoopbackOrigin(origin) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}

		if strings.HasPrefix(r.URL.Path, "/api/") && !s.allowRate() {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		mux.ServeHTTP(w, r)
	})
}

// ListenAndServe starts the loopback HTTP server until ctx is cancelled.
func (s *Server) ListenAndServe(ctx context.Context) (string, error) {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return "", fmt.Errorf("listening on %s: %w", s.addr, err)
	}
	boundURL := "http://" + ln.Addr().String()
	if s.onListening != nil {
		s.onListening(boundURL)
	}

	httpSrv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		if serveErr := httpSrv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			errCh <- serveErr
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		if s.onShutdown != nil {
			s.onShutdown()
		}
		s.gracefulCleanup()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutCtx)
		return boundURL, nil
	case serveErr := <-errCh:
		s.gracefulCleanup()
		return boundURL, serveErr
	}
}

func (s *Server) gracefulCleanup() {
	if s.shutdownCancel != nil {
		s.shutdownCancel()
	}
	s.closeAllSessions()
	done := make(chan struct{})
	go func() {
		s.opWg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
	}
}

func setSecurityHeaders(w http.ResponseWriter, noStore bool) {
	// TODO(security): `style-src 'self' 'unsafe-inline'` is required for React
	// component `style={{...}}` attributes and @xterm/xterm viewport sizing;
	// `script-src 'self'` strictly blocks all inline scripts and eval.
	w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
	if noStore {
		w.Header().Set("Cache-Control", "no-store")
	}
}

func isLoopbackHostHeader(hostport string) bool {
	if hostport == "" {
		return false
	}
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func isLoopbackOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	return isLoopbackHostHeader(u.Host)
}

func (s *Server) allowRate() bool {
	s.rateMu.Lock()
	defer s.rateMu.Unlock()
	now := time.Now()
	elapsed := now.Sub(s.rateLast).Seconds()
	s.rateLast = now
	s.rateTokens += elapsed * 200.0
	if s.rateTokens > 400.0 {
		s.rateTokens = 400.0
	}
	if s.rateTokens < 1.0 {
		return false
	}
	s.rateTokens -= 1.0
	return true
}

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if time.Now().After(s.sessionExpires) {
		newSess, err1 := generateSecretHex(32)
		newCSRF, err2 := generateSecretHex(32)
		if err1 == nil && err2 == nil {
			s.sessionToken = newSess
			s.csrfToken = newCSRF
			s.sessionExpires = time.Now().Add(sessionTTL)
		}
	}

	// TODO(security): Cookie `Secure` and `__Host-` prefix require HTTPS; on plain
	// http://127.0.0.1 loopback (RFC 6265bis trustworthy origin), `Secure` is set
	// automatically whenever TLS is present while `HttpOnly` + `SameSite=Strict`
	// are always enforced.
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    s.sessionToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(sessionTTL.Seconds()),
	})

	home, _ := os.UserHomeDir()
	writeJSON(w, http.StatusOK, map[string]any{
		"csrfToken":     s.csrfToken,
		"os":            runtime.GOOS,
		"home":          home,
		"pathSeparator": string(filepath.Separator),
		"axNamespace":   s.axNamespace,
		"version":       "v1alpha1",
		// Shown in Settings: what this Studio is, which ax it runs, and
		// which kubeconfig its clusters come from.
		"studioVersion": s.version,
		"axBinary":      s.axBinary,
		"kubeconfig":    strings.Join(kube.KubeconfigPaths(), string(os.PathListSeparator)),
		// Home greets the user by name, as the account or git knows it.
		"user": s.user(r.Context()),
	})
}

func (s *Server) hasValidSession(r *http.Request) bool {
	if time.Now().After(s.sessionExpires) {
		return false
	}
	c, err := r.Cookie(sessionCookieName)
	if err != nil || c.Value == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(c.Value), []byte(s.sessionToken)) == 1
}

func (s *Server) requireSession(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.hasValidSession(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized studio session; reload page")
			return
		}
		next(w, r)
	}
}

func (s *Server) requireMutatingAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !s.hasValidSession(r) {
			writeError(w, http.StatusUnauthorized, "unauthorized studio session; reload page")
			return
		}
		presentedCSRF := r.Header.Get(csrfHeaderName)
		if presentedCSRF == "" || subtle.ConstantTimeCompare([]byte(presentedCSRF), []byte(s.csrfToken)) != 1 {
			writeError(w, http.StatusForbidden, "missing or invalid CSRF token")
			return
		}
		next(w, r)
	}
}

// serveUX serves the web UI at the root. The UI keeps its place in the URL
// fragment, so every other path is a file or a 404.
func (s *Server) serveUX() http.Handler {
	fileServer := http.FileServer(http.FS(s.uxFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		// The page and its scripts change with every build of this binary
		// and carry no version in their names, so the browser must ask again.
		w.Header().Set("Cache-Control", "no-cache")
		fileServer.ServeHTTP(w, r)
	})
}

// handleEnvJS serves /env.js, the script that tells the web UI a Studio
// server is behind the page. Without it (the copy in the ux directory, sent
// by a plain web server) the UI only says how to start Studio.
func (s *Server) handleEnvJS(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	payload, err := json.Marshal(map[string]any{"server": true})
	if err != nil {
		http.Error(w, "encoding environment", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = fmt.Fprintf(w, "window.AX_STUDIO = %s;\n", payload)
}

func decodeJSONBody(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("empty request body")
	}
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, maxJSONBodyBytes))
	if err := dec.Decode(dst); err != nil {
		if errors.Is(err, io.EOF) {
			return nil
		}
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

func writeJSON(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}
