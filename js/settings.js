// Settings tab: kids, devices, token value, security, database choice and backups.
import * as L from './logic.js';
import { store } from './store.js';
import { hashSecret, verifySecret } from './crypto.js';
import { h, field, errorBox, busy, sheet, confirmSheet, toast, stepper, app } from './ui.js';
import { changePin, cloudForm, recordsSummary, encodeSetup } from './account.js';

export function renderSettings() {
  const { state } = store;
  return h('div', { class: 'stack-lg' },
    kidsCard(state),
    devicesCard(state),
    section('Tokens', h('div', { class: 'row-between' },
      h('span', {}, 'Minutes per token'),
      stepper(state.settings.tokenMinutes, 1, debounceTokenMinutes, ' min'))),
    section('Security',
      h('button', { class: 'row-btn', type: 'button', onclick: changePin }, 'Change admin PIN'),
      !store.isCloud && h('button', { class: 'row-btn', type: 'button', onclick: changePassword }, 'Change login password'),
      h('button', { class: 'row-btn', type: 'button', onclick: () => app.logout() }, 'Log out')),
    databaseCard(),
    backupCard(),
    h('button', { class: 'btn btn-ghost-red', type: 'button', onclick: eraseAll }, 'Erase everything on this device'));
}

function section(title, ...content) {
  return h('section', { class: 'card stack-sm' }, h('h2', { class: 'card-title' }, title), ...content);
}

let tokenTimer;
function debounceTokenMinutes(value) {
  // Saved after a pause so a held stepper doesn't redraw the page under the finger.
  clearTimeout(tokenTimer);
  tokenTimer = setTimeout(() => store.update((d) => { d.settings.tokenMinutes = value; d.settings.updatedAt = Date.now(); }), 700);
}

// ----- Kids -----
function kidsCard(state) {
  const kids = L.live(state.kids);
  return section('Kids',
    kids.filter((k) => !k.archived).map((k) => h('button', { class: 'row-btn', type: 'button', onclick: () => editKid(k) },
      h('span', {}, k.name), h('span', { class: 'muted' }, `${L.fmtDuration(k.allowanceMin * L.MIN)}/day`))),
    h('button', { class: 'btn btn-ink btn-small', type: 'button', onclick: () => editKid(null) }, '+ Add kid'),
    archivedList(kids, 'kids', deleteKidForever));
}

function archivedList(items, listName, onDelete) {
  const archived = items.filter((i) => i.archived);
  return archived.length > 0 && h('details', { class: 'archived' },
    h('summary', {}, `Removed (${archived.length})`),
    archived.map((i) => h('div', { class: 'row-between' },
      h('span', {}, i.name),
      h('span', { class: 'row-actions' },
        h('button', { class: 'link', type: 'button', onclick: () => store.update((d) => L.upsert(d, listName, { ...L.byId(d[listName], i.id), archived: false })) }, 'Restore'),
        h('button', { class: 'link link-red', type: 'button', onclick: () => onDelete(i) }, 'Delete')))));
}

function editKid(kid) {
  const name = h('input', { type: 'text', maxlength: 30, value: kid?.name || '', required: true, autocomplete: 'off' });
  const total = kid?.allowanceMin ?? 120;
  const hours = h('input', { type: 'number', inputmode: 'numeric', min: 0, value: Math.floor(total / 60) });
  const mins = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, value: total % 60 });
  const err = errorBox();
  sheet(kid ? `Edit ${kid.name}` : 'Add kid', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const n = name.value.trim();
      const allowance = Number(hours.value) * 60 + Number(mins.value);
      if (!n) return err.show('Enter a name.');
      if (!(allowance >= 0)) return err.show('Enter a valid daily time.');
      const clash = L.live(store.state.kids).some((k) => k.id !== kid?.id && k.name.toLowerCase() === n.toLowerCase());
      if (clash) return err.show(`There is already a kid named ${n}.`);
      store.update((d) => {
        const base = kid ? L.byId(d.kids, kid.id) : L.makeKid(d, n);
        L.upsert(d, 'kids', { ...base, name: n, allowanceMin: allowance });
      });
      return close();
    },
  },
  field('Name', name),
  h('div', { class: 'grid-2' }, field('Hours per day', hours), field('Minutes', mins)),
  err,
  h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Save'),
  kid && h('button', {
    class: 'btn btn-ghost-red', type: 'button',
    onclick: async () => {
      const ok = await confirmSheet({
        title: `Remove ${kid.name}?`,
        message: `${kid.name} disappears from the home screen. History is kept, and you can restore them later.`,
        confirm: 'Remove', danger: true,
      });
      if (ok) {
        store.update((d) => {
          const running = L.runningSession(d, kid.id);
          if (running) L.stopSession(d, running.id);
          L.upsert(d, 'kids', { ...L.byId(d.kids, kid.id), archived: true });
        });
        close();
      }
    },
  }, 'Remove kid')));
}

