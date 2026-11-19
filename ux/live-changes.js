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

/* AX Studio, live mode: what a task changed in its sandbox and hasn't pushed.

   Only for a task started with debug access. The Studio server runs git inside the sandbox (status and diff) and
   hands back the changed files with their patches. From here you can push the changes to a branch, or apply them to
   a Git checkout on this computer.

   A task without debug access keeps its sandbox closed. You review its result and the branch or pull request it
   pushes, so this section isn't shown for it. */

LIVE.changes = {};          // task name -> see liveChangesOf
const LIVE_DIFF_MAX = 1000; // lines of one file's diff shown
const LIVE_APPLY_KEY = 'ax.live.applyPath';
const LIVE_FILE_STATUS = { M: 'Changed', A: 'Added', D: 'Deleted', '?': 'New' };
/* Why the server couldn't read the sandbox, in the UI's words. Its own words are the fallback. */
const LIVE_CHANGES_WHY = [
  [/suspended/i, 'The task is paused, so its sandbox is closed. Resume it to see its changes.'],
  [/no active sandbox/i, "The sandbox hasn't started yet."],
  [/no git repository/i, 'The workspace has no Git repo, so there is nothing to compare.'],
  [/unable to read git status/i, "Studio couldn't read the changes from the sandbox."],
  [/requires spec\.debug/i, 'This task was started without debug access, so its sandbox is closed.'],
];

function liveChangesOf(name) {
  return (LIVE.changes[name] = LIVE.changes[name] || { loading: false, data: null, error: '', at: 0, forState: '', open: {}, note: '' });
}
function liveChangesWhy(reason) {
  const hit = LIVE_CHANGES_WHY.find(([re]) => re.test(reason || ''));
  return hit ? hit[1] : reason || "Studio couldn't read the sandbox.";
}
/** A file's patch as the lines the diff table draws: hunk headers, added, removed and unchanged lines. */
function livePatchLines(patch) {
  const out = [];
  let inHunk = false;
  String(patch || '').replace(/\n+$/, '').split('\n').forEach((l) => {
    if (l.startsWith('@@')) { inHunk = true; out.push(l); return; }
    if (l.startsWith('diff --git ')) { inHunk = false; return; }
    if (!inHunk || l.startsWith('\\')) return; // the file header, and "\ No newline at end of file"
    out.push(l === '' ? ' ' : l);
  });
  return out;
}

/* ---------- Loading ---------- */
async function liveLoadChanges(name) {
  const c = liveChangesOf(name);
  if (c.loading) return;
  const ctx = LIVE.context;
  const row = LIVE.tasks.find((t) => t.name === name);
  c.loading = true; c.error = ''; c.forState = row ? row.state : c.forState;
  liveChangesPaint(name);
  try {
    c.data = await studioGet('/api/tasks/changes' + studioQuery({ context: ctx, atespace: LIVE.atespace, task: name }));
  } catch (e) {
    c.error = e.message;
  }
  c.loading = false;
  c.at = Date.now();
  if (ctx === LIVE.context) liveChangesPaint(name);
}
/** Loads the changes the first time the section shows, and again when the task's state has changed since (a paused
    task that was resumed has a sandbox to read again). */
function liveChangesWanted(name, stateName) {
  const c = liveChangesOf(name);
  if (c.loading) return;
  if (!c.at || (stateName && c.forState && stateName !== c.forState)) Promise.resolve().then(() => liveLoadChanges(name));
}
/** Redraws only this section, so an open diff keeps its place, and the count on the Changes tab. */
function liveChangesPaint(name) {
  const box = $('#live-changes');
  if (box && box.dataset && box.dataset.task === name) box.innerHTML = liveChangesInnerHTML(name);
  const cnt = $('#count-changes');
  if (cnt && liveRouteTask() === name) { const n = liveChangesCount(name); cnt.textContent = n ? String(n) : ''; cnt.hidden = !n; }
}
/** How many files the task changed and hasn't pushed, once Studio has read them. 0 before that. */
function liveChangesCount(name) {
  const c = LIVE.changes[name];
  return c && c.data && c.data.available && c.data.files ? c.data.files.length : 0;
}

