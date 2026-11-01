// Small DOM helpers. All user text goes through text nodes, so names and reasons can't inject markup.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendAll(el, children);
  return el;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, attrs);
  appendAll(el, children);
  return el;
}
function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' && 'value' in el) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
}
function appendAll(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

// Elements whose text changes every second, such as countdowns.
let liveItems = [];
export function liveText(el, fn) { fn(el); liveItems.push([el, fn]); return el; }
export function tickLive() {
  liveItems = liveItems.filter(([el]) => el.isConnected);
  liveItems.forEach(([el, fn]) => fn(el));
}

// Connects views to the main render loop without circular imports.
export const app = { render() {}, go() {}, lock() {}, unlock() {}, logout() {} };

let toastTimer;
export function toast(message, { kind = '', action, actionLabel = 'Undo' } = {}) {
  document.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast ${kind}`, role: 'status' },
    h('span', {}, message),
    action && h('button', { class: 'toast-action', type: 'button', onclick: () => { el.remove(); action(); } }, actionLabel));
  // Inside an open dialog, so it isn't hidden behind the modal layer.
  (document.querySelector('dialog[open]') || document.body).append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3500);
}

/** Opens a bottom sheet. `build(close)` returns its content. */
export function sheet(title, build) {
  const dialog = h('dialog', { class: 'sheet', 'aria-label': title });
  const close = () => { dialog.close(); };
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
  dialog.append(h('div', { class: 'sheet-body' },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    build(close)));
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmSheet({ title, message, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const d = sheet(title, (close) => h('div', { class: 'stack' },
      h('p', { class: 'muted' }, message),
      h('button', { class: `btn ${danger ? 'btn-red' : 'btn-ink'}`, type: 'button', onclick: () => { answer = true; close(); } }, confirm),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: close }, 'Cancel')));
    d.addEventListener('close', () => resolve(answer));
  });
}

export function field(label, control, hint) {
  // A <label> around buttons would make tapping the label press the first button.
  const tag = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? 'label' : 'div';
  return h(tag, { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint && h('span', { class: 'hint' }, hint));
}
export function errorBox() {
  const el = h('p', { class: 'error', role: 'alert', hidden: true });
  el.show = (msg) => { el.textContent = msg; el.hidden = !msg; };
  return el;
}
/** Runs an async submit, disabling the button while busy and showing any error. */
export async function busy(btn, err, fn) {
  btn.disabled = true;
  err.show('');
  try { await fn(); } catch (e) { err.show(e.message || 'Something went wrong.'); } finally { btn.disabled = false; }
}

/** Row of mutually exclusive chips. */
export function chips(options, value, onChange, label) {
  const row = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': label });
  const paint = () => [...row.children].forEach((b) => {
    const on = b.dataset.value === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  options.forEach((o) => row.append(h('button', {
    type: 'button', class: 'chip', role: 'radio', 'data-value': o.value,
    onclick: () => { value = o.value; paint(); onChange(o.value); },
  }, o.label)));
  paint();
  return row;
}

/** Number stepper with big tap targets. */
export function stepper(value, min, onChange, unit = '', max = Infinity) {
  const show = h('span', { class: 'stepper-value', 'aria-live': 'polite' });
  const paint = () => { show.textContent = `${value}${unit}`; };
  const change = (d) => { value = Math.min(max, Math.max(min, value + d)); paint(); onChange(value); };
  paint();
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'step', 'aria-label': 'Less', onclick: () => change(-1) }, '−'),
    show,
    h('button', { type: 'button', class: 'step', 'aria-label': 'More', onclick: () => change(1) }, '+'));
}

// Sound for time warnings. iPhones only allow sound after a tap, so this starts on the first tap.
let audio;
document.addEventListener('pointerdown', () => {
  if (audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (Ctx) audio = new Ctx();
}, { once: true });
export function beep(times = 2) {
  if (navigator.vibrate) navigator.vibrate(200 * times);
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume();
  for (let i = 0; i < times; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const at = audio.currentTime + i * 0.28;
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.24);
  }
}