async function deleteKidForever(kid) {
  const ok = await confirmSheet({
    title: `Delete ${kid.name} for good?`,
    message: `All of ${kid.name}'s sessions, tokens, penalties and blocks will be deleted. This can't be undone.`,
    confirm: 'Delete everything', danger: true,
  });
  if (!ok) return;
  store.update((d) => {
    const now = Date.now();
    ['sessions', 'ledger', 'blocks'].forEach((list) => {
      d[list].filter((r) => r.kidId === kid.id).forEach((r) => L.remove(d, list, r.id, now));
    });
    L.remove(d, 'kids', kid.id, now);
  });
}

// ----- Devices -----
function devicesCard(state) {
  const devices = L.live(state.devices);
  return section('Devices',
    devices.filter((d) => !d.archived).map((d) => h('button', { class: 'row-btn', type: 'button', onclick: () => editDevice(d) }, d.name)),
    h('button', { class: 'btn btn-ink btn-small', type: 'button', onclick: () => editDevice(null) }, '+ Add device'),
    archivedList(devices, 'devices', async (device) => {
      const used = L.live(store.state.sessions).some((s) => s.deviceId === device.id);
      const ok = await confirmSheet({
        title: `Delete ${device.name}?`,
        message: used ? 'Past sessions on it are kept but will show no device name.' : 'This removes it for good.',
        confirm: 'Delete', danger: true,
      });
      if (ok) store.update((d) => L.remove(d, 'devices', device.id));
    }));
}
function editDevice(device) {
  const name = h('input', { type: 'text', maxlength: 30, value: device?.name || '', required: true, autocomplete: 'off' });
  const err = errorBox();
  sheet(device ? `Edit ${device.name}` : 'Add device', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) return err.show('Enter a name.');
      store.update((d) => L.upsert(d, 'devices', device ? { ...L.byId(d.devices, device.id), name: n } : { id: L.newId(), name: n, archived: false }));
      return close();
    },
  },
  field('Name', name), err,
  h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Save'),
  device && h('button', {
    class: 'btn btn-ghost-red', type: 'button',
    onclick: () => {
      store.update((d) => L.upsert(d, 'devices', { ...L.byId(d.devices, device.id), archived: true }));
      close();
    },
  }, 'Remove device')));
}

// ----- Account -----
function changePassword() {
  const current = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const next = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Change password');
  sheet('Change password', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      busy(submit, err, async () => {
        const auth = store.localAuth;
        if (!await verifySecret(current.value, auth)) throw new Error('The current password is wrong.');
        if (next.value.length < 6) throw new Error('Use at least 6 characters.');
        store.setLocalAuth({ username: auth.username, ...await hashSecret(next.value) });
        close();
        toast('Password changed', { kind: 'good' });
      });
    },
  }, field('Current password', current), field('New password', next), err, submit));
}

// ----- Database choice -----
function databaseCard() {
  const statusText = {
    idle: store.dirty ? 'Waiting to sync' : 'Synced',
    syncing: 'Syncing…',
    offline: 'Offline: changes will sync when you reconnect',
    error: store.syncError || 'Sync problem',
  }[store.syncStatus];
  if (store.isCloud) {
    return section('Database',
      h('p', {}, h('strong', {}, 'Cloud (Supabase)')),
      h('p', { class: 'muted' }, `${store.cloud?.session?.email || ''} · ${statusText}`),
      h('button', { class: 'row-btn', type: 'button', onclick: () => store.sync() }, 'Sync now'),
      h('button', { class: 'row-btn', type: 'button', onclick: copyDeviceLink }, 'Copy link to set up another phone'),
      h('button', { class: 'row-btn', type: 'button', onclick: moveToLocal }, 'Switch to this device only'));
  }
  return section('Database',
    h('p', {}, h('strong', {}, 'This device')),
    h('p', { class: 'muted' }, 'Data is saved only on this phone. Move it to the cloud to use several phones and protect it if this one is lost.'),
    h('button', { class: 'row-btn', type: 'button', onclick: moveToCloud }, 'Switch to cloud database (Supabase)'));
}

function moveToCloud() {
  sheet('Switch to cloud', (close) => h('div', { class: 'stack' },
    h('p', { class: 'muted' }, 'Your data here is copied up and combined with anything already in the account. Nothing is deleted.'),
    cloudForm({
      submitLabel: 'Sign in and move data',
      onConnected: async () => {
        const ok = await store.sync();
        if (!ok) throw new Error(store.syncError || 'Connected, but syncing failed. It will retry automatically.');
        close();
        app.render();
        toast('Now saving to the cloud', { kind: 'good' });
      },
    })));
}

