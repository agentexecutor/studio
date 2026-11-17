# AX Studio: the new UX

The next interface for AX Studio: run coding agents in a secure sandbox on your computer or on a remote cluster,
watch and steer them, and review their changes before they reach your code.

It's a static web app (plain HTML, CSS and JavaScript, no build step), and it runs in two ways:

- **In a browser** every page runs on demo data. This is the full design, for reviews.
- **In the Studio app** it shows real data from AX, and pages that have no real source yet stay hidden.

## Run it

Serve this folder with any static file server:

```sh
cd ux
python3 -m http.server 8789
```

Then open http://localhost:8789/. Press Ctrl+K (⌘K on a Mac) for the command palette.

To open it inside the Studio app, run this from the repo root:

```sh
npm install
npm run ux          # builds, then runs: electron . --ux
```

In the app, the page gets `window.studio`, the bridge the app uses to run `ax` and `kubectl`. In a browser there's
no bridge, so the app stays on demo data.

## What's connected to AX

With the bridge, [live.js](live.js) takes over and shows only what AX can back today:

| In the app | From |
|---|---|
| The clusters in your kubeconfig, and which one Studio uses | `ax ctx` |
| AX on this computer: running, stopped or not set up | `ax local status` |
| Your tasks and each one's state | `ax get tasks` |
| A task's details and its task file | `ax get task <name>` |
| Pause, resume and delete | `ax suspend task`, `ax resume task`, `ax delete task` |

Studio never changes your kubeconfig: it names the cluster on every command (`--context`). The list refreshes every
4 seconds, because AX has no call that streams changes.

Not connected yet, so hidden in the app: New task, Activity, Changes, the terminal and the log, Guardrails, Settings
and setup. If `ax` isn't installed, the app says how to install it.

## Review links

Each link opens one state of the app, from the same demo data every time.

| Add to the URL | What it opens |
|---|---|
| `?reset` | A fresh install (clears the app's saved state) |
| `?cuj=1` | Journey 1, the installation experience, on its own |
| `#/get` | The download page, before AX Studio is on the computer |
| `?scenario=setup-preinstalled-it` | A first launch on a computer that IT already set up |
| `?scenario=setup-preinstalled-cli` | A first launch after `ax setup` in a terminal |
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
| `core.js` | Templates, seeded tasks, statuses and shared helpers |
| `views.js`, `task.js` | Pages: setup, home, new task, task, guardrails, where agents run, settings |
| `overlays.js` | Dialogs: command palette, health check, continue with another agent, run on a remote cluster |
| `failures.js` | Plain-language errors and the review scenarios |
| `app.js` | Routing, the simulated agents and every action |
| `live.js` | The pages that show real data from AX inside the Studio app |
| `mascot.js`, `viz.js` | Axel the axolotl and small charts |
| `*.css` | Styles. Colour, radius and type tokens are at the top of `styles.css` |
| `assets/` | The logo, Axel and the backdrop images |
| `tests/` | Smoke tests |

## Fonts

The design uses Google Sans for text and Geist Mono for code. The font files aren't in this repo yet. Until they are,
the app uses a copy installed on your computer, and the system font otherwise.

## Tests

The smoke tests load the app in a stubbed DOM with Node (nothing to install) and check every page, flow and failure
state.

```sh
node tests/smoke_general.js   # every view, overlay and scenario
node tests/smoke_cuj2.js      # journey 2: deploy your first agent
node tests/smoke_cuj3.js      # journey 3: watch, steer and unblock
node tests/smoke_cuj45.js     # journeys 4 and 5: continue with another agent, run on a remote cluster
node tests/smoke_live.js      # real data: a stand-in bridge answers the way the ax CLI does
```
