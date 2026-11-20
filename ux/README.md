# AX Studio: the new UX

The interface for AX Studio: set up AX on your computer, start tasks in their own sandboxes, and see what they do:
their state, what AX recorded, their logs, and a shell inside.

It's a static web app (plain HTML, CSS and JavaScript, no build step), served by the Studio server (`ax studio`). It
shows real data from AX on this computer, and pages that have no real source yet stay hidden. Opened without the
server (as plain files), the page only says how to start Studio.

## Run it

With AX: build the Studio server from the repo root and open it. The server embeds this folder and serves it at `/`.

```sh
make build
./bin/ax-studio                    # opens http://127.0.0.1:8080
```

To work on the UI, have the server read this folder from disk, so a reload shows your edit:

```sh
go build -o bin/ax-studio ./cmd/ax-studio
./bin/ax-studio --ux-dir ux
```

The page knows whether the server is behind it from `env.js`. The copy in this folder says there is no server. The
Studio server answers `/env.js` itself and says there is one.

## What's connected to AX

The `live*.js` files are the pages, and they show only what AX can back today. [api.js](api.js)
is the page's one way to the server.

| In the app | From |
|---|---|
| The checks AX on this computer needs (operating system, a running container runtime, free disk) and the tools AX uses (`ax`, `kubectl`, `kind`: version and path, or that `ax` downloads it). Healthy sections fold to one line | `GET /api/env/status` (`?fresh=1` reads the tool versions again) |
| AX on this computer and each layer it runs: Kubernetes (Kind), Agent Substrate with its sandbox workers, and AX's control plane (`ax-server` and Postgres). Its health: running, not in your kubeconfig, not answering, starting or degraded, stopped, not set up. While setup runs, how long each layer took | `GET /api/env/status` (`local.access`), and the operation's `stageStarted` |
| Set up, start, update, repair (all `ax local start`), stop and remove AX on this computer, with its output as it arrives. One line says what runs, for how long, and the step `ax` is on; Cancel stops it | `POST /api/env/local/up` (with its `purpose`), `stop`, `delete`, `POST /api/env/cancel`, and `GET /api/events` |
| The AX images setup deploys: Studio's own (pinned to the AX in its `go.mod`, since AX publishes none yet), or `AX_SERVER_IMAGE` and `AX_DEFAULT_TASK_IMAGE` from Studio's environment, unless you type others. Checked as you type and kept in this browser | `GET /api/env/status` (`setupImages`, `axFlags`) |
| Until AX runs on this computer, every page but Local cluster and Settings is setup. Studio only uses AX on this computer (`ax-local`), whatever your kubeconfig's current context is | `GET /api/env/status` (`local`) |
| Home: what's running, what needs you and what's suspended, as cards, and your most recent tasks. With no tasks yet, Create a new task and Try a sample task. Tasks (`#/tasks`) is a searchable, filterable table with Suspend or Resume, a shell, Logs and Delete on each row; its second tab (`#/tasks/resources`) holds Workspaces and Gateways | `GET /api/tasks` (the AX API's `ListTasks`) |
| A task's page: its header with Suspend or Resume and Delete, then tabs for Activity (what AX recorded), Logs, Terminal and YAML, and an inspector with its state, where it runs and what it can reach. Details name the sandbox (actor and uid), the previous attempt's failure, and AX's raw conditions | `GET /api/tasks/get` (`GetTask`) |
| Logs: what the task's sandbox printed (the agent, AX's runner, the worker starting or pausing it), read from Agent Substrate's workers. When the task's command exited with an error while AX still says running, Activity and the State card say so, with the error | `GET /api/tasks/logs` (the server runs `kubectl logs -l ate.dev/worker-pool` and keeps the task's lines) |
| Workspaces, Gateways and models on this computer: which tasks use each, workspace setups that failed, and Delete for the workspaces and Gateways no task uses (models are read-only). Deleting a task can take its own workspace and Gateway with it | `GET /api/workspaces`, `GET /api/gateways`, `GET /api/models`, `POST /api/workspaces/delete`, `POST /api/gateways/delete` |
| Browser notifications, if you turn them on in Settings: a task that starts waiting for you or fails, and setup that finishes, while the tab is in the background | The task list and `GET /api/events` |
| The sidebar footer card says how AX on this computer is doing and opens Local cluster. Links can open Studio on an atespace (`?atespace=…`); Copy link on a task and in the command palette | `GET /api/env/status` |
| What a task can reach: the sites its Gateway allows, and the keys the Gateway adds outside the sandbox | `GET /api/gateways/get` (`GetGateway`) |
| Suspend, resume and delete | `POST /api/tasks/suspend`, `resume`, `delete` |
| New task: a sequential 4-step form that follows AX's specs, starting with preset cards (Antigravity, Claude Code, or Blank) and Load a task file, then Task (Goal and Name upfront; image, command, resources, environment, config, and debug access under Advanced task options), Workspace (none, existing, or new with repos and setup commands upfront, and files, skills, setup network, and MCP servers under More workspace options), Network (none, allow hosts with the preset API key and hosts upfront and full credential rules under Advanced network options, or existing), and a sticky bottom commit bar. The YAML beside it is what Studio applies, to edit, download or load from a file. For Antigravity and Claude Code, New task says whether the agent's key is already stored, and asks for it when it isn't | `ax apply -f -`, then `ax resume task`, through `POST /api/ax/exec`. Keys you type go to `POST /api/secrets/credential`; whether one is stored from `GET /api/secrets/credential/status` (key names only, never values); existing workspaces and Gateways from `GET /api/workspaces` and `GET /api/gateways` |
| Terminal: for a running task with debug access, shells in its sandbox (`ax ssh`), drawn by xterm.js ([vendor/xterm](vendor/xterm/README.md)): Tab completion, history, Ctrl-C, full-screen programs such as `top`, and resizing. Several at once as tabs; they stay connected while you look at other pages. A task that can't have a shell says why. The server runs `ax ssh` on a pseudo-terminal and gives the shell a terminal inside the sandbox too (util-linux `script` or Python's `pty`; without either, a line at a time) | `POST /api/sessions/start`, `write` (keys as typed), `resize`, `close`, and `GET /api/events` (output as base64) |
| Settings: what this Studio runs against (its version, the `ax` command, the kubeconfig), the atespace it lists and starts tasks in (kept in this browser), and a diagnostics report with secrets removed | `GET /api/bootstrap`, `GET /api/env/status`, `GET /api/env/diagnostics` |

