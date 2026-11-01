// History tab: the sessions table with add/edit, and the log of tokens, penalties and blocks.
import * as L from './logic.js';
import { store } from './store.js';
import { h, liveText, sheet, field, errorBox, confirmSheet, chips, toast, app } from './ui.js';

export const historyView = { tab: 'sessions', kidId: 'all', noEnd: false };

export function renderHistory() {
  const { state } = store;
  const kids = L.live(state.kids);
  return h('div', { class: 'stack' },
    h('div', { class: 'toolbar' },
      chips([{ value: 'sessions', label: 'Sessions' }, { value: 'log', label: 'Tokens & penalties' }], historyView.tab, (v) => {
        historyView.tab = v;
        app.render();
      }, 'History type')),
    h('div', { class: 'toolbar' },
      h('select', {
        class: 'select', 'aria-label': 'Filter by kid',
        onchange: (e) => { historyView.kidId = e.target.value; app.render(); },
      },
      h('option', { value: 'all', selected: historyView.kidId === 'all' }, 'All kids'),
      kids.map((k) => h('option', { value: k.id, selected: historyView.kidId === k.id }, k.name))),
      historyView.tab === 'sessions' && h('button', { class: 'btn btn-ink btn-small', type: 'button', onclick: () => editSession(null) }, '+ Add session')),
    historyView.tab === 'sessions' ? sessionsTable() : logTable());
}

function kidName(id) { return L.byId(store.state.kids, id)?.name || 'Unknown'; }
function deviceName(id) { return L.byId(store.state.devices, id)?.name || '—'; }

function sessionsTable() {
  const now = Date.now();
  const missing = L.countNoEnd(store.state);
  let rows = L.live(store.state.sessions);
  if (historyView.kidId !== 'all') rows = rows.filter((s) => s.kidId === historyView.kidId);
  if (historyView.noEnd) rows = rows.filter((s) => !s.running && s.end == null);
  rows.sort((a, b) => b.start - a.start);

  return h('div', { class: 'stack-sm' },
    (missing > 0 || historyView.noEnd) && h('div', { class: 'toolbar' },
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: historyView.noEnd, onchange: (e) => { historyView.noEnd = e.target.checked; app.render(); } }),
        ` Only sessions with no end (${missing})`)),
    rows.length === 0
      ? h('p', { class: 'card empty muted' }, 'No sessions here yet.')
      : h('div', { class: 'card table-card' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Kid', 'Date', 'Start', 'End', 'Device', 'Duration'].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, rows.map((s) => h('tr', {
          tabindex: 0, class: 'row-tap', role: 'button', 'aria-label': `Edit ${kidName(s.kidId)}'s session on ${L.fmtDate(s.start, now)}`,
          onclick: () => editSession(s),
          onkeydown: (e) => { if (e.key === 'Enter') editSession(s); },
        },
        h('td', {}, kidName(s.kidId)),
        h('td', { class: 'nowrap' }, L.fmtDate(s.start, now)),
        h('td', {}, L.timeOf(s.start)),
        h('td', {}, s.running ? h('span', { class: 'tag tag-live' }, 'now') : s.end == null ? h('span', { class: 'tag tag-warn' }, 'add') : L.timeOf(s.end)),
        h('td', {}, deviceName(s.deviceId)),
        h('td', { class: 'nowrap num' }, s.running
          ? liveText(h('span'), (el) => { el.textContent = L.fmtDuration(Date.now() - s.start); })
          : s.end == null ? '—' : L.fmtDuration(s.end - s.start)))))),
      h('p', { class: 'table-note hint' }, 'Tap a row to edit.')));
}

const ENTRY = {
  earn: { label: 'Token', cls: 'good' },
  spend: { label: 'Used', cls: 'good' },
  penalty_tokens: { label: 'Penalty', cls: 'bad' },
  penalty_minutes: { label: 'Penalty', cls: 'bad' },
};
function entryEffect(e) {
  const parts = [];
  if (e.tokens) parts.push(`${e.tokens > 0 ? '+' : '−'}${Math.abs(e.tokens)} ${Math.abs(e.tokens) === 1 ? 'token' : 'tokens'}`);
  if (e.minutes) parts.push(`${e.minutes > 0 ? '+' : '−'}${Math.abs(e.minutes)}min`);
  return parts.join(', ');
}

