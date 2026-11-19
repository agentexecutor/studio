# AX Studio: the new UX

The next interface for AX Studio: run coding agents in a secure sandbox on your computer or on a remote cluster,
start and follow up on tasks, and review what they changed before it reaches your code.

It's a static web app (plain HTML, CSS and JavaScript, no build step), and it runs in two ways:

- **Served by the Studio server** (`ax studio`) it shows real data from AX. Pages that have no real source yet stay
  hidden.
- **In a plain browser** every page runs on demo data. This is the full design, for reviews.

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

Without AX, for the design on demo data: serve this folder with any static file server.

```sh
cd ux
python3 -m http.server 8789      # then open http://localhost:8789/
```

The page knows which of the two it is from `env.js`. The copy in this folder says there is no server. The Studio
server answers `/env.js` itself and says there is one.

## What's connected to AX

When the Studio server is there, the `live*.js` files take over and show only what AX can back today. [api.js](api.js)
is the page's one way to the server.

| In the app | From |
|---|---|
| The checks AX on this computer needs (operating system, a running container runtime, free disk) and the tools AX uses (`ax`, `kubectl`, `kind`: version and path, or that `ax` downloads it). Healthy sections fold to one line | `GET /api/env/status` (`?fresh=1` reads the tool versions again) |
| AX on this computer and each layer it runs: Kubernetes (Kind), Agent Substrate with its gVisor workers, and AX's control plane (`ax-server` and Postgres). Its health: running, not in your kubeconfig, not answering, starting or degraded, stopped, not set up. While setup runs, how long each layer took | `GET /api/env/status` (`local.access`), and the operation's `stageStarted` |
| Set up, start, update, repair (all `ax local start`), stop and remove AX on this computer, with its output as it arrives. One line says what runs, for how long, and the step `ax` is on; Cancel stops it | `POST /api/env/local/up` (with its `purpose`), `stop`, `delete`, `POST /api/env/cancel`, and `GET /api/events` |
| The AX images that setup and installs deploy: the AX server image is needed (AX has none of its own yet) unless `AX_SERVER_IMAGE` is set. Checked as you type and kept in this browser | `GET /api/env/status` (`serverImageEnv`, `axFlags`) |
| The clusters in your kubeconfig, and which one Studio uses. A read-only check of a cluster: Kubernetes version, nodes and kernel, the certificate APIs, a default StorageClass, Agent Substrate (API server, router, WorkerPools) and AX (replicas, image), and what to do next | `GET /api/env/status`, `GET /api/env/check?context=` |
| Install, upgrade or uninstall AX on a remote cluster that runs Agent Substrate, with its output as it arrives. A guide for someone without a cluster yet | `POST /api/env/install`, `POST /api/env/uninstall` (the server runs `ax --context <cluster> install` or `uninstall`) and `GET /api/events` |
| Home greets you by name: the full name on your account on this computer, else git's `user.name` (Settings can change it). Studio never makes a name up from your login | `GET /api/bootstrap` |
| Your tasks on Home in sections that match its tiles (Needs you, Running, Paused, Done) with session turns grouped, plus All tasks (`#/tasks`) as a searchable, filterable table | `GET /api/tasks` (the AX API's `ListTasks`) |
| A task's page: its header, then tabs for Activity (what AX recorded), Logs, Changes and Terminal (with debug access) and the task file, and an inspector with the next step, where it runs and what it can reach. Details name the sandbox (actor and uid), the previous attempt's failure, and AX's raw conditions | `GET /api/tasks/get` (`GetTask`) |
| Logs: what the task's sandbox printed (the agent, AX's runner, the worker starting or pausing it), read from Agent Substrate's workers. When the agent's command exited with an error while AX still says running, Activity and the Next card say so, with the error | `GET /api/tasks/logs` (the server runs `kubectl logs -l ate.dev/worker-pool` and keeps the task's lines) |
| Workspaces, Gateways and models on the cluster in use: which tasks use each, workspace setups that failed, and Delete for the workspaces and Gateways no task uses (models are read-only). Deleting a task can take its own workspace and Gateway with it | `GET /api/workspaces`, `GET /api/gateways`, `GET /api/models`, `POST /api/workspaces/delete`, `POST /api/gateways/delete` |
| Browser notifications, if you turn them on in Settings: a task that starts waiting for you or fails, and setup or an install that finishes, while the tab is in the background | The task list and `GET /api/events` |
| A cluster switcher in the sidebar footer card, and links that open Studio on a cluster and atespace (`?context=…&atespace=…`); Copy link on a task and in the command palette | `GET /api/env/status` |
| What a task can reach: the sites its Gateway allows, and the keys the Gateway adds outside the sandbox | `GET /api/gateways/get` (`GetGateway`) |
| Pause, resume and delete | `POST /api/tasks/suspend`, `resume`, `delete` |
| New task, in the prototype's four steps (a template or your own image, where it runs, the workspace, the goal), with the best defaults and pills for common answers. The workspace can be a Git repo, one already on the cluster, or empty, with Customize workspace for more repos, setup commands, files and MCP servers. More options has the network rules, a size or a custom CPU and memory, the command, environment variables, the name, and the task file to edit, download or load | `ax apply -f -`, then `ax resume task`, through `POST /api/ax/exec`. The key goes to `POST /api/secrets/credential`; existing workspaces from `GET /api/workspaces` |
| A follow-up: a new task in the same session, on the same workspace and network rules. A failed task offers Try again: a follow-up that starts from the same goal | The same, with `spec.sessionId` |
| Run on another cluster or atespace, with a check first: whether it starts there, and whether the original keeps running, pauses or is deleted. When this `ax` has no `ax promote`, Studio sends the task itself (and can copy its `/workspace` over `ax ssh`) | `ax promote task … --preflight-only`, then `ax promote task …`; else `POST /api/tasks/move` (`dryRun` first) |
| For a task with debug access: what it changed in its sandbox, discard one file, push to a branch, apply to a folder on this computer | `GET /api/tasks/changes`, `POST /api/tasks/discard-file`, `push-branch`, `apply-local` |
| For a task with debug access: shells in its sandbox (`ax ssh`), several at once as tabs, with the commands you ran (Up and Down), Ctrl-C, Ctrl-D, Ctrl-L and colors. AX's guest exec has no terminal of its own, so a shell takes a line at a time | `POST /api/sessions/start`, `write`, `interrupt`, `eof`, `close`, and `GET /api/events` |
| Settings: what this Studio runs against (its version, the `ax` command, the kubeconfig), the atespace it lists and starts tasks in (kept in this browser), and a diagnostics report with secrets removed | `GET /api/bootstrap`, `GET /api/env/status`, `GET /api/env/diagnostics` |

Studio never changes your kubeconfig: every request names the cluster. The task list refreshes every 4 seconds,
because AX has no call that streams changes. An open Logs tab on a running task reads what's new every 4 seconds too.

Not connected yet, so hidden when the server is there: the agent's own structured messages (AX doesn't record them
yet; Logs shows what it prints) and Guardrails. Until they are, the pages this UI replaces are still served at `/classic/`, and the UI links to
them when the build includes them.

