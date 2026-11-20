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

/* AX Studio, live mode: getting around and being told.

   - Browser notifications, if you turn them on in Settings: when a task newly needs you (it waits for you, or failed),
     and when setup or an install finishes, while this tab is in the background.
   - Links that open Studio on an atespace: ?atespace=<name>. Copy link puts one for the page you're on on the clipboard.
   - A compact task list, if you prefer more tasks on screen (Settings > Appearance). */

/* ---------- Notifications ---------- */
const LIVE_NOTIFY_KEY = 'ax.live.notify';
LIVE.needsKnown = null; // the tasks that needed you at the last list, or null before the first one on this cluster
function liveNotifyOn() { try { return localStorage.getItem(LIVE_NOTIFY_KEY) === '1'; } catch (e) { return false; } }
function liveNotifySupported() { return typeof Notification !== 'undefined'; }
function liveNotifyPermission() { return liveNotifySupported() ? Notification.permission : 'unsupported'; }
/** Shows a notification while this tab is in the background. Clicking it brings the tab back to `hash`. */
function liveNotify(title, body, hash, tag) {
  if (!liveNotifyOn() || liveNotifyPermission() !== 'granted') return false;
  const away = document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
  if (!away) return false;
  try {
    const n = new Notification(title, { body, tag: tag || title, icon: 'assets/logo.svg' });
    n.onclick = () => { try { window.focus(); } catch (e) { /* ignore */ } if (hash) location.hash = hash; n.close(); };
    return true;
  } catch (e) { return false; }
}
/** After each list: tell about the tasks that need you now and didn't at the last list. Not on the first list of a
    cluster, so opening Studio doesn't ring for what was already waiting. */
function liveNotifyNeeds() {
  const needs = LIVE.tasks.filter((t) => liveState(t.state).rank === 0);
  const names = new Set(needs.map((t) => t.name));
  const known = LIVE.needsKnown;
  LIVE.needsKnown = names;
  if (!known) return;
  needs.filter((t) => !known.has(t.name)).forEach((t) => {
    const detail = t.doc && t.doc.status && t.doc.status.statusDetail && (t.doc.status.statusDetail.detail || '');
    const title = (t.goal || t.name).split('\n')[0].slice(0, 80);
    const body = t.state === 'Failed' ? `Failed${detail ? `: ${detail}` : ''}` : 'Waiting for you';
    liveNotify(title, `${body} · ${t.name}`, `#/task/${encodeURIComponent(t.name)}`, `ax-${t.name}`);
  });
}
async function liveNotifyToggle(on) {
  if (!on) { try { localStorage.removeItem(LIVE_NOTIFY_KEY); } catch (e) { /* ignore */ } return 'off'; }
  if (!liveNotifySupported()) return 'unsupported';
  let perm = Notification.permission;
  if (perm === 'default') { try { perm = await Notification.requestPermission(); } catch (e) { perm = 'denied'; } }
  if (perm !== 'granted') return perm;
  try { localStorage.setItem(LIVE_NOTIFY_KEY, '1'); } catch (e) { /* ignore */ }
  return 'on';
}
function liveSetNotifyHTML() {
  const perm = liveNotifyPermission();
  const on = liveNotifyOn() && perm === 'granted';
  const why = perm === 'unsupported' ? "This browser can't show notifications."
    : perm === 'denied' ? "Your browser blocks notifications for this page. Allow them in the site's settings (the icon next to the address), then turn this on again."
      : on ? "On. Studio tells you while this tab is in the background. It doesn't need to be on screen, but it does need to be open."
        : 'Off. Your browser asks first the first time you turn it on.';
  return `<div class="card">
      <div class="set-row"><div class="sr-main"><div class="sr-title" id="ls-notify-title">When something needs you</div>
        <div class="sr-desc" id="ls-notify-desc">A browser notification when a task starts waiting for you or fails, and when setting up AX or an install finishes. ${why}</div></div>
        <label class="switch"><input type="checkbox" role="switch" id="ls-notify" data-action="live-notify-toggle" ${on ? 'checked' : ''} ${perm === 'unsupported' ? 'disabled' : ''} aria-labelledby="ls-notify-title" aria-describedby="ls-notify-desc"><span class="track"></span><span class="thumb"></span></label></div>
      ${on ? `<div class="set-row"><div class="sr-main"><div class="sr-title">Try it</div><div class="sr-desc">Sends one now, even with this tab in front.</div></div>
        <button type="button" class="btn sm" data-action="live-notify-test" id="ls-notify-test">${icon('bell', 'sm')}Send a test notification</button></div>` : ''}
    </div>`;
}

/* ---------- Links to an atespace ---------- */
LIVE.deepLinkDone = false;
/** ?atespace= in the address picks where Studio looks, once, then leaves the address. Studio only works with AX on
    this computer, so an older link's ?context= is dropped. */
function liveApplyDeepLink() {
  if (LIVE.deepLinkDone) return;
  LIVE.deepLinkDone = true;
  let q;
  try { q = new URLSearchParams(location.search || ''); } catch (e) { return; }
  const ates = (q.get('atespace') || '').trim();
  if (!ates && !q.has('context')) return;
  if (ates) {
    if (/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(ates) && ates.length <= 63) liveUseAtespace(ates);
    else toast(`The link names an atespace AX can't have: <span class="mono">${esc(ates)}</span>.`, { icon: 'alert', timeout: 9000 });
  }
  q.delete('context'); q.delete('atespace');
  const rest = q.toString();
  try { history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`); } catch (e) { /* ignore */ }
}
/** A link to the page you're on, in the atespace you're looking at. */
function liveLinkHere() {
  const q = new URLSearchParams();
  if (LIVE.atespace && LIVE.atespace !== 'default') q.set('atespace', LIVE.atespace);
  const qs = q.toString();
  return `${location.origin || ''}${location.pathname || '/'}${qs ? `?${qs}` : ''}${location.hash || '#/'}`;
}

/* ---------- A compact task list ---------- */
const LIVE_COMPACT_KEY = 'ax.live.compact';
function liveCompact() { try { return localStorage.getItem(LIVE_COMPACT_KEY) === '1'; } catch (e) { return false; } }

const LIVE_NAV_ACTIONS = {
  'live-notify-toggle': async (el) => {
    const r = await liveNotifyToggle(!!el.checked);
    if (r === 'denied') toast("Your browser blocks notifications for this page. Allow them in the site's settings, then try again.", { icon: 'alert', timeout: 9000 });
    if (r === 'unsupported') toast("This browser can't show notifications.", { icon: 'alert' });
    if (r === 'on') announce('Notifications are on');
    render({ keepScroll: true });
  },
  'live-notify-test': () => {
    if (liveNotifyPermission() !== 'granted') return;
    try { new Notification('AX Studio', { body: 'Notifications work. Studio tells you when a task needs you.', tag: 'ax-test', icon: 'assets/logo.svg' }); } catch (e) { toast(`Couldn't show it: ${esc(e.message)}`, { icon: 'alert' }); }
  },
  'live-copy-link': async () => {
    const link = liveLinkHere();
    try { await navigator.clipboard.writeText(link); toast('Copied a link to this page', { icon: 'link' }); } catch (e) { toast(`Copy this link: <span class="mono">${esc(link)}</span>`, { icon: 'link', timeout: 12000 }); }
  },
  'live-compact': (el) => {
    try { if (el.checked) localStorage.setItem(LIVE_COMPACT_KEY, '1'); else localStorage.removeItem(LIVE_COMPACT_KEY); } catch (e) { /* ignore */ }
    render({ keepScroll: true });
  },
};