/* ---------- The section on a task's page ---------- */
function liveFileHTML(c, f, name) {
  const lines = livePatchLines(f.patch);
  const shown = lines.length > LIVE_DIFF_MAX ? lines.slice(0, LIVE_DIFF_MAX) : lines;
  const body = !lines.length ? '<p class="small muted" style="padding:10px 12px">No text to show for this file.</p>'
    : `<div class="diff-wrap" tabindex="0" role="region" aria-label="Changes to ${esc(f.path)}"><table class="diff" role="presentation">${diffRows({ lines: shown })}</table></div>
       ${lines.length > LIVE_DIFF_MAX ? `<p class="xsmall muted" style="padding:8px 12px">Showing the first ${LIVE_DIFF_MAX.toLocaleString()} of ${lines.length.toLocaleString()} lines.</p>` : ''}`;
  return `<details class="live-file" data-live-file="${esc(f.path)}" ${c.open[f.path] ? 'open' : ''}>
      <summary>${icon('chevRight', 'sm chev')}<span class="lf-status">${LIVE_FILE_STATUS[f.status] || 'Changed'}</span><span class="lf-path">${esc(f.path)}</span>
        <span class="diffstat"><span class="a">+${Number(f.additions) || 0}</span><span class="d">−${Number(f.deletions) || 0}</span></span>
        <button type="button" class="btn ghost sm" data-action="live-changes-discard" data-task="${esc(name || '')}" data-file="${esc(f.path)}" style="margin-left:8px" aria-label="Discard changes to ${esc(f.path)}">${icon('undo', 'xs')}Discard…</button></summary>
      ${c.open[f.path] ? body : ''}</details>`;
}
function liveChangesInnerHTML(name) {
  const c = liveChangesOf(name);
  const d = c.data;
  const files = (d && d.available && d.files) || [];
  const add = files.reduce((n, f) => n + (Number(f.additions) || 0), 0), del = files.reduce((n, f) => n + (Number(f.deletions) || 0), 0);
  let body;
  if (c.error) body = `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere"><strong>Studio couldn't read the sandbox.</strong> ${esc(c.error)}</div></div>`;
  else if (!d) body = `<p class="small muted" style="margin-top:10px">${icon('loader', 'xs')} Reading the sandbox…</p>`;
  else if (!d.available) body = `<p class="small" style="margin-top:10px" id="live-changes-why">${esc(liveChangesWhy(d.reason))}</p>`;
  else if (!files.length) body = `<p class="small" style="margin-top:10px" id="live-changes-none">Nothing to push: the files match the last commit${d.branch ? ` on <span class="mono">${esc(d.branch)}</span>` : ''}.</p>`;
  else {
    body = `<p class="small" style="margin-top:10px" id="live-changes-sum">${plural(files.length, 'file')} changed${d.branch ? ` on <span class="mono">${esc(d.branch)}</span>` : ''} <span class="diffstat" style="margin-left:6px"><span class="a">+${add}</span><span class="d">−${del}</span></span></p>
      <div style="margin-top:10px" id="live-changes-files">${files.map((f) => liveFileHTML(c, f, name)).join('')}</div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary sm" data-action="live-changes-push" data-task="${esc(name)}">${icon('branch', 'sm')}Push to a branch…</button>
        <button class="btn sm" data-action="live-changes-apply" data-task="${esc(name)}">${icon('download', 'sm')}Apply to a folder on this computer…</button>
      </div>`;
  }
  return `<h2 id="live-changes-h" class="sr-only">Changes</h2>
    <div class="log-bar"><span class="lb-text">What the agent changed in its sandbox and hasn't pushed.</span>
      <span class="lb-actions"><button class="btn ghost sm" data-action="live-changes-refresh" data-task="${esc(name)}" ${c.loading ? 'disabled' : ''}>${icon(c.loading ? 'loader' : 'refresh', 'sm')}${c.loading ? 'Reading…' : 'Refresh'}</button></span></div>
    ${c.note ? `<div class="callout" role="status" style="margin-top:12px" id="live-changes-note">${icon('check')}<div style="overflow-wrap:anywhere">${c.note}</div></div>` : ''}
    ${body}`;
}
/** The Changes tab, for a task with debug access. '' for any other task. */
function liveChangesHTML(name, t, stateName) {
  if (!t.debug) return '';
  liveChangesWanted(name, stateName);
  return `<section aria-labelledby="live-changes-h" id="live-changes" data-task="${esc(name)}">${liveChangesInnerHTML(name)}</section>`;
}