New task starts from the answers most tasks want: Antigravity, the cluster in use (this computer when AX runs here),
the repo you used last, the repo's default branch, Balanced network rules and the Medium size. Pills fill in recent
repos, branch names, goal ideas and goal tips. The plan card beside the form says what is left and holds Run.

Each fact is said once, where it belongs: Home's tiles carry the counts (the lede says where to start, and Axel only
speaks when poked or on an empty cluster); a task's state is its header chip and each check AX records is a step in
Activity; the next thing to do is in the Next card; this computer's checks are on Where agents run.

Three things to know about how tasks are written:

- The templates use the images the Studio pages used before this UI. They are staging images until the templates
  are published.
- The goal field of a Task is `goal.text`. AX called it `goal.spec` until mid-November 2026. If `ax apply` says it
  doesn't know `text`, Studio sends the same task again with `spec`.
- Debug access is on by default for a task on this computer, and off on a remote cluster. You can change it for
  each task. Without it the sandbox stays closed: there is no shell and no view of unpushed changes, and you review
  the task's result and the branch or pull request it pushes.

## Review links

Each link opens one state of the app, from the same demo data every time.

| Add to the URL | What it opens |
|---|---|
| `?reset` | A fresh install (clears the app's saved state) |
| `?cuj=1` | Journey 1, the installation experience, on its own |
| `#/get` | The download page, before AX Studio is on the computer |
| `?scenario=setup-preinstalled-it` | A first launch on a computer that IT already set up |
| `?scenario=setup-preinstalled-cli` | A first launch after AX was set up from a terminal |
| `?cuj=2` | Journey 2, deploy your first agent, as a true first run |
| `?scenario=task-mcp` | An MCP server that didn't start |
| `?scenario=task-skill` | A skill that didn't load |
| `?scenario=task-permission` | The agent asks before a risky command |
| `?scenario=task-oom` | A task runs out of memory |
| `?scenario=task-budget` | A task reaches its budget check-in |
| `?scenario=task-queued` | No room on this computer: the task waits in line |
| `?scenario=task-midturn` | A message queued for the agent's next turn |
| `?scenario=handoff-slow` | Continue with another agent while the current turn takes too long |
| `?scenario=handoff-fail` | The new agent fails to start, and the first task is untouched |
| `?scenario=cluster-run` | Run a task on a remote cluster as a fresh run |
| `?scenario=cluster-version` | The check finds an older AX version on the cluster |
| `?scenario=cluster-blocker` | The check finds the cluster can't read the repo |
| `?scenario=cluster-missing` | The cluster lacks an MCP server the workspace setup names |
| `?scenario=cluster-permission` | The check finds a missing role |
| `?scenario=setup-memory` | Not enough free memory for the local sandbox |
| `?scenario=setup-ram` | Too little memory installed |
| `?scenario=env-disconnected` | Lost connection to AX, then it reconnects |
| `?scenario=env-sleep` | A task paused while the computer slept |

Every scenario is also listed on the review page, `index.html#/review`. Nothing in the app links to it.

## What's inside

| Path | What it is |
|---|---|
| `index.html` | Entry point |
| `boot.js` | Runs first: review links that reset the app, and the colour theme |
| `env.js` | Says whether the Studio server is behind the page. The server answers `/env.js` itself |
| `api.js` | The Studio server's API: the session, requests, and the events the server pushes |
| `live.js` | Real data: the task list, a task's page, pause, resume and delete, the sandbox terminal, and the app frame |
| `live-env.js` | Real data: where agents run, setup of AX on this computer, and installing AX on a remote cluster |
| `live-new.js` | Real data: New task, follow-ups, and running a task on another cluster |
| `live-changes.js` | Real data: what a task with debug access changed, discard one file, push to a branch, apply to a folder |
| `live-logs.js` | Real data: a task's logs, and what they say about the agent stopping with an error |
| `live-resources.js` | Real data: workspaces, Gateways and models, which tasks use them, and deleting the unused ones |
| `live-nav.js` | Notifications, links to a cluster and atespace, the cluster switcher, and compact task lists |
| `live-settings.js` | Real data: Settings (appearance, keyboard and the command palette, accessibility, what Studio runs against, diagnostics) |
| `core.js` | Templates, seeded demo tasks, statuses and shared helpers |
| `views.js`, `task.js` | Demo pages: setup, home, new task, task, guardrails, where agents run, settings |
| `overlays.js` | Dialogs: command palette, health check, continue with another agent, run on a remote cluster |
| `failures.js` | Plain-language errors and the review scenarios |
| `app.js` | Routing, the simulated agents and every action |
| `mascot.js`, `viz.js` | Axel the axolotl and small charts |
| `*.css` | Styles. Colour, radius and type tokens are at the top of `styles.css` |
| `assets/` | The logo, Axel and the backdrop images |
| `embed.go` | Puts this folder into the Studio server's binary |
| `tests/` | Smoke tests |

The server's Content-Security-Policy allows scripts from files only, so nothing here uses an inline `<script>`.

## Fonts

The design uses Google Sans for text and Geist Mono for code. The font files aren't in this repo yet. Until they are,
the app uses a copy installed on your computer, and the system font otherwise.

## Tests

The smoke tests load the app in a stubbed DOM with Node (nothing to install) and check every page, flow and failure
state. `make test` runs them all. To run one, from the repo root:

```sh
node ux/tests/smoke_general.cjs   # every demo view, overlay and scenario
node ux/tests/smoke_cuj2.cjs      # journey 2: deploy your first agent
node ux/tests/smoke_cuj3.cjs      # journey 3: watch, steer and unblock
node ux/tests/smoke_cuj45.cjs     # journeys 4 and 5: continue with another agent, run on a remote cluster
node ux/tests/smoke_live.cjs      # real data: a stand-in Studio server answers the way /api does
```

`smoke_live.cjs` checks what the page sends as well as what it shows: the task files, the `ax promote` arguments,
and that every request names the cluster. The Go tests in `internal/studio` check the server's side of the same
calls.