function moveToLocal() {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true });
  const pass = h('input', { type: 'password', autocomplete: 'new-password', required: true });
  const err = errorBox();
  const submit = h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Switch to this device');
  sheet('Switch to this device', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      busy(submit, err, async () => {
        if (pass.value.length < 6) throw new Error('Use at least 6 characters.');
        const ok = await store.sync();
        if (!ok) throw new Error("Couldn't get the latest data from the cloud, so nothing was changed. Try again when online.");
        store.useLocal({ username: user.value.trim(), ...await hashSecret(pass.value) });
        close();
        toast('Now saving on this device. Your cloud copy was not deleted.', { kind: 'good' });
      });
    },
  },
  h('p', { class: 'muted' }, 'Create a login for this device. Your data is copied here, and other phones stop receiving updates.'),
  field('Username', user), field('Password', pass), err, submit));
}

async function copyDeviceLink() {
  const link = `${location.origin}${location.pathname}#setup=${encodeSetup({ cloud: { url: store.config.url, anonKey: store.config.anonKey } })}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied. Open it on the other phone.', { kind: 'good' });
  } catch {
    sheet('Link for another phone', () => h('textarea', { rows: 6, readonly: true, value: link }));
  }
}

// ----- Backups -----
function backupCard() {
  const last = store.lastBackup;
  return section('Backup',
    h('p', { class: 'muted' }, last ? `Last backup: ${L.fmtDateTime(last)}` : 'No backup yet.'),
    h('button', { class: 'row-btn', type: 'button', onclick: exportJson }, 'Export backup (JSON)'),
    h('button', { class: 'row-btn', type: 'button', onclick: importJson }, 'Restore from backup'),
    h('button', { class: 'row-btn', type: 'button', onclick: importOld }, 'Import old written records'));
}

async function exportJson() {
  const now = Date.now();
  const text = JSON.stringify(L.exportBackup(store.state, now), null, 1);
  const name = `playtime-backup-${L.dayKey(now)}.json`;
  const file = new File([text], name, { type: 'application/json' });
  // Installed iPhone apps can't reliably download files, but they can share them.
  if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file] });
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }
  } else {
    const url = URL.createObjectURL(file);
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  store.markBackedUp();
  app.render();
  toast('Backup exported', { kind: 'good' });
}

function importJson() {
  const input = h('input', {
    type: 'file', accept: 'application/json,.json',
    onchange: async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const backup = L.parseBackup(await f.text());
        const ok = await confirmSheet({
          title: 'Replace all data?',
          message: `This replaces everything with the backup (${L.live(backup.kids).length} kids, ${L.live(backup.sessions).length} sessions). Your PIN and login stay the same.`,
          confirm: 'Replace data', danger: true,
        });
        if (!ok) return;
        store.replace(L.restoreBackup(store.state, backup));
        toast('Backup restored', { kind: 'good' });
      } catch (e) {
        toast(e.message, { kind: 'bad' });
      }
    },
  });
  input.click();
}

function importOld() {
  const text = h('textarea', { rows: 8, placeholder: 'Ana 17/04 14:34–18:44 Tablet\nAna 06/05 17:04–(no end) Tablet' });
  const preview = h('p', { class: 'hint' });
  text.addEventListener('input', () => { preview.textContent = recordsSummary(text.value); });
  const err = errorBox();
  sheet('Import old records', (close) => h('form', {
    class: 'stack',
    onsubmit: (e) => {
      e.preventDefault();
      const { records, errors } = L.parseRecords(text.value);
      if (errors.length) return err.show(`Line ${errors[0].line} wasn't understood: "${errors[0].text}"`);
      if (!records.length) return err.show('Paste at least one line.');
      const c = store.update((d) => L.importRecords(d, records));
      close();
      return toast(`Added ${c.added} sessions${c.skipped ? `, skipped ${c.skipped} repeats` : ''}`, { kind: 'good' });
    },
  },
  h('p', { class: 'muted' }, 'One per line: name, day/month, start–end, device.'),
  text, preview, err,
  h('button', { class: 'btn btn-big btn-ink', type: 'submit' }, 'Import')));
}

async function eraseAll() {
  const ok = await confirmSheet({
    title: 'Erase everything on this device?',
    message: store.isCloud
      ? 'This disconnects this device. Your cloud data stays in Supabase.'
      : "All kids, sessions and tokens on this device will be deleted. This can't be undone unless you have a backup.",
    confirm: 'Erase', danger: true,
  });
  if (ok) {
    store.eraseEverything();
    location.reload();
  }
}