Studio never changes your kubeconfig: every request names AX on this computer's cluster (`ax-local`). The task list refreshes every 4 seconds,
because AX has no call that streams changes. An open Logs tab on a running task reads what's new every 4 seconds too.

Not connected yet, so hidden when the server is there: the agent's own structured messages (AX doesn't record them
yet; Logs shows what it prints) and Guardrails.

New task starts from Antigravity by default (ordered Antigravity, Claude Code, then Blank). Antigravity and Claude Code fill
in an agent with solid defaults: its image, environment, resources and config, and the Gateway rules that add its API key outside the
sandbox, tucked into collapsible advanced sections until you want to customize them. Blank uses the cluster's default task image,
`sh -c 'sleep infinity'` so there is a sandbox to open a shell in, debug access on, and no workspace or network, so a first task
works without keys. Everything stays editable, and switching presets after editing what the last one filled in asks first. Each
row names the YAML field it writes, and the YAML panel and sticky bottom bar say what is left to fix.

Each fact is said once, where it belongs: Home's cards carry the counts (the lede says where to start, and Axel only
speaks when poked or on an empty cluster); a task's state is its header chip and each check AX records is a step in
Activity; what AX says about its state is in the State card; this computer's checks are on Local cluster.

Four things to know about how tasks are written:

- Antigravity uses its official image. Claude Code's image is a staging image until it is published.
- The goal field of a Task is `goal.text`. AX called it `goal.spec` until mid-November 2026. If `ax apply` says it
  doesn't know `text`, Studio sends the same task again with `spec`.
- Debug access is on by default. You can change it for each task. Without it the sandbox stays closed: there is no
  shell, and Logs has what the task printed.
- AX on this computer sets a workspace up inside the task's sandbox, on the task's network (its `ax-server` runs
  without workspace pre-warming). So a new Gateway also allows the hosts the workspace clones from, and AX refuses a
  workspace with a setup network (`spec.setup.gateway`) or a profile until it pre-warms workspaces.

## What's inside

| Path | What it is |
|---|---|
| `index.html` | Entry point |
| `boot.js` | Runs first: the colour theme, and `?reset`, which clears what Studio keeps in this browser |
| `env.js` | Says whether the Studio server is behind the page. The server answers `/env.js` itself |
| `api.js` | The Studio server's API: the session, requests, and the events the server pushes |
| `live.js` | Real data: the task list, a task's page, suspend, resume and delete, the sandbox terminal, and the app frame |
| `live-env.js` | Real data: setup of AX on this computer, and the Local cluster page |
| `live-new.js` | Real data: New task |
| `live-logs.js` | Real data: a task's logs, and what they say about its command stopping with an error |
| `live-resources.js` | Real data: workspaces, Gateways and models, which tasks use them, and deleting the unused ones |
| `live-nav.js` | Notifications, links to an atespace, and compact task lists |
| `live-settings.js` | Real data: Settings (appearance, keyboard and the command palette, accessibility, what Studio runs against, diagnostics) |
| `core.js` | Shared helpers, icons, Axel's story, and small UI pieces (dropdowns, labelled rows, the setup steps, the Gateway map) |
| `overlays.js` | Theme, toasts, dialogs, the command palette and the shortcuts |
| `app.js` | The app shell: actions, dropdowns, keyboard, focus, routing and start-up |
| `mascot.js` | Axel the axolotl |
| `*.css` | Styles. Colour, radius and type tokens are at the top of `styles.css` |
| `assets/` | The logo, Axel and the backdrop images |
| `embed.go` | Puts this folder into the Studio server's binary |
| `tests/` | Smoke tests |

The server's Content-Security-Policy allows scripts from files only, so nothing here uses an inline `<script>`.

## Fonts

The design uses Google Sans for text and Geist Mono for code. The font files aren't in this repo yet. Until they are,
the app uses a copy installed on your computer, and the system font otherwise.

## Tests

The smoke tests load the app in a stubbed DOM with Node (nothing to install), with a stand-in Studio server that
answers the way `/api` does. `make test` runs them with the Go tests. To run them on their own, from the repo root:

```sh
node ux/tests/smoke_live.cjs
```

`smoke_live.cjs` checks what the page sends as well as what it shows: the task files, and that every request names
the local cluster. The Go tests in `internal/studio` check the server's side of the same calls.