/* ---------- Push to a branch ---------- */
function liveOpenPush(name) {
  const row = LIVE.tasks.find((t) => t.name === name);
  const p = { branch: `ax/${name}`, message: ((row && row.goal) || '').split('\n')[0].slice(0, 72) || `Changes from ${name}`, busy: false, error: '' };
  const dlg = openDialog(dialogShell('lpb', 'Push changes to a branch', '', '<div id="lpb-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="lpb-go">${icon('branch', 'sm')}Push</button>`, false, 'branch'));
  const paint = () => {
    const body = $('#lpb-body', dlg);
    if (!body) return;
    body.innerHTML = `
      <p class="small">AX Studio commits everything the agent changed in the sandbox and pushes it to the repo it cloned, as this branch. Nothing on this computer changes.</p>
      <label class="small" style="display:grid;gap:4px;margin-top:12px" for="lpb-branch">Branch
        <input class="input mono" type="text" id="lpb-branch" value="${esc(p.branch)}" autocomplete="off" spellcheck="false" ${p.busy ? 'disabled' : ''}></label>
      <label class="small" style="display:grid;gap:4px;margin-top:10px" for="lpb-message">Commit message
        <input class="input" type="text" id="lpb-message" value="${esc(p.message)}" autocomplete="off" ${p.busy ? 'disabled' : ''}></label>
      <p class="xsmall muted" style="margin-top:8px">The push runs inside the sandbox. The task's network rules must allow the Git host and supply a credential that can push.</p>
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.error)}</div></div>` : ''}`;
    $('#lpb-branch', body).addEventListener('input', (e) => { p.branch = e.target.value; });
    $('#lpb-message', body).addEventListener('input', (e) => { p.message = e.target.value; });
    const go = $('#lpb-go', dlg);
    go.disabled = p.busy;
    go.innerHTML = p.busy ? `${icon('loader', 'sm')}Pushing…` : `${icon('branch', 'sm')}Push`;
  };
  $('#lpb-go', dlg).addEventListener('click', async () => {
    if (p.busy) return;
    if (!p.branch.trim()) { p.error = 'Give the branch a name.'; paint(); return; }
    p.busy = true; p.error = '';
    paint();
    try {
      const r = await studioPost('/api/tasks/push-branch', { context: LIVE.context, atespace: LIVE.atespace, task: name, branch: p.branch.trim(), commitMessage: p.message.trim() });
      closeDialog(true);
      const c = liveChangesOf(name);
      c.note = `Pushed to <span class="mono">${esc(r.branch || p.branch.trim())}</span>${r.commitSha ? ` at <span class="mono">${esc(r.commitSha)}</span>` : ''}. Open a pull request from that branch on your Git host.`;
      toast(`Pushed <span class="mono">${esc(r.branch || p.branch.trim())}</span>`, { icon: 'branch' });
      announce(`Pushed ${r.branch || p.branch.trim()}`);
      liveLoadChanges(name);
    } catch (e) {
      p.busy = false; p.error = e.message;
      paint();
    }
  });
  paint();
}

/* ---------- Apply to a folder on this computer ---------- */
function liveOpenApply(name) {
  let last = '';
  try { last = localStorage.getItem(LIVE_APPLY_KEY) || ''; } catch (e) { /* ignore */ }
  const p = { path: last, busy: false, error: '' };
  const dlg = openDialog(dialogShell('lap', 'Apply changes to a folder on this computer', '', '<div id="lap-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary" id="lap-go">${icon('download', 'sm')}Apply</button>`, false, 'download'));
  const paint = () => {
    const body = $('#lap-body', dlg);
    if (!body) return;
    body.innerHTML = `
      <p class="small">AX Studio applies the changes to a Git checkout on this computer, the way <code>git apply</code> does. It checks first, and changes nothing if they don't fit.</p>
      <label class="small" style="display:grid;gap:4px;margin-top:12px" for="lap-path">Folder
        <input class="input mono" type="text" id="lap-path" value="${esc(p.path)}" placeholder="~/code/project" autocomplete="off" spellcheck="false" ${p.busy ? 'disabled' : ''}></label>
      <p class="xsmall muted" style="margin-top:8px">It must be a Git checkout of the same repo. Nothing is committed for you.</p>
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere;white-space:pre-wrap">${esc(p.error)}</div></div>` : ''}`;
    $('#lap-path', body).addEventListener('input', (e) => { p.path = e.target.value; });
    const go = $('#lap-go', dlg);
    go.disabled = p.busy;
    go.innerHTML = p.busy ? `${icon('loader', 'sm')}Applying…` : `${icon('download', 'sm')}Apply`;
  };
  $('#lap-go', dlg).addEventListener('click', async () => {
    if (p.busy) return;
    const path = p.path.trim();
    if (!path) { p.error = 'Give the folder: a full path, or one that starts with ~/'; paint(); return; }
    p.busy = true; p.error = '';
    paint();
    try {
      const r = await studioPost('/api/tasks/apply-local', { context: LIVE.context, atespace: LIVE.atespace, task: name, localRepoPath: path });
      p.busy = false;
      if (!r.applied) {
        p.error = `The changes don't fit that folder as it is now, so nothing was changed. Push them to a branch instead.${r.detail ? `\n${r.detail}` : ''}`;
        paint();
        return;
      }
      try { localStorage.setItem(LIVE_APPLY_KEY, path); } catch (e) { /* ignore */ }
      closeDialog(true);
      const c = liveChangesOf(name);
      c.note = `Applied ${plural(r.filesApplied || 0, 'file')} to <span class="mono">${esc(r.localRepoPath || path)}</span>. Nothing was committed.`;
      toast(`Applied to <span class="mono">${esc(r.localRepoPath || path)}</span>`, { icon: 'check' });
      announce(`Applied the changes to ${r.localRepoPath || path}`);
      liveChangesPaint(name);
    } catch (e) {
      p.busy = false; p.error = e.message;
      paint();
    }
  });
  paint();
}

