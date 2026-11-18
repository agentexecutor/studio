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

/* AX Studio — sanctuary-themed SVG/HTML visualizations (strict single-Axel discipline). */
'use strict';

/* ---------- Home Sanctuary Pool: subtle surface ripples around the single Axel ---------- */
function springPoolHTML(mood, tone, id) {
  return `<div class="spring-pool tone-${tone || 'calm'}">
    <svg class="spring-rings" viewBox="0 0 240 200" aria-hidden="true" focusable="false">
      <ellipse cx="122" cy="148" rx="62" ry="18" class="sr-r sr-1"/>
      <ellipse cx="122" cy="148" rx="88" ry="26" class="sr-r sr-2"/>
      <ellipse cx="122" cy="148" rx="112" ry="34" class="sr-r sr-3"/>
      <circle cx="52" cy="54" r="2.5" class="sr-mote"/>
      <circle cx="196" cy="44" r="2" class="sr-mote m2"/>
    </svg>
    <button type="button" class="axo-btn" data-action="poke" aria-label="Say hi to Axel">${axo(mood, { decorative: true, id: id || 'hero-axo' }).replace('<svg ', '<svg data-follow ')}</button>
  </div>`;
}

/* ---------- Task journey: Start → Plan → Build → Test → Review → Ship ---------- */
const JOURNEY = [
  { k: 'start', label: 'Start', hint: 'Sandbox starting' },
  { k: 'plan', label: 'Plan', hint: 'Reads code and plans' },
  { k: 'build', label: 'Build', hint: 'Edits sandbox copy' },
  { k: 'test', label: 'Test', hint: 'Runs checks & tests' },
  { k: 'review', label: 'Review', hint: 'You review every file' },
  { k: 'ship', label: 'Ship', hint: 'Push branch or PR' },
];
function stageOf(t) {
  const ev = t.events;
  const lastEdit = ev.reduce((k, e, i) => (e.type === 'edit' ? i : k), -1);
  const tested = lastEdit >= 0 && ev.some((e, i) => i > lastEdit && e.type === 'tool' && /test|pytest|reencode/.test(e.cmd || ''));
  const working = ev.some((e) => e.type === 'thought' || e.type === 'handoff' || (e.type === 'tool' && e.title !== 'started the agent'));
  /* A task that failed before its agent started stays on Start, so the red marker points at the real problem. */
  const fail = t.status === 'failed' ? ev.slice().reverse().find((e) => e.type === 'fail') : null;
  const failedAtStart = !!fail && /^(handoff-start|image-unavailable|key-rejected|repo-denied|mcp-failed)$/.test(fail.code || '');
  let i = 0;
  if (t.status === 'done') i = t.pushed ? 5 : 4;
  else if (t.status === 'starting' || failedAtStart) i = 0;
  else if (lastEdit >= 0) i = tested ? 3 : 2;
  else if (working) i = 1;
  return i;
}
/** Where the task is, as a mini track: six short bars (done, current, to do) and the current stage's name. It lives in
    the task header, in the top bar once the header scrolls away, and in each Home row. (v12: the big progress track
    under the task header is gone.) The tooltip and label say the step, what it means and any attention state. */
function journeyHTML(t) {
  const i = stageOf(t);
  const s = JOURNEY[i];
  const attn = t.status === 'failed' ? 'stopped here' : isPaused(t) ? 'paused' : t.status === 'blocked' || t.status === 'waiting' ? 'waiting on you' : '';
  const what = `Step ${i + 1} of 6: ${s.label}${attn ? ', ' + attn : ''}`;
  return `<span class="mini-journey" role="img" aria-label="${esc(what)}" title="${esc(what)}. ${esc(s.hint)}.">${JOURNEY.map((x, k) =>
    `<i class="${k < i ? 'ok' : k === i ? 'now ' + t.status : ''}"></i>`).join('')}<b>${s.label}</b></span>`;
}

/* ---------- Ring gauge ---------- */
function ring(pct, label, sub, color) {
  const r = 26, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct));
  return `<div class="ring" style="--ring:${color || 'var(--key)'}">
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle class="ring-track" cx="32" cy="32" r="${r}"/>
      <circle class="ring-val" cx="32" cy="32" r="${r}" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>
    <div class="ring-label"><b>${label}</b>${sub ? `<span>${sub}</span>` : ''}</div></div>`;
}

