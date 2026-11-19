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

// Command ax-studio launches the AX Studio local Web UI and loopback BFF server.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	iofs "io/fs"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"
	"time"

	"github.com/agentexecutor/studio/internal/studio"
	"github.com/google/ax/pkg/apis/v1alpha1"
)

var version = "dev"

const usage = `Usage:
  ax-studio [flags]

Launch the AX Studio local Web UI in your browser (127.0.0.1 only).
From AX Studio you can start or manage the local sandbox environment, connect
to a remote team cluster, compose and run tasks, review sandbox Git diffs, and
promote tasks across clusters.

Flags:
  --port int             Loopback port to listen on (default: 8080)
  --addr string          Explicit loopback address (overrides --port, e.g. "127.0.0.1:8080")
  -n, --namespace string AX system namespace on Kubernetes clusters (default: "ax-system")
  --ax-bin string        Explicit path to the ax CLI binary (defaults to ~/.ax/bin/ax or PATH)
  --ux-dir string        Serve the web UI from this directory instead of the built-in copy (for working on ux/)
  --no-open              Do not open a browser automatically (for SSH/remote sessions or scripts)
  --version              Print version and exit`

type cliFlags struct {
	port        int
	addr        string
	axNamespace string
	axBin       string
	uxDir       string
	noOpen      bool
	showVersion bool
	help        bool
}

func parseArgs(args []string) (cliFlags, error) {
	fs := flag.NewFlagSet("ax-studio", flag.ContinueOnError)
	fs.SetOutput(io.Discard)

	var out cliFlags
	fs.IntVar(&out.port, "port", 8080, "loopback port")
	fs.StringVar(&out.addr, "addr", "", "explicit loopback address")
	fs.StringVar(&out.axNamespace, "n", v1alpha1.DefaultSystemNamespace, "AX system namespace")
	fs.StringVar(&out.axNamespace, "namespace", v1alpha1.DefaultSystemNamespace, "AX system namespace")
	fs.StringVar(&out.axBin, "ax-bin", "", "explicit path to ax CLI")
	fs.StringVar(&out.uxDir, "ux-dir", "", "serve the web UI from this directory")
	fs.BoolVar(&out.noOpen, "no-open", false, "do not open browser")
	fs.BoolVar(&out.showVersion, "version", false, "print version")
	fs.BoolVar(&out.help, "h", false, "help")
	fs.BoolVar(&out.help, "help", false, "help")

	if err := fs.Parse(args); err != nil {
		return cliFlags{}, err
	}
	if fs.NArg() > 0 {
		return cliFlags{}, fmt.Errorf("unexpected argument %q", fs.Arg(0))
	}
	return out, nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	parsed, err := parseArgs(args)
	if err != nil {
		fmt.Fprintln(os.Stderr, usage)
		return err
	}
	if parsed.help {
		fmt.Println(usage)
		return nil
	}
	if parsed.showVersion {
		fmt.Printf("ax-studio %s\n", version)
		return nil
	}

	addr := parsed.addr
	if addr == "" {
		if parsed.port < 0 || parsed.port > 65535 {
			return fmt.Errorf("invalid port %d", parsed.port)
		}
		addr = net.JoinHostPort("127.0.0.1", strconv.Itoa(parsed.port))
	}

	// The web UI has no build step, so a checkout's ux directory can be served
	// as it is: edit a file and reload the page.
	var uxFS iofs.FS
	if parsed.uxDir != "" {
		if _, err := os.Stat(filepath.Join(parsed.uxDir, "index.html")); err != nil {
			return fmt.Errorf("--ux-dir %q has no index.html: %w", parsed.uxDir, err)
		}
		uxFS = os.DirFS(parsed.uxDir)
	}

	srv, err := studio.NewServer(studio.Options{
		Addr:        addr,
		AXNamespace: parsed.axNamespace,
		AXBinary:    parsed.axBin,
		Version:     version,
		UXFS:        uxFS,
		OnListening: func(boundURL string) {
			fmt.Printf("==> AX Studio running at %s (press Ctrl-C to stop)\n", boundURL)
			if !parsed.noOpen && os.Getenv("AX_STUDIO_NO_OPEN") != "1" {
				go func() {
					time.Sleep(150 * time.Millisecond)
					tryOpenBrowser(boundURL)
				}()
			}
		},
		OnShutdown: func() {
			fmt.Fprintln(os.Stderr, "\n==> Shutting down AX Studio web UI (running clusters and tasks remain active)...")
		},
	})
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	_, err = srv.ListenAndServe(ctx)
	return err
}

func tryOpenBrowser(targetURL string) {
	switch runtime.GOOS {
	case "darwin":
		_ = exec.Command("open", targetURL).Start()
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return
		}
		if p, err := exec.LookPath("xdg-open"); err == nil {
			_ = exec.Command(p, targetURL).Start()
		}
	}
}
