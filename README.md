# AX Studio

Local web application for [AX](https://github.com/google/ax): set up local or remote agent clusters, compose tasks with guardrails, monitor live execution, review and apply sandbox Git diffs locally, continue multi-turn sessions, and promote tasks across Kubernetes clusters.

AX Studio ships as a **single Go binary (`ax-studio`)** with an embedded web frontend served strictly on `http://127.0.0.1:8080`.

> **The interface is changing.** The new UX in [`ux/`](ux/README.md) is served at `/`. It covers setup, the task list, a task's result and changes, New task, follow-ups and running on another cluster. The React pages it replaces are still served at `/classic/` for what it doesn't cover yet: the terminal and Guardrails. The screenshot and the workflows below describe the React pages.

![Activity](docs/screenshots/overview.png)

## Core Workflows

- **Where Agents Run:** Run host preflight checks and start a self-contained local Kind + Agent Substrate + AX sandbox (`ax local start`), or connect directly to any remote team cluster in `~/.kube/config` (`ax install`) with zero local VM footprint.
- **Board & Activity:** Monitor tasks across `Working`, `Pending`, `Suspended`, `Failed`, and `Completed` states, inspect conditions and task output, and open interactive `ax ssh` terminal tabs.
- **New Task & Guardrails:** Compose `Task`, `Workspace`, and `Gateway` manifests visually or in YAML, pick prebuilt agent templates, configure outbound HTTPS domain allow-lists, and store API keys as cluster `Secret`s (`ax.io/credential: "true"`) injected by `atenet-router` without exposing keys inside sandboxes.
- **Changes & Continue:** Inspect uncommitted Git diffs inside a running debug-enabled sandbox (`spec.debug: true`), discard individual files, apply patches directly onto a local Git repository (`git apply --check`), or launch a follow-up turn sharing `spec.session_id`.
- **Promote Across Clusters:** Run a task on a team cluster with `ax promote`: pick the target and the command's options, preview what it will create or reuse (`--preflight-only`), then promote the `Gateway` + `Workspace` + `Task`. `ax promote` is the single source of truth for promotion; the sandbox's files and the Secrets a Gateway names are not copied.

## Prerequisites

- [`ax` CLI](https://github.com/google/ax) installed via `install.sh` (`~/.ax/bin/ax` and `~/.ax/bin/ax-studio`). No Node.js or Go is needed to run prebuilt releases.
- An `ax` that has `ax local status -o json` (google/ax#640 or later). Studio is built against one AX version (see `go.mod`); use the `ax` and ax-server of that version or later.
- For local sandboxes: Docker or rootful Podman on Linux (`>= 6.8` kernel), or OrbStack / Docker Desktop / Colima on macOS.

## Quick Start

Install AX + AX Studio via `install.sh` and launch:

```bash
curl -fsSL https://github.com/google/ax/releases/latest/download/install.sh | sh
export PATH="$HOME/.ax/bin:$PATH"
ax studio                            # Opens http://127.0.0.1:8080 in your browser
```

Useful flags:

```bash
ax studio --port 8080                # Default loopback port (127.0.0.1:8080)
ax studio --no-open                  # Do not open a browser automatically (SSH/remote or scripts)
ax -n ax-system studio               # Target a custom AX control-plane namespace
```

Stopping `ax studio` (`Ctrl-C`) closes only the local web server; any local Kind cluster and running Tasks in Kubernetes continue running unaffected.

## Uninstall & Clean Up

1. **Stop the Web UI:** Press `Ctrl-C` in the terminal running `ax studio` / `ax-studio`.
2. **Delete the local sandbox cluster (if created):**
   ```bash
   ax local delete
   ```
   *(Or click **Delete** on the Local Sandbox card in the **Environments** page before stopping AX Studio.)*
3. **Uninstall AX from a remote cluster (optional):**
   ```bash
   ax --context <remote-context> uninstall
   ```
4. **Remove local binaries and caches:** All files installed by `install.sh` or cached on demand (`ax`, `ax-studio`, tunnel metadata, short-lived `ax ssh` certificates, and any fallback `kind`/`kubectl` binaries not already on your `PATH`) live under `~/.ax/`:
   ```bash
   rm -rf ~/.ax
   ```
   Pre-existing system tools (`docker`, `podman`, system/Homebrew `kubectl` and `kind`) and other `~/.kube/config` contexts are never modified or removed. Remove `export PATH="$HOME/.ax/bin:$PATH"` from `~/.zshrc` or `~/.bashrc` if you added it.

## Development & Building from Source

Building from source compiles the TypeScript/React frontend (`src/`) into `internal/studio/dist/` and embeds it, with the new UX in `ux/`, into the single `bin/ax-studio` Go binary (requires Go `1.27+` and Node.js `20+`):

```bash
make build                           # Installs frontend deps if needed, builds UI, and compiles bin/ax-studio
./bin/ax-studio                      # Run locally built binary
make verify                          # TypeScript check + UI smoke tests + Go race tests + gofmt + go vet
```

The new UX has no build step. To work on it, serve it from disk so a reload shows your edit (see [`ux/README.md`](ux/README.md)):

```bash
./bin/ax-studio --ux-dir ux
```

## Release

A release is the `ax-studio` binary for Linux and macOS (amd64 and arm64). Push a version tag and [the Release workflow](.github/workflows/release.yml) tests, builds and publishes `ax-studio_<os>_<arch>.tar.gz` for each platform, with a `checksums.txt`, to a GitHub release for the tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The binary reports the tag as its version (`ax-studio --version`). A tag with a `-`, such as `v0.1.0-rc.1`, is published as a prerelease. To try the build without publishing, run the workflow by hand from the Actions tab; the archives are kept as workflow artifacts.

`install.sh` in [google/ax](https://github.com/google/ax) installs the Studio release it names, not the latest one. After a release, set `PINNED_STUDIO_VERSION` there to the new tag and `pinned_studio_sha256` to the four digests in `checksums.txt`.

## Security Model

- **Loopback-Only BFF:** Refuses to bind to `0.0.0.0` or non-loopback interfaces; rejects non-loopback `Host` headers (DNS rebinding defense) and cross-origin `Origin` headers.
- **Per-Process Session & CSRF:** Issues an ephemeral 256-bit `HttpOnly; SameSite=Strict` session cookie and requires constant-time `X-AX-CSRF-Token` verification on all mutating `POST` endpoints, paired with strict `Content-Security-Policy` (`script-src 'self'`).
- **Allow-Listed Execution & Secret Redaction:** The browser can run only an allow-list of `ax` subcommands (never an arbitrary program or a local file path); credential Secret values are piped strictly over `stdin`, and tokens are scrubbed from diagnostic logs.