function logTable() {
  const now = Date.now();
  const { state } = store;
  const entries = L.live(state.ledger).map((e) => ({
    id: e.id, list: 'ledger', at: e.at, kidId: e.kidId, reason: e.reason,
    label: ENTRY[e.type]?.label || e.type, cls: ENTRY[e.type]?.cls || '', effect: entryEffect(e),
  }));
  const blocks = L.live(state.blocks).map((b) => ({
    id: b.id, list: 'blocks', at: b.at, kidId: b.kidId, reason: b.reason, label: 'Block', cls: 'bad',
    effect: `Until ${L.fmtDateTime(b.until, now)}${b.liftedAt ? ` (lifted ${L.fmtDateTime(b.liftedAt, now)})` : ''}`,
  }));
  let rows = [...entries, ...blocks];
  if (historyView.kidId !== 'all') rows = rows.filter((r) => r.kidId === historyView.kidId);
  rows.sort((a, b) => b.at - a.at);
  if (!rows.length) return h('p', { class: 'card empty muted' }, 'Nothing here yet.');

  return h('ul', { class: 'log card' }, rows.map((r) => h('li', {},
    h('button', { class: 'log-row', type: 'button', onclick: () => removeEntry(r) },
      h('span', { class: `tag tag-${r.cls}` }, r.label),
      h('span', { class: 'log-main' },
        h('strong', {}, `${kidName(r.kidId)} · ${r.effect}`),
        h('span', { class: 'muted' }, `${r.reason} · ${L.fmtDateTime(r.at, now)}`))))));
}

async function removeEntry(r) {
  const ok = await confirmSheet({
    title: 'Remove this entry?',
    message: `"${r.reason}" for ${kidName(r.kidId)} (${r.effect}). Removing it undoes its effect.`,
    confirm: 'Remove entry',
    danger: true,
  });
  if (ok) store.update((d) => L.remove(d, r.list, r.id));
}

export function editSession(session) {
  const { state } = store;
  const now = Date.now();
  const kids = L.live(state.kids).filter((k) => !k.archived || k.id === session?.kidId);
  const devices = L.live(state.devices).filter((d) => !d.archived || d.id === session?.deviceId);
  if (!kids.length || !devices.length) {
    toast('Add a kid and a device in Settings first.', { kind: 'bad' });
    return;
  }
  const initialKid = session?.kidId || (historyView.kidId !== 'all' ? historyView.kidId : kids[0].id);
  const kidSel = h('select', {}, kids.map((k) => h('option', { value: k.id, selected: k.id === initialKid }, k.name)));
  const devSel = h('select', {}, devices.map((d) => h('option', { value: d.id, selected: d.id === session?.deviceId }, d.name)));
  const date = h('input', { type: 'date', value: L.dayKey(session?.start ?? now), max: L.dayKey(now) });
  const start = h('input', { type: 'time', value: L.timeOf(session?.start ?? now) });
  const end = h('input', { type: 'time', value: session?.end ? L.timeOf(session.end) : '' });
  const preview = h('p', { class: 'preview' });
  const err = errorBox();

  const compute = () => {
    if (!date.value || !start.value) return null;
    const s = L.fromParts(date.value, start.value);
    let e = null;
    if (end.value) {
      e = L.fromParts(date.value, end.value);
      if (e < s) e = L.addDays(e, 1); // ended after midnight
    }
    return { start: s, end: e };
  };
  const paint = () => {
    const c = compute();
    if (!c) { preview.textContent = ''; return; }
    if (c.end == null) {
      preview.textContent = session?.running ? 'Still running' : 'No end time: this session won’t be counted';
      return;
    }
    const nextDay = L.dayKey(c.end) !== L.dayKey(c.start) ? ' (ends the next day)' : '';
    preview.textContent = `Duration: ${L.fmtDuration(c.end - c.start)}${nextDay}`;
  };
  [date, start, end].forEach((i) => i.addEventListener('input', paint));
  paint();

  sheet(session ? 'Edit session' : 'Add session', (close) => h('form', {
    class: 'stack',
    onsubmit: async (e) => {
      e.preventDefault();
      const c = compute();
      const t = Date.now();
      if (!c) return err.show('Enter a date and start time.');
      if (c.start > t) return err.show('The start time is in the future.');
      if (c.end != null && c.end > t) return err.show('The end time is in the future.');
      if (c.end != null && c.end === c.start) return err.show('The end time matches the start time.');
      const stillRunning = Boolean(session?.running && c.end == null);
      const record = {
        id: session?.id || L.newId(), kidId: kidSel.value, deviceId: devSel.value, start: c.start, end: c.end, running: stillRunning,
      };
      if (L.findOverlaps(store.state, record, t).length > 0) {
        const ok = await confirmSheet({
          title: 'This overlaps another session',
          message: `${kidName(record.kidId)} already has a session at this time. Both would be counted. Save anyway?`,
          confirm: 'Save anyway',
        });
        if (!ok) return undefined;
      }
      store.update((d) => L.upsert(d, 'sessions', record));
      close();
      return toast('Session saved', { kind: 'good' });
    },
  },
  field('Kid', kidSel),
  h('div', { class: 'grid-2' }, field('Date', date), field('Device', devSel)),
  h('div', { class: 'grid-2' }, field('Start', start), field('End', end, session?.running ? 'Enter a time to stop it' : 'Leave empty if unknown')),
  preview,
  err,
  h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Save'),
  session && h('button', {
    class: 'btn btn-ghost-red', type: 'button',
    onclick: async () => {
      const ok = await confirmSheet({ title: 'Delete this session?', message: 'This can’t be undone.', confirm: 'Delete session', danger: true });
      if (ok) { store.update((d) => L.remove(d, 'sessions', session.id)); close(); }
    },
  }, 'Delete session')));
}
