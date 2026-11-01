// First-run setup, login, PIN pad, and the storage forms shared with Settings.
import * as L from './logic.js';
import { store, KEYS } from './store.js';
import { hashSecret, verifySecret, attemptLimiter } from './crypto.js';
import { normalizeUrl, AuthError } from './cloud.js';
import { h, field, errorBox, busy, sheet, confirmSheet, toast } from './ui.js';

const pinLimiter = attemptLimiter(KEYS.pinTries);
const loginLimiter = attemptLimiter(KEYS.loginTries);
const waitText = (ms) => `Too many tries. Wait ${Math.ceil(ms / 1000)} seconds.`;

// ----- Setup links: everything after # stays on the phone and is never sent to a server -----
export function encodeSetup(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function readSetupLink() {
  const match = /^#setup=([\w-]+)$/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const raw = atob(match[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

// ----- Screen wrapper -----
function screen(title, subtitle, ...content) {
  return h('main', { class: 'auth-screen' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'brand', 'aria-hidden': 'true' }, h('img', { src: 'icons/icon.svg', alt: '', width: 56, height: 56 })),
      h('h1', {}, title),
      subtitle && h('p', { class: 'muted' }, subtitle),
      ...content));
}

// ----- Reusable cloud form -----
export function cloudForm({ prefill = {}, submitLabel, onConnected, allowSignUp = true }) {
  const url = h('input', { type: 'url', inputmode: 'url', autocapitalize: 'none', autocomplete: 'off', placeholder: 'https://xxxx.supabase.co', value: prefill.url || '' });
  const key = h('input', { type: 'text', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', placeholder: 'Publishable (anon) key', value: prefill.anonKey || '' });
  const email = h('input', { type: 'email', autocomplete: 'username', autocapitalize: 'none', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', minlength: 6, required: true });
  const err = errorBox();

  const run = async (create) => {
    if (!url.value.trim() || !key.value.trim()) throw new Error('Enter the project URL and key.');
    if (!email.value.trim() || password.value.length < 6) throw new Error('Enter your email and a password of at least 6 characters.');
    const config = { url: normalizeUrl(url.value), anonKey: key.value.trim() };
    const cloud = store.connect(config);
    if (create) {
      const signedIn = await cloud.signUp(email.value.trim(), password.value);
      if (!signedIn) throw new Error('Account created. Confirm it from the email Supabase sent, then sign in here.');
    } else {
      await cloud.signIn(email.value.trim(), password.value);
    }
    store.useCloud(config);
    await onConnected();
  };
  const signIn = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, submitLabel);
  const signUp = allowSignUp && h('button', {
    class: 'btn btn-ghost', type: 'button', onclick: () => busy(signUp, err, () => run(true)),
  }, 'Create a new account');

  return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); busy(signIn, err, () => run(false)); } },
    field('Project URL', url),
    field('Project key', key, 'Supabase: Project Settings → API. This key is meant to be public.'),
    field('Email', email),
    field('Password', password),
    err, signIn, signUp,
    h('a', { class: 'link', href: 'supabase/schema.sql', target: '_blank', rel: 'noopener' }, 'Database setup script (run once in Supabase)'));
}

function localForm(onDone, submitLabel) {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const again = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, submitLabel);
  return h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      busy(submit, err, async () => {
        if (pass.value.length < 6) throw new Error('Use at least 6 characters for the password.');
        if (pass.value !== again.value) throw new Error("The passwords don't match.");
        const rec = await hashSecret(pass.value);
        await onDone({ username: user.value.trim(), ...rec });
      });
    },
  }, field('Username', user), field('Password', pass), field('Repeat password', again), err, submit);
}

