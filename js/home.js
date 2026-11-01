// Admin home: one card per kid, with start/stop, tokens, penalties and blocks.
import * as L from './logic.js';
import { store } from './store.js';
import { h, liveText, sheet, toast, chips, stepper, field, errorBox, confirmSheet, app } from './ui.js';

const chosenDevice = new Map(); // kidId -> deviceId picked on the card
const DEFAULT_GOOD = ['Did homework', 'Helped clean', 'Was kind', 'Read a book'];
const DEFAULT_BAD = ['Fighting', 'Did not listen', 'Skipped chores', 'Rude'];

function deviceFor(state, kid) {
  const devices = L.activeDevices(state);
  const has = (id) => devices.some((d) => d.id === id);
  const picked = chosenDevice.get(kid.id);
  if (has(picked)) return picked;
  const last = L.live(state.sessions).filter((s) => s.kidId === kid.id).sort((a, b) => b.start - a.start)
    .map((s) => s.deviceId).find(has);
  return last || devices[0]?.id || null;
}

export function timeLeftText(status) {
  if (status.remaining > 0) return status.running ? L.fmtCountdown(status.remaining) : L.fmtDuration(status.remaining);
  return "Time's up";
}

export function renderHome() {
  const { state } = store;
  const kids = L.activeKids(state);
  const noEnd = L.countNoEnd(state);
  return h('div', { class: 'stack-lg' },
    !kids.length && h('div', { class: 'card empty' },
      h('p', {}, 'No kids yet.'),
      h('button', { class: 'btn btn-ink', type: 'button', onclick: () => app.go('settings') }, 'Add a kid in Settings')),
    kids.map(kidCard),
    noEnd > 0 && h('button', { class: 'notice', type: 'button', onclick: () => app.go('history', { noEnd: true }) },
      `${noEnd} old ${noEnd === 1 ? 'session has' : 'sessions have'} no end time and ${noEnd === 1 ? "isn't" : "aren't"} counted. Tap to fix.`));
}

function kidCard(kid) {
  const now = Date.now();
  const { state } = store;
  const st = L.kidStatus(state, kid, now);
  const devices = L.activeDevices(state);
  const deviceId = deviceFor(state, kid);
  const runningOn = st.running && L.byId(state.devices, st.running.deviceId)?.name;

  return h('article', { class: `card kid-card level-${st.block ? 'blocked' : st.level}` },
    h('header', { class: 'kid-head' },
      h('h2', {}, kid.name),
      h('span', { class: `tokens ${st.tokens < 0 ? 'neg' : ''}`, 'aria-label': `${st.tokens} tokens` }, `★ ${st.tokens}`)),

    st.block
      ? h('div', { class: 'block-banner', role: 'status' },
        h('strong', {}, `Blocked until ${L.fmtDateTime(st.block.until)}`),
        h('p', {}, st.block.reason),
        h('button', { class: 'btn btn-small btn-on-red', type: 'button', onclick: () => liftBlock(kid) }, 'Lift block'))
      : h('div', { class: 'time-box' },
        h('div', { class: 'time-left' }, liveText(h('span', { class: 'time-num', role: 'timer' }), (el) => {
          el.textContent = timeLeftText(L.kidStatus(store.state, kid, Date.now()));
        })),
        h('div', { class: 'time-sub' }, liveText(h('span'), (el) => {
          el.textContent = subLine(kid);
        })),
        h('div', { class: 'meter', 'aria-hidden': 'true' }, liveText(h('div', { class: 'meter-fill' }), (el) => {
          const s = L.kidStatus(store.state, kid, Date.now());
          el.style.width = `${s.allowed ? Math.min(100, (s.used / s.allowed) * 100) : 100}%`;
        }))),

    !st.block && !st.running && devices.length > 0 && chips(
      devices.map((d) => ({ value: d.id, label: d.name })),
      deviceId,
      (id) => chosenDevice.set(kid.id, id),
      `Device for ${kid.name}`,
    ),
    !st.block && !devices.length && h('button', { class: 'link', type: 'button', onclick: () => app.go('settings') }, 'Add a device to start'),

    st.running
      ? h('button', { class: 'btn btn-big btn-stop', type: 'button', onclick: () => stop(kid, st.running) }, `■ Stop · ${runningOn || 'session'}`)
      : h('button', {
        class: 'btn btn-big btn-ink', type: 'button', disabled: Boolean(st.block) || !devices.length, onclick: () => start(kid),
      }, st.block ? 'Blocked' : '▶ Start'),

    h('div', { class: 'action-row' },
      h('button', { class: 'btn btn-green', type: 'button', onclick: () => tokenSheet(kid) }, '+ Token'),
      h('button', { class: 'btn btn-red-soft', type: 'button', onclick: () => penaltySheet(kid) }, '− Penalty'),
      h('button', { class: 'btn btn-red-soft', type: 'button', onclick: () => blockSheet(kid) }, 'Block')),
    st.tokens > 0 && h('button', { class: 'btn btn-green-soft', type: 'button', onclick: () => spendSheet(kid, st.tokens) },
      `Use a token (+${state.settings.tokenMinutes}min)`));
}

