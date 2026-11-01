// App shell: decides which screen to show, handles the admin lock and the one-second tick.
import * as L from './logic.js';
import { store } from './store.js';
import { h, app, tickLive, toast, beep } from './ui.js';
import { renderSetup, renderLogin, readSetupLink, askPin } from './account.js';
import { renderHome } from './home.js';
import { renderHistory, historyView } from './history.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { renderKidView } from './kid.js';

const IDLE_LOCK_MS = 15 * L.MIN;
const root = document.getElementById('app');
let screen = 'loading'; // setup | login | main
let adminUnlocked = false;
let lastActive = Date.now();
let tab = 'home';
let signature = '';
let pendingRender = false;

const TABS = [
  { id: 'home', label: 'Today', view: renderHome },
  { id: 'history', label: 'History', view: renderHistory },
  { id: 'reports', label: 'Reports', view: renderReports },
  { id: 'settings', label: 'Settings', view: renderSettings },
];

function renderMain() {
  signature = statusSignature();
  if (!adminUnlocked) {
    root.replaceChildren(h('main', {}, renderKidView()));
    return;
  }
  const current = TABS.find((t) => t.id === tab);
  // replaceChildren would print a false or null as text, so skip the optional ones.
  root.replaceChildren(...[
    h('header', { class: 'topbar' },
      h('h1', {}, current.id === 'home' ? 'Playtime' : current.label),
      syncBadge(),
      h('button', { class: 'btn btn-small btn-ghost', type: 'button', onclick: lockAdmin }, 'Kid view')),
    store.saveFailed && h('p', { class: 'notice notice-red', role: 'alert' }, "Couldn't save on this device. Storage may be full. Export a backup."),
    h('main', { class: 'content' }, current.view()),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' }, TABS.map((t) => h('button', {
      class: `tab ${t.id === tab ? 'on' : ''}`, type: 'button', 'aria-current': t.id === tab ? 'page' : null,
      onclick: () => app.go(t.id),
    }, t.label))),
  ].filter(Boolean));
}

function syncBadge() {
  if (!store.isCloud) return null;
  const map = {
    idle: [store.dirty ? 'Saving' : 'Synced', ''],
    syncing: ['Saving', ''],
    offline: ['Offline', 'warn'],
    error: ['Sync issue', 'bad'],
  };
  const [text, cls] = map[store.syncStatus];
  return h('span', { class: `sync ${cls}`, title: store.syncError || text }, text);
}

function render() {
  if (screen !== 'main') return;
  // Don't redraw under someone typing in a page-level field, such as a filter.
  const active = document.activeElement;
  if (active && root.contains(active) && (active.tagName === 'TEXTAREA' || (active.tagName === 'INPUT' && active.type !== 'checkbox'))) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  const y = window.scrollY;
  renderMain();
  window.scrollTo(0, y);
}
app.render = render;
app.go = (id, opts = {}) => {
  tab = id;
  if (id === 'history') {
    historyView.noEnd = Boolean(opts.noEnd);
    if (opts.noEnd) historyView.tab = 'sessions';
  }
  window.scrollTo(0, 0);
  render();
};
app.unlock = async () => {
  if (await askPin()) {
    adminUnlocked = true;
    lastActive = Date.now();
    tab = 'home';
    render();
  }
};
app.logout = () => {
  store.logout();
  adminUnlocked = false;
  boot();
};
function lockAdmin() {
  adminUnlocked = false;
  document.querySelector('.toast')?.remove(); // admin messages aren't for the kid view
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  window.scrollTo(0, 0);
  render();
}

function enterMain(unlocked) {
  screen = 'main';
  adminUnlocked = unlocked;
  lastActive = Date.now();
  tab = 'home';
  render();
}

function boot() {
  const link = readSetupLink() || boot.link;
  boot.link = link;
  if (!store.config || (store.isLoggedIn && (!store.state.settings.pinHash || !L.live(store.state.kids).length))) {
    screen = 'setup';
    renderSetup(root, link, () => enterMain(true));
  } else if (!store.isLoggedIn) {
    screen = 'login';
    renderLogin(root, () => {
      if (!store.state.settings.pinHash || !L.live(store.state.kids).length) boot();
      else enterMain(true);
    });
  } else {
    enterMain(false); // reopening the app: start locked, so a kid can't change anything
    store.sync();
  }
}

// ----- One-second tick: countdowns, warnings, auto-lock -----
function statusSignature() {
  const now = Date.now();
  return `${L.dayKey(now)}|${L.activeKids(store.state).map((k) => {
    const s = L.kidStatus(store.state, k, now);
    return `${k.id}:${s.level}:${s.running?.id || ''}:${s.block?.id || ''}`;
  }).join(',')}`;
}

const alerted = new Set();
function checkAlerts() {
  const now = Date.now();
  L.activeKids(store.state).forEach((kid) => {
    const s = L.kidStatus(store.state, kid, now);
    if (!s.running) return;
    const id = s.running.id;
    // A token added after a warning can clear it, so the warning can fire again later.
    if (s.level === 'ok') { alerted.delete(`${id}:warn`); alerted.delete(`${id}:up`); }
    if (s.level === 'warn') alerted.delete(`${id}:up`);
    if (s.level === 'warn' && !alerted.has(`${id}:warn`)) {
      alerted.add(`${id}:warn`);
      toast(`${kid.name}: 10 minutes left`, { kind: 'warn' });
      beep(1);
    }
    if (s.level === 'up' && !alerted.has(`${id}:up`)) {
      alerted.add(`${id}:up`);
      alerted.add(`${id}:warn`);
      toast(`${kid.name}: time's up!`, { kind: 'bad' });
      beep(3);
    }
  });
}

setInterval(() => {
  if (screen !== 'main') return;
  if (adminUnlocked && Date.now() - lastActive > IDLE_LOCK_MS) {
    lockAdmin();
    return;
  }
  checkAlerts();
  if (pendingRender || statusSignature() !== signature) render();
  tickLive();
}, 1000);

['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true }));
document.addEventListener('focusout', () => { if (pendingRender) setTimeout(render, 0); });
document.addEventListener('visibilitychange', () => {
  // Returning after a long time away counts as idle even if the timer was paused.
  if (!document.hidden && adminUnlocked && Date.now() - lastActive > IDLE_LOCK_MS) lockAdmin();
});

store.subscribe(render);
store.onSyncChange = render;

// Ask the browser not to evict the data, and install the offline cache.
navigator.storage?.persist?.();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

boot();
