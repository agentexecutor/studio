/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* AX Studio, live mode: what a task's sandbox printed.

   Agent Substrate's worker logs every line a sandbox prints, labelled with the task. The Studio server reads the
   workers' logs with kubectl and keeps this task's lines (GET /api/tasks/logs), as the desktop app does. Unlike the
   Terminal, this works for every task, with or without debug access.

   The task page reads the logs when it opens, so the Logs tab and the State card can say when the task logged an
   error. While the Logs tab is open on a task that runs, it asks every few seconds for what's new. */

LIVE.logs = {};               // task name -> see liveLogsOf
const LIVE_LOGS_MAX = 2000;   // lines kept per task (the newest)
const LIVE_LOGS_MS = 4000;    // how often an open Logs tab reads a running task's logs again
const LIVE_LOGS_IDLE_MS = 30000; // how often the task page reads them again otherwise
const LIVE_LOGS_SANDBOX_KEY = 'ax.live.logs.sandbox';
/* The worker's words for what it does with a sandbox, in the words the rest of the UI uses. */
const LIVE_LOG_EVENTS = {
  'Actor starting': 'Sandbox starting',
  'Actor started': 'Sandbox started',
  'Actor checkpointing': 'Pausing: saving a checkpoint',
  'Actor checkpointed': 'Paused: checkpoint saved',
  'Actor restoring': 'Resuming from the checkpoint',
  'Actor restored': 'Resumed',
  'Actor terminated': 'Sandbox stopped',
};

function liveLogsOf(name) {
  const L = LIVE.logs[name];
  if (L && L.ctx === LIVE.context) return L;
  return (LIVE.logs[name] = { ctx: LIVE.context, loading: false, lines: [], keys: new Set(), error: '', at: 0, last: '', command: '', namespaces: null, truncated: false });
}
function liveLogsSandbox() { try { return localStorage.getItem(LIVE_LOGS_SANDBOX_KEY) === '1'; } catch (e) { return false; } }

/* ---------- Reading ---------- */
/** Reads what's new since the last line (all of the last day the first time). fresh starts over. */
async function liveLoadLogs(name, fresh) {
  if (fresh) delete LIVE.logs[name];
  const L = liveLogsOf(name);
  if (L.loading) return;
  const ctx = LIVE.context;
  L.loading = true;
  if (!L.at) liveLogsPaint(name);
  try {
    const r = await studioGet('/api/tasks/logs' + studioQuery({ context: ctx, atespace: LIVE.atespace, name, since: L.last }));
    if (ctx !== LIVE.context) return;
    L.error = '';
    L.command = r.command || L.command;
    L.namespaces = r.namespaces || [];
    L.truncated = L.truncated || !!r.truncated;
    /* Reading from a time repeats the lines of that second: keep each line once. */
    (r.lines || []).forEach((x) => {
      const k = `${x.t}\u0000${x.text}`;
      if (L.keys.has(k)) return;
      L.keys.add(k);
      L.lines.push(x);
    });
    if (L.lines.length > LIVE_LOGS_MAX) {
      L.lines.splice(0, L.lines.length - LIVE_LOGS_MAX);
      L.truncated = true;
      L.keys = new Set(L.lines.map((x) => `${x.t}\u0000${x.text}`));
    }
    if (L.lines.length) L.last = L.lines[L.lines.length - 1].t || L.last;
  } catch (e) {
    if (ctx !== LIVE.context) return;
    L.error = e.message;
  } finally {
    L.loading = false;
    L.at = Date.now();
  }
  liveLogsPaint(name);
}
/** Reads the logs the first time the task page shows. */
function liveLogsWanted(name) {
  const L = liveLogsOf(name);
  if (!L.at && !L.loading) Promise.resolve().then(() => liveLoadLogs(name));
}
/** Every poll: an open Logs tab on a running task reads what's new; the rest of the task page does now and then. */
function liveLogsTick() {
  const r = parseRoute();
  if (r.parts[0] !== 'task' || !r.parts[1]) return;
  const name = decodeURIComponent(r.parts[1]);
  const row = LIVE.tasks.find((t) => t.name === name);
  const L = LIVE.logs[name];
  if (!row || !L || L.loading || !L.at) return;
  const running = liveState(row.state).active || row.state === 'Idle' || row.state === 'RequiresAction';
  const every = r.parts[2] === 'logs' && running ? LIVE_LOGS_MS : running ? LIVE_LOGS_IDLE_MS : 0;
  if (every && Date.now() - L.at >= every - 200) liveLoadLogs(name);
}
/** Redraws only the Logs tab (keeping your place, or following new lines when you were at the bottom), its dot,
    and what the Next card says about errors. */
