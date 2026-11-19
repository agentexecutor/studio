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

/* AX Studio, live mode: workspaces and Gateways.

   A task starts from a Workspace (its repositories, files and setup) and reaches the network through a Gateway (its
   network rules). Both outlive the tasks that use them, so they pile up as tasks are deleted. Home lists them under the
   tasks, says which tasks use each, and deletes the ones no task uses, as `ax get` and `ax delete` do. Deleting a task
   can take its own workspace and network rules with it. A task's page says when its workspace couldn't be set up. */

LIVE.res = { ctx: null, at: 0, loading: false, workspaces: [], gateways: [], models: [], error: '' };
const LIVE_RES_MS = 20000;
LIVE.resBusy = {};             // "workspace/name" -> true while it's being deleted

/* ---------- Reading ---------- */
async function liveLoadResources() {
  const R = LIVE.res;
  if (R.loading || !LIVE.context || liveLocalDown()) return;
  const ctx = LIVE.context;
  R.loading = true;
  try {
    const q = studioQuery({ context: ctx, atespace: LIVE.atespace });
    /* Models are read-only here, and an older AX may not list them: that isn't an error. */
    const [w, g, m] = await Promise.all([studioGet('/api/workspaces' + q), studioGet('/api/gateways' + q), studioGet('/api/models' + q).catch(() => ({ models: [] }))]);
    if (ctx !== LIVE.context) return;
    Object.assign(R, { ctx, workspaces: w.workspaces || [], gateways: g.gateways || [], models: m.models || [], error: '' });
  } catch (e) {
    if (ctx !== LIVE.context) return;
    Object.assign(R, { ctx, error: e.message });
  } finally {
    R.loading = false;
    R.at = Date.now();
  }
  const part = parseRoute().parts[0];
  if (part === '' || part === undefined || part === 'task') render({ keepScroll: true, background: true });
}
/** Reads them when a page that shows them opens, and again when they're older than LIVE_RES_MS. */
function liveResWanted() {
  const R = LIVE.res;
  if (R.loading || !LIVE.context || liveLocalDown()) return;
  if (R.ctx !== LIVE.context || Date.now() - R.at > LIVE_RES_MS) Promise.resolve().then(liveLoadResources);
}
function liveResFresh() { return LIVE.res.ctx === LIVE.context && LIVE.res.at > 0; }
/** The tasks on this cluster that use a workspace or a Gateway. */
function liveResUsers(kind, name) {
  return LIVE.tasks.filter((t) => { const sp = (t.doc && t.doc.spec) || {}; return sp[kind] && sp[kind].name === name; });
}
function liveResName(doc) { return (doc && doc.metadata && doc.metadata.name) || ''; }
/** A task's own workspace, as AX reports it (with its phase and its last setup error). */
function liveTaskWorkspace(spec) {
  const ws = spec && spec.workspace && spec.workspace.name;
  return ws && liveResFresh() ? LIVE.res.workspaces.find((w) => liveResName(w) === ws) || null : null;
}
const LIVE_WS_PHASE = { Ready: ['done', 'checkCircle', 'Ready'], Preparing: ['running', 'loader', 'Setting up'], Failed: ['failed', 'xCircle', 'Setup failed'] };