// ----- First-run setup -----
export function renderSetup(root, link, onDone) {
  const show = (node) => { root.replaceChildren(node); window.scrollTo(0, 0); };

  const afterAccount = () => {
    if (!store.state.settings.pinHash) return pinStep();
    if (L.activeKids(store.state).length) return onDone();
    return kidsStep();
  };

  function storageStep() {
    show(screen('Welcome to Playtime', 'First, where should your data be saved?',
      h('div', { class: 'stack' },
        h('button', { class: 'choice', type: 'button', onclick: localStep },
          h('strong', {}, 'This device'),
          h('span', { class: 'muted' }, 'Simplest, with no account to set up. Data stays on this phone, so keep backups.')),
        h('button', { class: 'choice', type: 'button', onclick: cloudStep },
          h('strong', {}, 'Cloud database (Supabase)'),
          h('span', { class: 'muted' }, 'Free tier. Syncs across phones and survives losing one. Needs a Supabase project.')))));
  }
  function backLink() { return h('button', { class: 'link', type: 'button', onclick: storageStep }, '‹ Back'); }

  function localStep() {
    show(screen('Create your login', 'You will use this to open the app on this device.',
      localForm(async (rec) => { store.useLocal(rec); afterAccount(); }, 'Continue'), backLink()));
  }
  function cloudStep() {
    show(screen('Connect your database', 'Sign in if you already use Playtime on another phone.',
      cloudForm({
        prefill: link?.cloud,
        submitLabel: 'Sign in',
        onConnected: async () => {
          const ok = await store.sync();
          if (!ok) throw new Error(store.syncError || 'Signed in, but could not load your data.');
          afterAccount();
        },
      }), backLink()));
  }
  function pinStep() {
    show(screen('Choose an admin PIN', 'Kids can look but not change anything. This 4-digit PIN unlocks admin actions.',
      pinPad({
        onComplete: (first, reset) => {
          reset();
          show(screen('Repeat your PIN', null, pinPad({
            onComplete: async (second, resetAgain, showErr) => {
              if (second !== first) { resetAgain(); showErr("Those PINs don't match. Try again."); return; }
              const rec = await hashSecret(first);
              store.update((d) => { d.settings.pinHash = rec; d.settings.updatedAt = Date.now(); });
              afterAccount();
            },
          })));
        },
      })));
  }
  function kidsStep() {
    const kids = h('input', { type: 'text', autocomplete: 'off', placeholder: 'Names, separated by commas', value: (link?.kids || []).join(', ') });
    const devices = h('input', { type: 'text', autocomplete: 'off', value: (link?.devices || []).join(', '), placeholder: 'Devices, separated by commas' });
    const allowance = h('input', { type: 'number', inputmode: 'decimal', min: 0, step: 0.25, value: 2 });
    const tokenMin = h('input', { type: 'number', inputmode: 'numeric', min: 1, value: 15 });
    const records = h('textarea', { rows: 5, placeholder: 'Ana 17/04 14:34–18:44 Tablet\nAna 06/05 17:04–(no end) Tablet', value: link?.records || '' });
    const preview = h('p', { class: 'hint' });
    const paint = () => { preview.textContent = recordsSummary(records.value); };
    records.addEventListener('input', paint);
    paint();
    const err = errorBox();
    const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Finish');

    show(screen('Who is playing?', null, h('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        const names = splitList(kids.value);
        const deviceNames = splitList(devices.value);
        const hours = Number(allowance.value);
        const mins = Number(tokenMin.value);
        if (!names.length) return err.show('Add at least one kid.');
        if (!(hours >= 0)) return err.show('Enter the daily time in hours.');
        if (!(mins >= 1)) return err.show('A token must be worth at least 1 minute.');
        const { records: parsed, errors } = L.parseRecords(records.value);
        if (errors.length) return err.show(`Line ${errors[0].line} of past records wasn't understood: "${errors[0].text}"`);
        store.update((d) => {
          const now = Date.now();
          names.forEach((n) => L.upsert(d, 'kids', L.makeKid(d, n, Math.round(hours * 60)), now));
          deviceNames.forEach((n) => L.upsert(d, 'devices', { id: L.newId(), name: n, archived: false }, now));
          d.settings.tokenMinutes = mins;
          d.settings.updatedAt = now;
          L.importRecords(d, parsed, now);
          // Kids named only in the past records still get the chosen allowance.
          L.live(d.kids).forEach((k) => { k.allowanceMin = Math.round(hours * 60); });
        });
        return onDone();
      },
    },
    field('Kids', kids),
    field('Devices', devices),
    h('div', { class: 'grid-2' }, field('Hours per day', allowance), field('Minutes per token', tokenMin)),
    field('Past records (optional)', records),
    preview, err, submit)));
  }

  if (store.config) afterAccount();
  else if (link?.cloud) cloudStep();
  else storageStep();
}

const splitList = (text) => [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];

export function recordsSummary(text) {
  if (!text.trim()) return '';
  const { records, errors } = L.parseRecords(text);
  const noEnd = records.filter((r) => r.end == null).length;
  const parts = [`${records.length} ${records.length === 1 ? 'session' : 'sessions'} found`];
  if (noEnd) parts.push(`${noEnd} with no end time`);
  if (errors.length) parts.push(`${errors.length} not understood (line ${errors[0].line})`);
  return parts.join(', ');
}

// ----- Login -----
export function renderLogin(root, onDone) {
  const isCloud = store.isCloud;
  const user = h('input', {
    type: isCloud ? 'email' : 'text', autocomplete: 'username', autocapitalize: 'none', required: true, value: isCloud ? '' : store.localAuth?.username || '',
  });
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Log in');
  root.replaceChildren(screen('Playtime', 'Log in to continue.',
    h('form', {
      class: 'stack',
      onsubmit: (e) => {
        e.preventDefault();
        busy(submit, err, async () => {
          const wait = loginLimiter.waitMs();
          if (wait) throw new Error(waitText(wait));
          if (isCloud) {
            await store.cloud.signIn(user.value.trim(), pass.value);
            await store.sync();
          } else {
            const rec = store.localAuth;
            const ok = rec && user.value.trim() === rec.username && await verifySecret(pass.value, rec);
            if (!ok) {
              loginLimiter.fail();
              throw new Error('Wrong username or password.');
            }
            store.markLoggedInLocal();
          }
          loginLimiter.reset();
          onDone();
        });
      },
    },
    field(isCloud ? 'Email' : 'Username', user),
    field('Password', pass),
    err, submit,
    h('button', { class: 'link', type: 'button', onclick: () => forgotLogin(isCloud) }, 'Forgot your password?'))));
}

