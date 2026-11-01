// Read-only screen for kids: time left, tokens and block status, big and friendly.
import * as L from './logic.js';
import { store } from './store.js';
import { h, liveText, app } from './ui.js';

export const kidView = { kidId: null };

export function renderKidView() {
  const { state } = store;
  const kids = L.activeKids(state);
  if (!kids.some((k) => k.id === kidView.kidId)) kidView.kidId = kids[0]?.id ?? null;
  const kid = L.byId(kids, kidView.kidId);
  const now = Date.now();

  const adminBtn = h('button', { class: 'kid-admin', type: 'button', onclick: () => app.unlock() }, '🔒 Admin');
  if (!kid) return h('div', { class: 'kid-screen level-ok' }, h('p', { class: 'kid-big' }, 'Nobody here yet'), adminBtn);

  const st = L.kidStatus(state, kid, now);
  const level = st.block ? 'blocked' : st.level;
  const device = st.running && L.byId(state.devices, st.running.deviceId)?.name;

  return h('div', { class: `kid-screen level-${level}` },
    kids.length > 1 && h('nav', { class: 'kid-tabs', 'aria-label': 'Choose kid' }, kids.map((k) => h('button', {
      type: 'button', class: `kid-tab ${k.id === kid.id ? 'on' : ''}`, 'aria-pressed': k.id === kid.id,
      onclick: () => { kidView.kidId = k.id; app.render(); },
    }, k.name))),
    h('h1', { class: 'kid-hello' }, `Hi ${kid.name}!`),

    st.block
      ? h('div', { class: 'kid-main' },
        h('div', { class: 'kid-emoji', 'aria-hidden': 'true' }, '⛔'),
        h('p', { class: 'kid-big' }, 'Blocked'),
        h('p', { class: 'kid-until' }, `until ${L.fmtDateTime(st.block.until)}`),
        h('p', { class: 'kid-reason' }, st.block.reason))
      : h('div', { class: 'kid-main' },
        h('div', { class: 'kid-emoji', 'aria-hidden': 'true' }, st.level === 'up' ? '⏰' : '🎮'),
        liveText(h('p', { class: 'kid-big', role: 'timer' }), (el) => {
          const s = L.kidStatus(store.state, kid, Date.now());
          if (s.remaining <= 0) el.textContent = "Time's up!";
          else el.textContent = s.running ? L.fmtCountdown(s.remaining) : L.fmtDuration(s.remaining);
        }),
        st.level !== 'up' && h('p', { class: 'kid-until' }, 'left today'),
        device && h('p', { class: 'kid-reason' }, `Playing on ${device}`),
        st.level === 'warn' && st.running && h('p', { class: 'kid-reason strong' }, 'Almost time to finish!')),

    h('div', { class: 'kid-tokens' },
      h('p', { class: 'kid-stars', 'aria-hidden': 'true' }, starText(st.tokens)),
      h('p', {}, tokenText(st.tokens, state.settings.tokenMinutes))),
    adminBtn);
}

function starText(n) {
  if (n <= 0) return '☆';
  return n > 10 ? `${'⭐'.repeat(10)} +${n - 10}` : '⭐'.repeat(n);
}
function tokenText(n, mins) {
  if (n < 0) return `You owe ${-n} ${n === -1 ? 'token' : 'tokens'}`;
  if (n === 0) return 'No tokens yet';
  return `${n} ${n === 1 ? 'token' : 'tokens'} saved = ${L.fmtDuration(n * mins * L.MIN)} extra`;
}