/* ---------- On Home ---------- */
function liveResRowHTML(kind, doc) {
  const name = liveResName(doc);
  const users = liveResUsers(kind, name);
  const busy = LIVE.resBusy[`${kind}/${name}`];
  const st = (doc && doc.status) || {};
  let state = '', why = '';
  if (kind === 'workspace') {
    const ph = LIVE_WS_PHASE[st.phase];
    if (ph) state = `<span class="chip ${ph[0]}">${icon(ph[1])}${ph[2]}</span>`;
    if (st.phase === 'Failed' && st.lastSetupError) why = `<div class="rr-why">${esc(st.lastSetupError)}</div>`;
  } else {
    const hosts = typeof liveGatewayRules === 'function' ? liveGatewayRules(doc).hosts : [];
    state = `<span class="rr-meta">${hosts.length ? plural(hosts.length, 'site') : 'No sites'}</span>`;
  }
  const used = users.length
    ? `Used by ${users.slice(0, 2).map((t) => `<a href="#/task/${encodeURIComponent(t.name)}" class="mono">${esc(t.name)}</a>`).join(', ')}${users.length > 2 ? ` and ${users.length - 2} more` : ''}`
    : '<span class="rr-unused">No task uses it</span>';
  const del = `<button type="button" class="btn ghost sm" data-action="live-res-delete" data-kind="${kind}" data-name="${esc(name)}" ${users.length || busy ? 'disabled' : ''} ${users.length ? `title="${esc(`Used by ${plural(users.length, 'task')}`)}"` : ''} aria-label="Delete ${kind === 'workspace' ? 'workspace' : 'Gateway'} ${esc(name)}">${icon(busy ? 'loader' : 'trash', 'sm')}${busy ? 'Deleting…' : 'Delete…'}</button>`;
  return `<li class="res-row" id="live-res-${kind}-${esc(name)}"><span class="rr-ic" aria-hidden="true">${icon(kind === 'workspace' ? 'folder' : 'shield', 'sm')}</span>
    <div class="rr-main"><div class="rr-name"><span class="mono">${esc(name)}</span>${state}</div><div class="rr-used">${used}</div>${why}</div>${del}</li>`;
}
/** A model resource: what it calls, and the key it uses. Read-only: tasks name models in their own config. */
function liveModelRowHTML(doc) {
  const name = liveResName(doc);
  const sp = (doc && doc.spec) || {};
  const key = sp.secretKey && sp.secretKey.name;
  return `<li class="res-row" id="live-res-model-${esc(name)}"><span class="rr-ic" aria-hidden="true">${icon('sparkle', 'sm')}</span>
    <div class="rr-main"><div class="rr-name"><span class="mono">${esc(name)}</span>${sp.provider ? `<span class="rr-meta">${esc(sp.provider)}</span>` : ''}</div>
      <div class="rr-used">${sp.model ? `<span class="mono">${esc(sp.model)}</span>` : 'No model named'}${key ? ` · key from <span class="mono">${esc(key)}</span>` : ''}</div></div></li>`;
}
/** Home's section under the tasks: what this cluster keeps besides tasks, folded to one line unless something's wrong. */
function liveResHTML() {
  liveResWanted();
  const R = LIVE.res;
  if (!liveResFresh()) return R.error && R.ctx === LIVE.context ? `<p class="xsmall muted live-res-err">Couldn't list workspaces and Gateways: ${esc(R.error)}</p>` : '';
  const ws = R.workspaces, gw = R.gateways, md = R.models || [];
  if (!ws.length && !gw.length && !md.length) return '';
  const unused = ws.filter((d) => !liveResUsers('workspace', liveResName(d)).length).length + gw.filter((d) => !liveResUsers('gateway', liveResName(d)).length).length;
  const failed = ws.filter((d) => d.status && d.status.phase === 'Failed').length;
  const sum = [ws.length ? plural(ws.length, 'workspace') : '', gw.length ? plural(gw.length, 'Gateway') : '', md.length ? plural(md.length, 'model') : ''].filter(Boolean).join(' · ')
    + (unused ? ` · <span class="fs-warn">${unused} unused</span>` : '') + (failed ? ` · <span class="fs-bad">${failed} failed setup</span>` : '');
  const list = (kind, docs) => docs.length ? `<ul class="res-list" aria-label="${kind === 'workspace' ? 'Workspaces' : 'Gateways'}">${docs.slice().sort((a, b) => liveResName(a).localeCompare(liveResName(b))).map((d) => liveResRowHTML(kind, d)).join('')}</ul>` : '';
  const body = `${ws.length ? `<div class="res-h">Workspaces <span class="muted">· what a task starts from</span></div>${list('workspace', ws)}` : ''}
    ${gw.length ? `<div class="res-h">Gateways <span class="muted">· the network rules: what a task can reach</span></div>${list('gateway', gw)}` : ''}
    ${md.length ? `<div class="res-h">Models <span class="muted">· what tasks can call by name</span></div><ul class="res-list" aria-label="Models">${md.slice().sort((a, b) => liveResName(a).localeCompare(liveResName(b))).map(liveModelRowHTML).join('')}</ul>` : ''}
    <p class="xsmall muted" style="margin-top:10px">${icon('terminal', 'xs')} <code>${esc(liveCmd(['get', 'workspaces']))}</code> · <code>${esc(liveCmd(['get', 'gateways']))}</code>${md.length ? ` · <code>${esc(liveCmd(['get', 'models']))}</code>` : ''}</p>`;
  return `<section class="live-res" id="live-res" aria-labelledby="live-res-h">
      <div class="live-list-head"><h2 class="h-display-sm" id="live-res-h">${md.length ? 'Workspaces, Gateways and models' : 'Workspaces and Gateways'}</h2>
        ${unused ? `<button type="button" class="btn sm" data-action="live-res-delete-unused">${icon('trash', 'sm')}Delete ${unused} unused…</button>` : ''}</div>
      <div class="card card-pad res-card">${liveFoldHTML('live-fold-res', '', sum, body, failed > 0)}</div>
    </section>`;
}