async function forgotLogin(isCloud) {
  const ok = await confirmSheet({
    title: isCloud ? 'Reset from Supabase' : 'Start over on this device?',
    message: isCloud
      ? 'Reset the password in your Supabase dashboard under Authentication → Users. Or disconnect this device and set it up again (your cloud data stays safe).'
      : "Passwords can't be recovered here. Starting over erases all data on this device. You can then restore a backup file.",
    confirm: isCloud ? 'Disconnect this device' : 'Erase and start over',
    danger: true,
  });
  if (ok) {
    store.eraseEverything();
    location.reload();
  }
}

// ----- PIN pad -----
export function pinPad({ onComplete, title }) {
  let entry = '';
  const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
  const err = h('p', { class: 'error', role: 'alert', hidden: true });
  const paint = () => {
    dots.replaceChildren(...[0, 1, 2, 3].map((i) => h('i', { class: i < entry.length ? 'on' : '' })));
    dots.setAttribute('aria-label', `${entry.length} of 4 digits`);
  };
  const reset = () => { entry = ''; paint(); };
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const press = (d) => {
    if (entry.length >= 4) return;
    entry += d;
    paint();
    showErr('');
    if (entry.length === 4) setTimeout(() => onComplete(entry, reset, showErr), 80);
  };
  const back = () => { entry = entry.slice(0, -1); paint(); };
  paint();
  const key = (label, fn, cls = '', aria) => h('button', { class: `pin-key ${cls}`, type: 'button', onclick: fn, 'aria-label': aria }, label);
  return h('div', { class: 'pin' },
    title && h('p', { class: 'muted' }, title),
    dots, err,
    h('div', { class: 'pin-grid' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d))),
      h('span'),
      key('0', () => press('0')),
      key('⌫', back, 'pin-back', 'Delete')));
}

/** Resolves true if the admin enters the right PIN. */
export function askPin() {
  return new Promise((resolve) => {
    let passed = false;
    const d = sheet('Admin PIN', (close) => h('div', { class: 'stack' },
      pinPad({
        onComplete: async (entry, reset, showErr) => {
          const wait = pinLimiter.waitMs();
          if (wait) { reset(); showErr(waitText(wait)); return; }
          if (await verifySecret(entry, store.state.settings.pinHash)) {
            pinLimiter.reset();
            passed = true;
            close();
            return;
          }
          pinLimiter.fail();
          reset();
          const after = pinLimiter.waitMs();
          showErr(after ? waitText(after) : 'Wrong PIN.');
        },
      }),
      h('button', { class: 'link', type: 'button', onclick: () => { close(); resetPinWithPassword(); } }, 'Forgot PIN?')));
    d.addEventListener('close', () => resolve(passed));
  });
}

/** A PIN that has been forgotten can be replaced with the account password. */
function resetPinWithPassword() {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Continue');
  sheet('Enter your login password', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      busy(submit, err, async () => {
        const wait = loginLimiter.waitMs();
        if (wait) throw new Error(waitText(wait));
        let ok;
        if (store.isCloud) {
          try {
            await store.cloud.signIn(store.cloud.session?.email, pass.value);
            ok = true;
          } catch (error) {
            if (!(error instanceof AuthError)) throw error;
            ok = false;
          }
        } else {
          ok = await verifySecret(pass.value, store.localAuth);
        }
        if (!ok) {
          loginLimiter.fail();
          throw new Error('Wrong password.');
        }
        loginLimiter.reset();
        pinLimiter.reset();
        close();
        changePin();
      });
    },
  }, field('Password', pass), err, submit));
}

export function changePin() {
  const d = sheet('New PIN', (close) => {
    const box = h('div');
    const first = pinPad({
      title: 'Enter a new 4-digit PIN',
      onComplete: (pin) => {
        box.replaceChildren(pinPad({
          title: 'Repeat the new PIN',
          onComplete: async (again, reset, showErr) => {
            if (again !== pin) { reset(); showErr("Those PINs don't match."); return; }
            const rec = await hashSecret(pin);
            store.update((s) => { s.settings.pinHash = rec; s.settings.updatedAt = Date.now(); });
            close();
            toast('PIN changed', { kind: 'good' });
          },
        }));
      },
    });
    box.append(first);
    return box;
  });
  return d;
}