/* ---------- Weekly bars ---------- */
function weekBars(values, label) {
  const days = [];
  const today = new Date();
  for (let k = 6; k >= 0; k--) { const d = new Date(today); d.setDate(today.getDate() - k); days.push(d.toLocaleDateString([], { weekday: 'narrow' })); }
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return `<figure class="bars" aria-label="${label}: ${total} this week">
    ${values.map((v, k) => `<div class="bar ${k === 6 ? 'today' : ''}" title="${v} on ${days[k]}"><span class="bar-v">${v || ''}</span><span class="bar-col" style="height:${Math.max(6, (v / max) * 100)}%"></span><span class="bar-d">${days[k]}</span></div>`).join('')}
  </figure>`;
}

/* ---------- Sparkline ---------- */
function sparkline(points, w, h, cls) {
  w = w || 120; h = h || 36;
  if (points.length < 2) points = [0, ...points, 0];
  const max = Math.max(...points), min = Math.min(...points);
  const sx = w / (points.length - 1), sy = (h - 6) / Math.max(1, max - min);
  const xy = points.map((p, k) => [k * sx, h - 3 - (p - min) * sy]);
  const d = xy.map(([x, y], k) => (k ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join(' ');
  const last = xy[xy.length - 1];
  return `<svg class="spark ${cls || ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="spark-area" d="${d} L${w} ${h} L0 ${h} Z"/><path class="spark-line" d="${d}"/>
    <circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3"/></svg>`;
}

/* ---------- Sanctuary Reach Ring (Guardrails hero): Axel once in center, gill-filter boundary ---------- */
function reachMap(allowed, blocked, size) {
  const lg = size === 'lg';
  const W = lg ? 640 : 300, H = lg ? 364 : 230, cx = W / 2, cy = H / 2;
  const rIn = lg ? 54 : 34, rMid = lg ? 78 : 50, rRing = lg ? 118 : 74, rNode = lg ? 154 : 98;
  const maxAllowed = lg ? 7 : 4;
  const shownA = allowed.slice(0, maxAllowed);
  const extra = allowed.length - shownA.length;
  const nodes = shownA.map((d) => ({ d, ok: true })).concat(blocked.slice(0, lg ? 3 : 2).map((b) => ({ d: b.domain, ok: false, org: b.reason === 'org' })));
  const n = nodes.length;
  const fs = lg ? 12 : 10.5;
  const parts = nodes.map((nd, k) => {
    const a = (-90 + (360 / Math.max(1, n)) * (k + 0.5)) * (Math.PI / 180);
    const ca = Math.cos(a), sa = Math.sin(a);
    const x1 = cx + ca * rIn, y1 = cy + sa * rIn;
    const xr = cx + ca * rRing, yr = cy + sa * rRing;
    const x2 = cx + ca * rNode, y2 = cy + sa * rNode;
    const anchor = Math.abs(ca) < 0.3 ? 'middle' : ca > 0 ? 'start' : 'end';
    const tx = x2 + (anchor === 'middle' ? 0 : ca > 0 ? 9 : -9);
    const ty = y2 + (anchor === 'middle' ? (sa > 0 ? 17 : -10) : 4);
    /* A label gets the room it has on its side of the large map (monospace, about 0.6 em a character). */
    const room = anchor === 'middle' ? 2 * Math.min(tx, W - tx) - 8 : anchor === 'start' ? W - tx - 4 : tx - 4;
    const limit = lg ? Math.max(26, Math.floor(room / (fs * 0.6))) : 18;
    const label = nd.d.length > limit ? nd.d.slice(0, limit - 2) + '…' : nd.d;
    if (nd.ok) {
      return `<g class="rm-node ok"><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="rm-link"/>
        <circle r="2.6" class="rm-packet"><animateMotion dur="${2.5 + (k % 3) * 0.5}s" repeatCount="indefinite" path="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}"/></circle>
        <circle cx="${xr.toFixed(1)}" cy="${yr.toFixed(1)}" r="${lg ? 7 : 5.5}" class="rm-gate"/>
        <path d="M${(xr - 3).toFixed(1)} ${yr.toFixed(1)} l2 2 l4 -4" class="rm-gate-mark"/>
        <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="${lg ? 5 : 4}" class="rm-dot"/>
        <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="${fs}" class="rm-text">${esc(label)}</text></g>`;
    }
    return `<g class="rm-node no"><line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${xr.toFixed(1)}" y2="${yr.toFixed(1)}" class="rm-link faint"/>
      <line x1="${xr.toFixed(1)}" y1="${yr.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="rm-link"/>
      <circle cx="${xr.toFixed(1)}" cy="${yr.toFixed(1)}" r="${lg ? 8 : 6}" class="rm-stop"/>
      <path d="M${(xr - 2.6).toFixed(1)} ${(yr - 2.6).toFixed(1)} l5.2 5.2 M${(xr + 2.6).toFixed(1)} ${(yr - 2.6).toFixed(1)} l-5.2 5.2" class="rm-stop-mark"/>
      <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="${lg ? 5 : 4}" class="rm-dot"/>
      <text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}" font-size="${fs}" class="rm-text">${esc(label)}</text></g>`;
  }).join('');
  const axoSize = rIn * 1.48;
  const centerArt = lg
    ? axo('idle', { decorative: true }).replace('<svg class="axo', `<svg data-follow x="${(cx - axoSize / 2).toFixed(1)}" y="${(cy - axoSize / 2 + 1).toFixed(1)}" width="${axoSize.toFixed(1)}" height="${axoSize.toFixed(1)}" style="width:${axoSize.toFixed(1)}px;height:${axoSize.toFixed(1)}px" class="axo`)
    : `<path d="M${cx} ${cy - 10} C${cx - 6} ${cy - 2} ${cx - 8} ${cy + 2} ${cx - 8} ${cy + 6} a8 8 0 0 0 16 0 c0 -4 -2 -8 -8 -16 z" class="gm-drop"/>`;
  return `<svg class="reach-map ${lg ? 'lg' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Reach map: ${allowed.length} sites allowed through Guardrails, ${blocked.length} blocked, 0 raw keys inside the sandbox.">
    <circle cx="${cx}" cy="${cy}" r="${rRing}" class="rm-ring"/>
    <circle cx="${cx}" cy="${cy}" r="${rMid}" class="rm-ripple"/>
    ${parts}
    <circle cx="${cx}" cy="${cy}" r="${rIn}" class="rm-core"/>
    ${centerArt}
    ${lg ? `<text x="${cx}" y="${cy + rIn + 15}" text-anchor="middle" class="gm-cap">Sandbox · 0 raw keys</text>` : ''}
    ${extra > 0 ? `<text x="${W - 8}" y="${H - 8}" text-anchor="end" class="rm-more" font-size="${fs}">+${extra} more allowed</text>` : ''}
  </svg>`;
}

/* ---------- Gate map (compact): Spring Sandbox droplet → Guardrails → sites (ZERO duplicate Axel) ---------- */
function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function gateMap(allowed, blocked, max) {
  max = max || 4;
  blocked = blocked.filter((b) => !allowed.includes(b.domain));
  const rows = allowed.slice(0, max).map((d) => ({ d, ok: true })).concat(blocked.slice(0, 2).map((b) => ({ d: b.domain, ok: false })));
  const extra = Math.max(0, allowed.length - max);
  const rowH = 26, W = 312;
  const H = Math.max(122, rows.length * rowH + 24 + (extra ? 16 : 0));
  const cy = (H - (extra ? 16 : 0)) / 2;
  const gx = 92, bx = 146;
  const y0 = rows.length ? cy - ((rows.length - 1) * rowH) / 2 : cy;
  const parts = rows.map((r, k) => {
    const y = y0 + k * rowH;
    const p = `M${gx + 13} ${cy.toFixed(1)} C${gx + 34} ${cy.toFixed(1)} ${gx + 28} ${y.toFixed(1)} ${bx - 8} ${y.toFixed(1)}`;
    return r.ok
      ? `<g><path d="${p}" class="gm-link"/><circle r="2.3" class="rm-packet"><animateMotion dur="${(1.9 + k * 0.4).toFixed(1)}s" repeatCount="indefinite" path="M48 ${cy.toFixed(1)} L${gx - 13} ${cy.toFixed(1)} ${p.replace('M', 'L')}"/></circle>
        <circle cx="${bx}" cy="${y.toFixed(1)}" r="6.5" class="gm-bead ok"/><path d="M${bx - 3.2} ${y.toFixed(1)} l2.1 2.2 l4.1 -4.3" class="gm-mark ok"/><text x="${bx + 12}" y="${(y + 4).toFixed(1)}" class="gm-text">${esc(trunc(r.d, 20))}</text></g>`
      : `<g><path d="${p}" class="gm-link no"/><circle cx="${bx}" cy="${y.toFixed(1)}" r="6.5" class="gm-bead no"/><path d="M${bx - 2.6} ${(y - 2.6).toFixed(1)} l5.2 5.2 M${bx + 2.6} ${(y - 2.6).toFixed(1)} l-5.2 5.2" class="gm-mark no"/><text x="${bx + 12}" y="${(y + 4).toFixed(1)}" class="gm-text no">${esc(trunc(r.d, 20))}</text></g>`;
  }).join('');
  return `<svg class="gate-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Traffic from the isolated sandbox passes through Guardrails. ${allowed.length} sites allowed${blocked.length ? `, ${blocked.length} blocked` : ''}.">
    <line x1="48" y1="${cy.toFixed(1)}" x2="${gx - 12}" y2="${cy.toFixed(1)}" class="gm-link"/>
    ${parts}
    <circle cx="26" cy="${cy.toFixed(1)}" r="21" class="gm-core"/>
    <circle cx="26" cy="${cy.toFixed(1)}" r="15" class="gm-inner-ring"/>
    <path d="M26 ${(cy - 8.5).toFixed(1)} C21 ${(cy - 2).toFixed(1)} 19.5 ${(cy + 1).toFixed(1)} 19.5 ${(cy + 4).toFixed(1)} a6.5 6.5 0 0 0 13 0 c0 -3 -1.5 -6 -6.5 -12.5 z" class="gm-drop"/>
    <text x="26" y="${(cy + 34).toFixed(1)}" text-anchor="middle" class="gm-cap">Sandbox</text>
    <path d="M${gx - 11} ${(cy - 13).toFixed(1)} h22 v10.5 c0 10 -11 15.5 -11 15.5 c0 0 -11 -5.5 -11 -15.5 z" class="gm-shield"/>
    <path d="M${gx - 4.5} ${(cy - 1).toFixed(1)} l3.4 3.4 l6 -6.6" class="gm-shield-mark"/>
    <text x="${gx}" y="${(cy + 27).toFixed(1)}" text-anchor="middle" class="gm-cap">Guardrails</text>
    ${extra ? `<text x="${bx + 12}" y="${(H - 6).toFixed(1)}" class="gm-more">+${extra} more allowed</text>` : ''}
  </svg>`;
}

/* ---------- Spring-to-Lake Aqueduct (Where agents run): 1 Axel swimming unchanged laptop → K8s ---------- */
function aqueductMap(localActive, clusterActive) {
  const s = 54;
  return `<svg class="aqueduct-map" viewBox="0 0 820 132" role="img" aria-label="Tasks move from this computer to your team's Kubernetes cluster with zero manifest changes and identical guardrails.">
    <rect x="6" y="22" width="218" height="88" rx="14" class="aq-basin"/>
    <circle cx="38" cy="54" r="14" class="aq-icon-bg"/>
    <path d="M31 58V50h14v8M29 58h18" class="aq-stroke"/>
    <text x="60" y="51" class="aq-title">On this computer</text>
    <text x="60" y="68" class="aq-sub">microVM · ${localActive} running</text>
    <text x="115" y="95" text-anchor="middle" class="aq-meta">Starts in ~3s · $0 cloud cost</text>

    <path d="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66" class="aq-stream-bg"/>
    <path d="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66" class="aq-stream"/>
    <circle r="3" class="rm-packet"><animateMotion dur="3.8s" begin="-0.4s" repeatCount="indefinite" path="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66"/></circle>
    <circle r="2.4" class="rm-packet coral"><animateMotion dur="3.8s" begin="-2.3s" repeatCount="indefinite" path="M224 66 C312 46, 364 86, 410 66 C456 46, 508 86, 596 66"/></circle>

    <circle cx="410" cy="56" r="31" class="rm-core"/>
    ${axo(clusterActive ? 'working' : 'idle', { decorative: true }).replace('<svg class="axo', `<svg data-follow x="${410 - s / 2}" y="${56 - s / 2 + 1}" width="${s}" height="${s}" style="width:${s}px;height:${s}px" class="axo`)}
    <text x="410" y="106" text-anchor="middle" class="aq-pill-txt">Same Task + Workspace YAML · 0 lines changed · Same Guardrails</text>

    <rect x="596" y="22" width="218" height="88" rx="14" class="aq-basin lake"/>
    <circle cx="628" cy="54" r="14" class="aq-icon-bg"/>
    <path d="M623 58h11a4 4 0 0 0 .5-7.9A5.5 5.5 0 0 0 624 49a3.5 3.5 0 0 0-1 9Z" class="aq-stroke"/>
    <text x="650" y="51" class="aq-title">On a remote cluster</text>
    <text x="650" y="68" class="aq-sub">Your K8s / GKE · ${clusterActive} running</text>
    <text x="705" y="95" text-anchor="middle" class="aq-meta">Runs lid-closed · 0 lock-in</text>
  </svg>`;
}

/* ---------- Diff blocks (GitHub-style, 5 squares) ---------- */
function diffBlocks(add, del) {
  const t = add + del || 1;
  const a = Math.round((add / t) * 5);
  return `<span class="dblocks" aria-hidden="true">${[0, 1, 2, 3, 4].map((k) => `<i class="${k < a ? 'a' : 'd'}"></i>`).join('')}</span>`;
}

/* ---------- Heartbeat line for "This computer" ---------- */
const HEARTBEAT = `<svg class="heartbeat" viewBox="0 0 54 22" aria-hidden="true"><path d="M1 12 H14 L18 4 L23 19 L27 9 L30 12 H53"/></svg>`;