function subLine(kid) {
  const now = Date.now();
  const s = L.kidStatus(store.state, kid, now);
  const of = `${L.fmtDuration(s.used)} of ${L.fmtDuration(s.allowed)} used today`;
  if (s.remaining < 0) return `${L.fmtDuration(-s.remaining)} over · ${of}`;
  if (s.level === 'warn' && s.running) return `Less than 10 min left · ${of}`;
  return of;
}

async function start(kid) {
  const now = Date.now();
  const { state } = store;
  const st = L.kidStatus(state, kid, now);
  if (st.level === 'up') {
    const ok = await confirmSheet({
      title: `${kid.name} has no time left`,
      message: `Today's time is used up. Start anyway? It will show as extra time over the limit.`,
      confirm: 'Start anyway',
    });
    if (!ok) return;
  }
  const deviceId = deviceFor(store.state, kid);
  try {
    const s = store.update((draft) => L.startSession(draft, kid.id, deviceId));
    toast(`${kid.name} started`, { action: () => store.update((d) => L.remove(d, 'sessions', s.id)) });
  } catch (e) {
    toast(e.message, { kind: 'bad' });
  }
}

function stop(kid, session) {
  store.update((d) => L.stopSession(d, session.id));
  toast(`${kid.name} stopped`, {
    action: () => store.update((d) => {
      const s = L.byId(d.sessions, session.id);
      if (s) { s.running = true; s.end = null; s.updatedAt = Date.now(); }
    }),
  });
}

async function liftBlock(kid) {
  const ok = await confirmSheet({ title: `Lift ${kid.name}'s block?`, message: `${kid.name} will be able to play again right away.`, confirm: 'Lift block' });
  if (ok) store.update((d) => L.liftBlocks(d, kid.id));
}

function recentReasons(types, defaults) {
  const seen = L.live(store.state.ledger).filter((e) => types.includes(e.type)).sort((a, b) => b.at - a.at).map((e) => e.reason);
  return [...new Set([...seen, ...defaults])].slice(0, 6);
}
function reasonField(suggestions, placeholder) {
  const input = h('input', { type: 'text', maxlength: 80, placeholder, autocomplete: 'off', enterkeyhint: 'done' });
  const row = h('div', { class: 'chips wrap' }, suggestions.map((r) => h('button', {
    type: 'button', class: 'chip chip-small', onclick: () => { input.value = r; },
  }, r)));
  return { input, node: h('div', { class: 'stack-sm' }, field('Reason', input), row) };
}

function tokenSheet(kid) {
  let count = 1;
  let useNow = false;
  const mins = store.state.settings.tokenMinutes;
  const reason = reasonField(recentReasons(['earn'], DEFAULT_GOOD), 'What did they do well?');
  const err = errorBox();
  sheet(`+ Token for ${kid.name}`, (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const text = reason.input.value.trim();
      if (!text) return err.show('Add a short reason.');
      store.update((d) => L.earnTokens(d, kid.id, count, text, useNow));
      close();
      return toast(useNow ? `${kid.name} got +${count * mins}min today` : `${kid.name} saved ${count} ${count === 1 ? 'token' : 'tokens'}`, { kind: 'good' });
    },
  },
  field('Tokens', stepper(count, 1, (v) => { count = v; })),
  reason.node,
  field(`Each token is worth ${mins}min`, chips([
    { value: 'save', label: 'Save for later' },
    { value: 'now', label: 'Use now' },
  ], 'save', (v) => { useNow = v === 'now'; }, 'When to use')),
  err,
  h('button', { class: 'btn btn-big btn-green', type: 'submit' }, 'Give token')));
}