/* ---------- Discard a single file inside the sandbox ---------- */
function liveOpenDiscard(name, filePath) {
  if (!name || !filePath) return;
  const p = { busy: false, error: '' };
  const dlg = openDialog(dialogShell('ldc', `Discard changes to ${esc(filePath)}?`, '', '<div id="ldc-body"></div>', `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="ldc-go">${icon('undo', 'sm')}Discard file</button>`, false, 'undo'));
  const paint = () => {
    const body = $('#ldc-body', dlg);
    if (!body) return;
    body.innerHTML = `
      <p class="small">This restores <span class="mono">${esc(filePath)}</span> inside the sandbox to the last commit (or removes it if it is a new untracked file). It can't be undone.</p>
      <div style="margin-top:12px">${cliHint(liveCmd(['ssh', name, '--', 'git', 'checkout', '--', filePath]))}</div>
      ${p.error ? `<div class="callout warn" role="alert" style="margin-top:12px">${icon('alert')}<div style="overflow-wrap:anywhere">${esc(p.error)}</div></div>` : ''}`;
    const go = $('#ldc-go', dlg);
    go.disabled = p.busy;
    go.innerHTML = p.busy ? `${icon('loader', 'sm')}Discarding…` : `${icon('undo', 'sm')}Discard file`;
  };
  $('#ldc-go', dlg).addEventListener('click', async () => {
    if (p.busy) return;
    p.busy = true; p.error = '';
    paint();
    try {
      await studioApi.discardFile(LIVE.context, LIVE.atespace, name, filePath);
      closeDialog(true);
      const c = liveChangesOf(name);
      delete c.open[filePath];
      c.note = `Discarded changes to <span class="mono">${esc(filePath)}</span>.`;
      toast(`Discarded <span class="mono">${esc(filePath)}</span>`, { icon: 'undo' });
      announce(`Discarded ${filePath}`);
      liveLoadChanges(name);
    } catch (e) {
      p.busy = false; p.error = e.message;
      paint();
    }
  });
  paint();
}

const LIVE_CHANGES_ACTIONS = {
  'live-changes-refresh': (el) => { liveChangesOf(el.dataset.task).note = ''; liveLoadChanges(el.dataset.task); },
  'live-changes-push': (el) => liveOpenPush(el.dataset.task),
  'live-changes-apply': (el) => liveOpenApply(el.dataset.task),
  'live-changes-discard': (el, e) => { if (e && e.preventDefault) e.preventDefault(); liveOpenDiscard(el.dataset.task, el.dataset.file); },
};
if (LIVE.on) {
  /* Opening a file draws its diff. Which files are open is kept while the page redraws. */
  document.addEventListener('toggle', (e) => {
    const el = e.target;
    const path = el && el.dataset && el.dataset.liveFile;
    const box = path && el.closest('#live-changes');
    if (!box) return;
    const c = liveChangesOf(box.dataset.task);
    if (!!c.open[path] === el.open) return;
    c.open[path] = el.open;
    liveChangesPaint(box.dataset.task);
    /* The redraw replaced the row you just opened or closed: put the keyboard back on it. */
    const again = $$('details[data-live-file]', box).find((x) => x.dataset.liveFile === path);
    const summary = again && again.querySelector('summary');
    if (summary) summary.focus({ preventScroll: true });
  }, true);
}
