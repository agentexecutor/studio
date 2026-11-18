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

/* AX Studio: the Studio server's API.

   The Studio server (ax-studio) runs on this computer and serves this page. It is the page's only way to AX: it
   reads tasks from the AX server, checks this computer, and runs the ax command where a command is the right tool.

   - STUDIO.on says whether the server is there. It sets window.AX_STUDIO in /env.js. In a plain browser it isn't,
     and nothing in this file is used.
   - Every request carries the session cookie the server sets in /api/bootstrap. Requests that change something
     also carry a token the server only gives to this page, so no other website can send them.
   - The server pushes progress (setup output, for example) over /api/events. */

const STUDIO = {
  on: typeof window !== 'undefined' && !!(window.AX_STUDIO && window.AX_STUDIO.server),
  /** Where the pages this UI is replacing are still served, or '' when this build doesn't include them. */
  classic: (typeof window !== 'undefined' && window.AX_STUDIO && window.AX_STUDIO.classic) || '',
  token: '',
  info: null,            // { os, home, pathSeparator, axNamespace, version }, from /api/bootstrap
  booting: null,
  events: null,
  listeners: {},         // event type -> Set of callbacks
};

/** What went wrong with a request: the server's own words, the HTTP status (0 when the server didn't answer), and
    the AX status code by name when AX refused ("NotFound", "ResourceExhausted"). */
class StudioError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'StudioError';
    this.status = status || 0;
    this.code = code || '';
  }
}

async function studioFetch(path, init) {
  try {
    return await fetch(path, Object.assign({ credentials: 'same-origin' }, init));
  } catch (e) {
    throw new StudioError("AX Studio isn't answering. Check that ax studio is still running in your terminal.", 0);
  }
}
async function studioFail(res) {
  let message = '';
  let code = '';
  const text = await res.text().catch(() => '');
  try { const body = JSON.parse(text); message = body.error || ''; code = body.code || ''; } catch (e) { message = text.trim(); }
  return new StudioError(message || `The request failed (${res.status})`, res.status, code);
}

/** Starts the session: the server sets its cookie and hands over the token for changes. */
function studioBootstrap(force) {
  if (STUDIO.token && STUDIO.info && !force) return Promise.resolve(STUDIO.info);
  if (!STUDIO.booting) {
    STUDIO.booting = (async () => {
      const res = await studioFetch('/api/bootstrap');
      if (!res.ok) throw await studioFail(res);
      const data = await res.json();
      STUDIO.token = data.csrfToken || '';
      STUDIO.info = { os: data.os, home: data.home, pathSeparator: data.pathSeparator, axNamespace: data.axNamespace || 'ax-system', version: data.version };
      studioListen();
      return STUDIO.info;
    })().finally(() => { STUDIO.booting = null; });
  }
  return STUDIO.booting;
}

/** Reads from the server. A session that ran out is started again, once. */
async function studioGet(path) {
  await studioBootstrap();
  let res = await studioFetch(path);
  if (res.status === 401) { await studioBootstrap(true); res = await studioFetch(path); }
  if (!res.ok) throw await studioFail(res);
  return res.json();
}

/** Asks the server to change something. */
async function studioPost(path, body) {
  await studioBootstrap();
  const send = () => studioFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-AX-CSRF-Token': STUDIO.token },
    body: JSON.stringify(body || {}),
  });
  let res = await send();
  /* 401: the session ran out. 403 from the token check: the server restarted and has a new token. */
  let retry = res.status === 401;
  if (res.status === 403) {
    const err = await studioFail(res.clone());
    retry = /CSRF/i.test(err.message);
  }
  if (retry) { await studioBootstrap(true); res = await send(); }
  if (!res.ok) throw await studioFail(res);
  return res.json();
}

/** A query string from the values that are set. */
function studioQuery(params) {
  const q = Object.keys(params).filter((k) => params[k] != null && params[k] !== '').map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  return q ? `?${q}` : '';
}

/* ---------- Events the server pushes ---------- */
function studioListen() {
  if (STUDIO.events || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/events');
  STUDIO.events = es;
  es.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    const set = STUDIO.listeners[msg.type];
    if (set) set.forEach((cb) => { try { cb(msg.payload); } catch (e) { /* one listener doesn't stop the others */ } });
  };
  /* The browser reconnects on its own. If the stream was closed for good (the session ran out), the next
     bootstrap opens a new one. */
  es.onerror = () => { if (es.readyState === 2 && STUDIO.events === es) STUDIO.events = null; };
}
/** Calls cb for each event of this type ("envOp", "streamLine", "sessionData", "sessionExit"). Returns the way to stop. */
function studioOn(type, cb) {
  (STUDIO.listeners[type] = STUDIO.listeners[type] || new Set()).add(cb);
  return () => STUDIO.listeners[type].delete(cb);
}

/* ---------- The calls ---------- */
const studioApi = {
  /** This computer and the clusters in your kubeconfig: checks, AX on this computer, contexts, and any setup in progress. */
  env: () => studioGet('/api/env/status'),
  /** Sets up or starts AX on this computer (ax local start). Progress comes as "envOp" and "streamLine" events. */
  localUp: (images) => studioPost('/api/env/local/up', Object.assign({ name: 'ax-local', workers: 1 }, images)),
  localStop: () => studioPost('/api/env/local/stop', { name: 'ax-local' }),
  localDelete: () => studioPost('/api/env/local/delete', { name: 'ax-local' }),

  /** Tasks, read from the AX server as data. */
  tasks: (context, atespace) => studioGet('/api/tasks' + studioQuery({ context, atespace })),
  task: (context, atespace, name) => studioGet('/api/tasks/get' + studioQuery({ context, atespace, name })),
  /** verb is suspend, resume or delete. */
  taskAction: (verb, context, atespace, name) => studioPost(`/api/tasks/${verb}`, { context, atespace, name }),
  discardFile: (context, atespace, task, path) => studioPost('/api/tasks/discard-file', { context, atespace, task, path }),

  /** Interactive ax ssh terminal sessions. Output arrives as "sessionData" and "sessionExit" events. */
  sessionStart: (id, args) => studioPost('/api/sessions/start', { id, args }),
  sessionWrite: (id, data) => studioPost('/api/sessions/write', { id, data }),
  sessionInterrupt: (id) => studioPost('/api/sessions/interrupt', { id }),
  sessionEOF: (id) => studioPost('/api/sessions/eof', { id }),
  sessionClose: (id) => studioPost('/api/sessions/close', { id }),

  /** Runs one of the ax subcommands the server allows. Answers { status, stdout, stderr }. */
  ax: (args, stdin) => studioPost('/api/ax/exec', { program: 'ax', args, stdin: stdin || '' }),
};