function spendSheet(kid, balance) {
  let count = 1;
  const mins = store.state.settings.tokenMinutes;
  const label = h('span', {}, `Add ${mins}min today`);
  sheet(`Use ${kid.name}'s tokens`, (close) => h('div', { class: 'stack' },
    h('p', { class: 'muted' }, `${kid.name} has ${balance} ${balance === 1 ? 'token' : 'tokens'}.`),
    field('How many?', stepper(1, 1, (v) => {
      count = v;
      label.textContent = `Add ${count * mins}min today`;
    }, '', balance)),
    h('button', {
      class: 'btn btn-big btn-green', type: 'button',
      onclick: () => {
        store.update((d) => L.spendTokens(d, kid.id, count, 'Spent token'));
        close();
        toast(`+${count * mins}min for ${kid.name} today`, { kind: 'good' });
      },
    }, label)));
}

function penaltySheet(kid) {
  let kind = 'tokens';
  let amount = 1;
  const reason = reasonField(recentReasons(['penalty_tokens', 'penalty_minutes'], DEFAULT_BAD), 'What happened?');
  const err = errorBox();
  const amountBox = h('div');
  const paint = () => {
    amountBox.replaceChildren(kind === 'tokens'
      ? field('Tokens to remove', stepper(amount, 1, (v) => { amount = v; }))
      : field('Minutes to remove today', h('input', {
        type: 'number', inputmode: 'numeric', min: 1, value: amount, oninput: (e) => { amount = Number(e.target.value); },
      })));
  };
  paint();
  sheet(`− Penalty for ${kid.name}`, (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const text = reason.input.value.trim();
      if (!text) return err.show('Add a short reason.');
      if (!Number.isInteger(amount) || amount < 1) return err.show('Enter a whole number above 0.');
      store.update((d) => L.penalize(d, kid.id, kind, amount, text));
      close();
      return toast(`${kid.name}: −${amount}${kind === 'tokens' ? ` ${amount === 1 ? 'token' : 'tokens'}` : 'min'}`, { kind: 'bad' });
    },
  },
  chips([{ value: 'tokens', label: 'Remove tokens' }, { value: 'minutes', label: 'Remove minutes' }], kind, (v) => {
    kind = v;
    amount = v === 'tokens' ? 1 : 15;
    paint();
  }, 'Penalty type'),
  amountBox,
  reason.node,
  err,
  h('button', { class: 'btn btn-big btn-red', type: 'submit' }, 'Apply penalty')));
}

function blockSheet(kid) {
  let mode = 'hours';
  let hours = 2;
  let days = 1;
  const pad = (n) => String(n).padStart(2, '0');
  const tomorrow = new Date(L.addDays(Date.now(), 1));
  const defaultDate = `${L.dayKey(+tomorrow)}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
  const dateInput = h('input', { type: 'datetime-local', value: defaultDate });
  const reason = reasonField(recentReasons(['penalty_tokens', 'penalty_minutes'], DEFAULT_BAD), 'Why? The kid will see this.');
  const err = errorBox();
  const box = h('div');
  const paint = () => {
    if (mode === 'hours') box.replaceChildren(field('For how many hours?', stepper(hours, 1, (v) => { hours = v; }, 'h')));
    else if (mode === 'days') box.replaceChildren(field('For how many days?', stepper(days, 1, (v) => { days = v; }, ' d')));
    else box.replaceChildren(field('Blocked until', dateInput));
  };
  paint();
  const untilTime = (now) => {
    if (mode === 'hours') return now + hours * L.HOUR;
    if (mode === 'days') return L.addDays(now, days);
    return new Date(dateInput.value).getTime();
  };
  const running = L.runningSession(store.state, kid.id);
  sheet(`Block ${kid.name}`, (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const now = Date.now();
      const until = untilTime(now);
      const text = reason.input.value.trim();
      if (!text) return err.show('Add a short reason.');
      if (!Number.isFinite(until) || until <= now) return err.show('Pick a time in the future.');
      store.update((d) => L.blockKid(d, kid.id, until, text, now));
      close();
      return toast(`${kid.name} blocked until ${L.fmtDateTime(until)}`, { kind: 'bad' });
    },
  },
  chips([{ value: 'hours', label: 'Hours' }, { value: 'days', label: 'Days' }, { value: 'date', label: 'Until date' }], mode, (v) => {
    mode = v;
    paint();
  }, 'Block length'),
  box,
  reason.node,
  running && h('p', { class: 'hint' }, `${kid.name}'s running session will stop.`),
  err,
  h('button', { class: 'btn btn-big btn-red', type: 'submit' }, 'Block')));
}
