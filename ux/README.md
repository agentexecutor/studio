# AX Studio: the new UX

The next interface for AX Studio: run coding agents in a secure sandbox on your computer or on a remote cluster,
watch and steer them, and review their changes before they reach your code.

It's a static web app (plain HTML, CSS and JavaScript, no build step). Today every page runs on demo data. Connecting
it to AX through the Studio app is the work on this branch.

## Run it

Serve this folder with any static file server:

```sh
cd ux
python3 -m http.server 8789
```

Then open http://localhost:8789/. Press Ctrl+K (⌘K on a Mac) for the command palette.

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
```