/* ---------- Deleting ---------- */
async function liveResDelete(kind, name) {
  const key = `${kind}/${name}`;
  LIVE.resBusy[key] = true;
  render({ keepScroll: true });
  try {
    await studioPost(`/api/${kind === 'workspace' ? 'workspaces' : 'gateways'}/delete`, { context: LIVE.context, atespace: LIVE.atespace, name });
    const list = kind === 'workspace' ? LIVE.res.workspaces : LIVE.res.gateways;
    const i = list.findIndex((d) => liveResName(d) === name);
    if (i >= 0) list.splice(i, 1);
    return '';
  } catch (e) {
    return e.message;
  } finally {
    delete LIVE.resBusy[key];
  }
}
const LIVE_RES_WORDS = { workspace: 'workspace', gateway: 'Gateway' };
function liveOpenDeleteRes(kind, name) {
  if (liveResUsers(kind, name).length) return;
  const cmd = liveCmd(['delete', kind, name]);
  const dlg = openDialog(dialogShell('lrd', `Delete ${LIVE_RES_WORDS[kind]} ${esc(name)}?`, '', `
    <p class="small">${kind === 'workspace' ? "No task uses this workspace. Deleting it removes its setup and the snapshot tasks start from. It can't be undone."
      : "No task uses this Gateway. Deleting it can't be undone. A task that's already running keeps the rules it started with."}</p>
    <div style="margin-top:14px">${cliHint(cmd)}</div>`, `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="lrd-go">${icon('trash', 'sm')}Delete</button>`, false, 'trash'));
  $('#lrd-go', dlg).addEventListener('click', async () => {
    closeDialog(true);
    const err = await liveResDelete(kind, name);
    toast(err ? `Couldn't delete <span class="mono">${esc(name)}</span>: ${esc(err)}` : `Deleted <span class="mono">${esc(name)}</span>`, { icon: err ? 'alert' : 'trash', timeout: err ? 9000 : 4000 });
    render({ keepScroll: true });
  });
}
function liveOpenDeleteUnused() {
  const unused = [].concat(
    LIVE.res.workspaces.map((d) => ['workspace', liveResName(d)]).filter(([k, n]) => !liveResUsers(k, n).length),
    LIVE.res.gateways.map((d) => ['gateway', liveResName(d)]).filter(([k, n]) => !liveResUsers(k, n).length));
  if (!unused.length) return;
  const dlg = openDialog(dialogShell('lru', `Delete ${plural(unused.length, 'unused item')}?`, '', `
    <p class="small">No task on <span class="mono">${esc(LIVE.context)}</span> uses these. Deleting them can't be undone.</p>
    <ul class="live-steps">${unused.map(([k, n]) => `<li>${k === 'workspace' ? 'Workspace' : 'Gateway'} <span class="mono">${esc(n)}</span></li>`).join('')}</ul>`,
  `<span class="left"></span><button class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn danger" id="lru-go">${icon('trash', 'sm')}Delete ${unused.length}</button>`, false, 'trash'));
  $('#lru-go', dlg).addEventListener('click', async () => {
    closeDialog(true);
    const failed = [];
    for (const [k, n] of unused) { const err = await liveResDelete(k, n); if (err) failed.push(`${n}: ${err}`); }
    const done = unused.length - failed.length;
    toast(failed.length ? `Deleted ${done} of ${unused.length}. ${esc(failed[0])}` : `Deleted ${plural(done, 'unused item')}`, { icon: failed.length ? 'alert' : 'trash', timeout: failed.length ? 9000 : 4000 });
    render({ keepScroll: true });
  });
}
/** What deleting a task can take with it: its workspace and network rules, when no other task uses them. Checked when
    they were made for this task (Studio names them ws-<task> and gw-<task>). */
function liveTaskLeftovers(name) {
  const t = LIVE.tasks.find((x) => x.name === name) || (LIVE.detail[name] && LIVE.detail[name].doc ? { name, doc: LIVE.detail[name].doc } : null);
  const sp = (t && t.doc && t.doc.spec) || {};
  return [['workspace', sp.workspace && sp.workspace.name], ['gateway', sp.gateway && sp.gateway.name]]
    .filter(([, n]) => n)
    .filter(([k, n]) => liveResUsers(k, n).every((x) => x.name === name))
    .map(([k, n]) => ({ kind: k, name: n, own: n === `${k === 'workspace' ? 'ws' : 'gw'}-${name}` }));
}

const LIVE_RES_ACTIONS = {
  'live-res-delete': (el) => liveOpenDeleteRes(el.dataset.kind, el.dataset.name),
  'live-res-delete-unused': () => liveOpenDeleteUnused(),
};