function liveLogsPaint(name) {
  if (liveRouteTask() !== name) return;
  const box = $('#live-logs');
  if (box && box.dataset && box.dataset.task === name) {
    const pre = $('#live-logs-out');
    const stuck = !pre || pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 24;
    const at = pre ? pre.scrollTop : 0;
    const row = LIVE.tasks.find((t) => t.name === name);
    box.innerHTML = liveLogsInnerHTML(name, row ? row.state : '');
    const pre2 = $('#live-logs-out');
    if (pre2) pre2.scrollTop = stuck ? pre2.scrollHeight : at;
  }
  const dot = $('#dot-logs');
  if (dot) dot.hidden = !liveLogsError(name);
  const ns = $('#live-ns-logerr');
  if (ns) ns.outerHTML = liveLogsNextHTML(name);
  /* When the agent's command exited (or started again), Activity and the Next card say so: redraw the page. */
  const L = LIVE.logs[name];
  const sig = JSON.stringify(liveLogsAgentExit(name));
  if (L && L.exitSig !== sig) {
    const first = L.exitSig === undefined;
    L.exitSig = sig;
    if (!first || sig !== 'null') render({ keepScroll: true, background: true });
  }
}

/* ---------- What the lines say ---------- */
/** A line as the tab shows it: its time, its text without the time and level its writer put first, and its level. */
function liveLogLine(x) {
  let text = String(x.text || ''), lvl = '';
  if (x.src === 'runner') {
    /* AX's task runner: time=… level=INFO msg="…" key=value */
    const m = /^time=\S+ level=(\w+) (.*)$/.exec(text);
    if (m) {
      lvl = m[1].toUpperCase();
      text = m[2].replace(/^msg="((?:[^"\\]|\\.)*)"/, (_, s) => s.replace(/\\"/g, '"'));
    }
  } else if (x.src === 'agent') {
    text = text.replace(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}(\.\d+)? /, '');
    const m = /^(ERROR|WARN|WARNING|INFO|DEBUG)\b/.exec(text);
    if (m) lvl = m[1] === 'WARNING' ? 'WARN' : m[1];
    else if (/\b(panic|traceback|fatal)\b/i.test(text)) lvl = 'ERROR';
  } else if (x.src === 'event') {
    text = LIVE_LOG_EVENTS[text] || text;
  } else if (x.src === 'sandbox' && /^[EF]\d{4} /.test(text)) {
    lvl = 'ERROR';
  }
  const d = x.t ? new Date(x.t) : null;
  const time = d && !isNaN(d) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '';
  return { time, text, lvl, src: x.src, at: x.t };
}
/** The last error the agent (or AX's runner for it) logged, if the newest lines have one. */
function liveLogsError(name) {
  const L = LIVE.logs[name];
  if (!L || L.ctx !== LIVE.context) return null;
  for (let i = L.lines.length - 1; i >= 0; i--) {
    const x = L.lines[i];
    if (x.src !== 'agent' && x.src !== 'runner') continue;
    const l = liveLogLine(x);
    if (l.lvl !== 'ERROR') continue;
    /* The runner's "task command exited with error" only says the agent stopped; the agent's own line says why. */
    if (x.src === 'runner') {
      for (let j = i - 1; j >= Math.max(0, i - 40); j--) {
        const y = L.lines[j];
        if (y.src === 'agent' && liveLogLine(y).lvl === 'ERROR') return liveLogLine(y);
      }
    }
    return l;
  }
  return null;
}
/** An error line in a few words: the err="…" a Go program logs, unquoted, and its end when it's long (a Go error
    says the cause last). */
function liveLogErrorWords(text, max) {
  let msg = String(text || '').replace(/^ERROR:?\s*/, '');
  const m = /\berr(?:or)?="((?:[^"\\]|\\.)*)"/.exec(msg);
  if (m) msg = m[1].replace(/\\"/g, '"');
  max = max || 140;
  if (msg.length <= max) return msg;
  /* A Go error chains its causes with ": ", the root cause last: keep as many of the last ones as fit. */
  const parts = msg.split(': ');
  let out = parts.pop();
  while (parts.length && out.length + parts[parts.length - 1].length + 2 <= max) out = `${parts.pop()}: ${out}`;
  return '…' + (out.length > max ? out.slice(-max) : out);
}
/** The agent's command exited and AX's runner said so last (nothing started again since): when, the exit code, and
    the agent's error. null while it runs, or when the logs don't say. */
function liveLogsAgentExit(name) {
  const L = LIVE.logs[name];
  if (!L || L.ctx !== LIVE.context) return null;
  for (let i = L.lines.length - 1; i >= 0; i--) {
    const x = L.lines[i];
    if (x.src !== 'runner') continue;
    if (/msg="started task command"/.test(x.text)) return null;
    const m = /msg="task command exited[^"]*"/.exec(x.text);
    if (!m) continue;
    const code = (/exitCode=(\d+)/.exec(x.text) || [])[1];
    if (code === '0') return null;
    const e = liveLogsError(name);
    return { at: x.t, time: liveLogLine(x).time, code: code || '', error: e ? liveLogErrorWords(e.text) : '' };
  }
  return null;
}
/** What the Next card adds when the agent logged an error: the error, and the way to the Logs tab. */
function liveLogsNextHTML(name) {
  const e = liveLogsError(name);
  if (!e) return '<span id="live-ns-logerr" hidden></span>';
  /* When the card already says the agent stopped (and when), the error is enough. */
  const lead = liveLogsAgentExit(name) ? 'Its error:' : `It logged an error${e.time ? ` at ${esc(e.time)}` : ''}:`;
  return `<span class="ns-detail ns-logerr" id="live-ns-logerr">${icon('alert', 'xs')} ${lead} <span class="mono">${esc(liveLogErrorWords(e.text))}</span> <a href="#/task/${encodeURIComponent(name)}/logs">Logs</a></span>`;
}

