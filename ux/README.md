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
| The checks AX on this computer needs: operating system, a running container runtime, free disk | `GET /api/env/status` |
| Set up, start, stop and remove AX on this computer, with its output as it arrives | `POST /api/env/local/up`, `stop`, `delete` (the server runs `ax local start`, `stop`, `delete`) and `GET /api/events` |
| The clusters in your kubeconfig, and which one Studio uses | `GET /api/env/status` |
| Your tasks, each with its goal and state. The turns of one session are grouped | `GET /api/tasks` (the AX API's `ListTasks`) |
| A task's details, result, output and task file | `GET /api/tasks/get` (`GetTask`) |
| Pause, resume and delete | `POST /api/tasks/suspend`, `resume`, `delete` |
| New task: a template or your own image, a Git repo, a goal, network rules, debug access | `ax apply -f -`, then `ax resume task`, through `POST /api/ax/exec`. The key goes to `POST /api/secrets/credential` |
| A follow-up: a new task in the same session, on the same workspace and network rules | The same, with `spec.sessionId` |
| Run on another cluster, with a check first | `ax promote task … --preflight-only`, then `ax promote task …` |
| For a task with debug access: what it changed in its sandbox, push to a branch, apply to a folder on this computer | `GET /api/tasks/changes`, `POST /api/tasks/push-branch`, `POST /api/tasks/apply-local` |

Studio never changes your kubeconfig: every request names the cluster. The task list refreshes every 4 seconds,
because AX has no call that streams changes.

Not connected yet, so hidden when the server is there: a task's activity and live log (AX doesn't offer them yet),
the terminal, Guardrails and Settings. Until they are, the pages this UI replaces are still served at `/classic/`,
and the UI links to them when the build includes them.

Three things to know about how tasks are written:

- The templates use the images the Studio pages used before this UI. They are staging images until the templates
  are published.
- The goal field of a Task is `goal.text`. AX called it `goal.spec` until mid-November 2026. If `ax apply` says it
  doesn't know `text`, Studio sends the same task again with `spec`.
- Debug access is off unless you turn it on. Without it the sandbox stays closed: there is no shell and no view of
  unpushed changes, and you review the task's result and the branch or pull request it pushes.

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
| `live.js` | Real data: the task list, a task's page, pause, resume and delete, and the app frame |
| `live-env.js` | Real data: where agents run, and setup of AX on this computer |
| `live-new.js` | Real data: New task, follow-ups, and running a task on another cluster |
| `live-changes.js` | Real data: what a task with debug access changed, push to a branch, apply to a folder |
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