/* ---------- The Logs tab ---------- */
function liveLogLineHTML(l) {
  const cls = `ll ll-${l.src}${l.lvl === 'ERROR' ? ' ll-err' : l.lvl === 'WARN' ? ' ll-warn' : ''}`;
  return `<span class="${cls}"><span class="ll-t">${esc(l.time)}</span><span class="ll-x">${esc(l.text)}</span></span>`;
}
function liveLogsInnerHTML(name, stateName) {
  const L = liveLogsOf(name);
  const withSandbox = liveLogsSandbox();
  const lines = L.lines.map(liveLogLine);
  const shown = withSandbox ? lines : lines.filter((l) => l.src !== 'sandbox');
  const hidden = lines.length - shown.length;
  const running = liveState(stateName).active || stateName === 'Idle' || stateName === 'RequiresAction';
  const copyText = shown.map((l) => `${l.time} ${l.text}`).join('\n');
  let body;
  if (L.error && !lines.length) {
    body = `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere"><strong>Studio couldn't read the logs.</strong> ${esc(L.error)}</div></div>`;
  } else if (!L.at) {
    body = `<p class="small muted" style="margin-top:10px">${icon('loader', 'xs')} Reading the logs…</p>`;
  } else if (L.namespaces && !L.namespaces.length) {
    body = '<p class="small" style="margin-top:10px" id="live-logs-none">Studio found no Agent Substrate workers on this cluster, so there are no logs to read.</p>';
  } else if (!shown.length) {
    body = `<p class="small" style="margin-top:10px" id="live-logs-none">${lines.length ? `Only sandbox start-up lines so far (${plural(hidden, 'line')}). Turn them on above to see them.`
      : "Nothing from this task in the last 24 hours. A worker keeps a sandbox's logs while it runs, and for a while after."}</p>`;
  } else {
    body = `<div class="terminal live-logs-term">
        <div class="term-bar"><span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="term-tab" aria-hidden="true">${esc(name)} · logs</span>
          ${running ? '<span class="chip running ll-live"><i class="pulse-dot"></i>Live</span>' : ''}<span class="lo-count">${plural(shown.length, 'line')}</span></div>
        <pre class="term-body" id="live-logs-out" tabindex="0" aria-label="Logs">${shown.map(liveLogLineHTML).join('')}</pre>
      </div>
      ${L.truncated ? `<p class="xsmall muted" style="margin-top:6px">Showing the newest ${LIVE_LOGS_MAX.toLocaleString()} lines.</p>` : ''}
      ${L.error ? `<p class="xsmall" style="margin-top:6px;color:var(--wait)">${icon('alert', 'xs')} Couldn't read new lines: ${esc(L.error)}</p>` : ''}`;
  }
  return `<h2 id="live-logs-h" class="sr-only">Logs</h2>
    <div class="log-bar"><span class="lb-text">${running ? 'What the task and its sandbox print, as it happens.' : 'What the task and its sandbox printed.'}</span>
      <span class="lb-actions">
        <label class="ll-toggle"><input type="checkbox" data-action="live-logs-sandbox" ${withSandbox ? 'checked' : ''}> Sandbox start-up${hidden || withSandbox ? ` (${lines.filter((l) => l.src === 'sandbox').length})` : ''}</label>
        <button class="btn ghost sm" data-action="copy" data-text="${esc(copyText)}" ${shown.length ? '' : 'disabled'}>${icon('copy', 'sm')}Copy</button>
        <button class="btn ghost sm" data-action="live-logs-refresh" data-task="${esc(name)}" ${L.loading ? 'disabled' : ''}>${icon(L.loading ? 'loader' : 'refresh', 'sm')}${L.loading ? 'Reading…' : 'Refresh'}</button>
      </span></div>
    ${body}
    ${L.command ? `<p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} Every sandbox on the worker, unfiltered: <code>${esc(L.command)}</code></p>` : ''}`;
}
function liveLogsHTML(name, t, stateName) {
  liveLogsWanted(name);
  return `<section aria-labelledby="live-logs-h" id="live-logs" data-task="${esc(name)}">${liveLogsInnerHTML(name, stateName)}</section>`;
}

const LIVE_LOGS_ACTIONS = {
  'live-logs-refresh': (el) => liveLoadLogs(el.dataset.task, true),
  'live-logs-sandbox': (el) => {
    try { localStorage.setItem(LIVE_LOGS_SANDBOX_KEY, el.checked ? '1' : '0'); } catch (e) { /* ignore */ }
    const name = liveRouteTask();
    if (name) liveLogsPaint(name);
  },
};
