// Pure data logic: no DOM, no storage. Everything here is covered by tests/.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
const LISTS = ['kids', 'devices', 'sessions', 'ledger', 'blocks'];
const pad = (n) => String(n).padStart(2, '0');

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function emptyState() {
  return {
    kids: [], devices: [], sessions: [], ledger: [], blocks: [],
    settings: { tokenMinutes: 15, pinHash: null, updatedAt: 0 },
  };
}

// ---------- Dates ----------
export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; }
export function addDays(t, n) { const d = new Date(t); d.setDate(d.getDate() + n); return +d; }
/** Weeks start on Monday. */
export function startOfWeek(t) {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return +d;
}
export function startOfMonth(t) { const d = new Date(startOfDay(t)); d.setDate(1); return +d; }
export function timeOf(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
export function fromParts(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  return +new Date(y, m - 1, d, hh, mm);
}

// ---------- Formatting ----------
/** 2h 04min, or 45min under an hour. */
export function fmtDuration(ms) {
  const total = Math.floor(Math.max(0, ms) / MIN);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${pad(m)}min` : `${m}min`;
}
/** 1:04:09 or 12:09, rounded up so a countdown only shows 0 when time is really out. */
export function fmtCountdown(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
export function fmtDate(t, now = Date.now()) {
  const d = new Date(t);
  const base = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base}/${String(d.getFullYear()).slice(2)}`;
}
export function fmtDateTime(t, now = Date.now()) {
  const wd = new Date(t).toLocaleDateString('en-GB', { weekday: 'short' });
  return `${wd} ${fmtDate(t, now)} ${timeOf(t)}`;
}

// ---------- Record helpers ----------
export const live = (list) => list.filter((r) => !r.deleted);
export const activeKids = (s) => live(s.kids).filter((k) => !k.archived);
export const activeDevices = (s) => live(s.devices).filter((d) => !d.archived);
export const byId = (list, id) => list.find((r) => r.id === id);

export function upsert(state, listName, record, now = Date.now()) {
  const list = state[listName];
  const i = list.findIndex((r) => r.id === record.id);
  const next = { ...record, updatedAt: now };
  if (i >= 0) list[i] = { ...list[i], ...next }; else list.push(next);
  return next;
}
/** Soft delete, so the removal also reaches other devices when syncing. */
export function remove(state, listName, id, now = Date.now()) {
  const r = byId(state[listName], id);
  if (r) { r.deleted = true; r.updatedAt = now; }
}
export function nextColorIdx(state) {
  const used = new Set(live(state.kids).map((k) => k.colorIdx));
  let i = 0;
  while (used.has(i)) i++;
  return i;
}
export function makeKid(state, name, allowanceMin = 120) {
  return { id: newId(), name: name.trim(), allowanceMin, colorIdx: nextColorIdx(state), archived: false };
}

// ---------- Time accounting ----------
export function sessionEnd(s, now) { return s.running ? now : (s.end ?? null); }
export function sessionMs(s, now) {
  const end = sessionEnd(s, now);
  return end == null ? null : Math.max(0, end - s.start);
}
function overlap(s, from, to, now) {
  const end = sessionEnd(s, now);
  if (end == null) return 0; // old records with no end time cannot be counted
  return Math.max(0, Math.min(end, to) - Math.max(s.start, from));
}
export function usedMs(state, kidId, from, to, now) {
  return live(state.sessions)
    .filter((s) => s.kidId === kidId)
    .reduce((sum, s) => sum + overlap(s, from, to, now), 0);
}
export function tokenBalance(state, kidId) {
  return live(state.ledger).filter((e) => e.kidId === kidId).reduce((sum, e) => sum + (e.tokens || 0), 0);
}
export function bonusMinutes(state, kidId, day) {
  return live(state.ledger)
    .filter((e) => e.kidId === kidId && e.day === day)
    .reduce((sum, e) => sum + (e.minutes || 0), 0);
}
export function runningSession(state, kidId) {
  return live(state.sessions).find((s) => s.kidId === kidId && s.running) || null;
}
export function activeBlock(state, kidId, now) {
  const blocks = live(state.blocks).filter((b) => b.kidId === kidId && !b.liftedAt && b.until > now);
  return blocks.sort((a, b) => b.until - a.until)[0] || null;
}
export const WARN_MS = 10 * MIN;

export function kidStatus(state, kid, now) {
  const from = startOfDay(now);
  const used = usedMs(state, kid.id, from, addDays(from, 1), now);
  const allowed = Math.max(0, kid.allowanceMin + bonusMinutes(state, kid.id, dayKey(now))) * MIN;
  const remaining = allowed - used;
  let level = 'ok';
  if (remaining <= 0) level = 'up';
  else if (remaining <= WARN_MS) level = 'warn';
  return {
    used, allowed, remaining, level,
    tokens: tokenBalance(state, kid.id),
    block: activeBlock(state, kid.id, now),
    running: runningSession(state, kid.id),
  };
}

// ---------- Token and penalty actions ----------
export function earnTokens(state, kidId, count, reason, useNow, now = Date.now()) {
  const base = { kidId, at: now, day: dayKey(now), reason };
  upsert(state, 'ledger', { ...base, id: newId(), type: 'earn', tokens: count, minutes: 0 }, now);
  if (useNow) spendTokens(state, kidId, count, reason, now);
}
export function spendTokens(state, kidId, count, reason, now = Date.now()) {
  // The minutes are stored on the entry, so changing the token value later never rewrites history.
  upsert(state, 'ledger', {
    id: newId(), kidId, at: now, day: dayKey(now), type: 'spend', reason,
    tokens: -count, minutes: count * state.settings.tokenMinutes,
  }, now);
}
export function penalize(state, kidId, kind, amount, reason, now = Date.now()) {
  upsert(state, 'ledger', {
    id: newId(), kidId, at: now, day: dayKey(now), reason,
    type: kind === 'tokens' ? 'penalty_tokens' : 'penalty_minutes',
    tokens: kind === 'tokens' ? -amount : 0,
    minutes: kind === 'minutes' ? -amount : 0,
  }, now);
}
/** A block also ends any session the kid is running. Returns true if one was stopped. */
export function blockKid(state, kidId, until, reason, now = Date.now()) {
  upsert(state, 'blocks', { id: newId(), kidId, at: now, until, reason, liftedAt: null }, now);
  const running = runningSession(state, kidId);
  if (running) stopSession(state, running.id, now);
  return Boolean(running);
}
export function liftBlocks(state, kidId, now = Date.now()) {
  live(state.blocks)
    .filter((b) => b.kidId === kidId && !b.liftedAt && b.until > now)
    .forEach((b) => { b.liftedAt = now; b.updatedAt = now; });
}
export function startSession(state, kidId, deviceId, now = Date.now()) {
  if (activeBlock(state, kidId, now)) throw new Error('This kid is blocked');
  if (runningSession(state, kidId)) throw new Error('A session is already running');
  return upsert(state, 'sessions', { id: newId(), kidId, deviceId, start: now, end: null, running: true }, now);
}
export function stopSession(state, sessionId, now = Date.now()) {
  const s = byId(state.sessions, sessionId);
  if (s) { s.running = false; s.end = now; s.updatedAt = now; }
}
/** Other sessions of the same kid that overlap this time range. */
export function findOverlaps(state, { id, kidId, start, end }, now) {
  const stop = end ?? now;
  return live(state.sessions).filter((s) => {
    if (s.id === id || s.kidId !== kidId) return false;
    const sEnd = sessionEnd(s, now);
    return sEnd != null && s.start < stop && start < sEnd;
  });
}

// ---------- Reports ----------
function rangeTotals(sessions, now) {
  const day = startOfDay(now);
  const tomorrow = addDays(day, 1);
  const sum = (from, to) => sessions.reduce((t, s) => t + overlap(s, from, to, now), 0);
  return {
    today: sum(day, tomorrow),
    week: sum(startOfWeek(now), tomorrow),
    month: sum(startOfMonth(now), tomorrow),
    all: sum(-Infinity, Infinity),
  };
}
export function kidTotals(state, kidId, now) {
  return rangeTotals(live(state.sessions).filter((s) => s.kidId === kidId), now);
}
export function deviceTotals(state, deviceId, now) {
  return rangeTotals(live(state.sessions).filter((s) => s.deviceId === deviceId), now);
}
export function countNoEnd(state) {
  return live(state.sessions).filter((s) => !s.running && s.end == null).length;
}
/** `count` weeks ending with the week containing `endWeek`, each with per-kid totals. */
export function weeklySeries(state, kids, endWeek, count, now) {
  const weeks = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(startOfWeek(endWeek), -7 * i);
    const end = addDays(start, 7);
    const perKid = {};
    for (const k of kids) perKid[k.id] = usedMs(state, k.id, start, end, now);
    weeks.push({ start, perKid });
  }
  return weeks;
}
export function latestWeekWithData(state, now) {
  const starts = live(state.sessions).map((s) => s.start).filter((t) => t <= now);
  return startOfWeek(starts.length ? Math.max(...starts) : now);
}
export function earliestWeek(state, now) {
  const starts = live(state.sessions).map((s) => s.start);
  return startOfWeek(starts.length ? Math.min(...starts) : now);
}

// ---------- Importing old written records ----------
const LINE = /^(\S+)\s+(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\s+(\d{1,2}:\d{2})\s*(?:[–—-]\s*)?(\(?no end\)?|\d{1,2}:\d{2})?\s*(.+)$/i;

/** Parses lines like "Ana 17/04 14:34–18:44 Tablet" or "Ana 06/05 17:04–(no end) Tablet". */
export function parseRecords(text, now = Date.now()) {
  const records = [];
  const errors = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const m = LINE.exec(line);
    const bad = () => errors.push({ line: index + 1, text: line });
    if (!m) return bad();
    const [, kid, dd, mm, yy, startT, endT, device] = m;
    const day = Number(dd);
    const month = Number(mm);
    if (month < 1 || month > 12 || day < 1 || day > 31) return bad();
    const clock = (t) => t.split(':').map(Number);
    const [sh, sm] = clock(startT);
    if (sh > 23 || sm > 59) return bad();
    // No year written: use the most recent date that is not in the future.
    let year = yy ? (yy.length === 2 ? 2000 + Number(yy) : Number(yy)) : new Date(now).getFullYear();
    let start = +new Date(year, month - 1, day, sh, sm);
    if (new Date(start).getDate() !== day) return bad();
    if (!yy && start > now) { year -= 1; start = +new Date(year, month - 1, day, sh, sm); }
    let end = null;
    if (endT && endT.includes(':')) {
      const [eh, em] = clock(endT);
      if (eh > 23 || em > 59) return bad();
      end = +new Date(year, month - 1, day, eh, em);
      if (end < start) end = addDays(end, 1); // crossed midnight
    }
    records.push({ kid, device: device.trim(), start, end });
    return undefined;
  });
  return { records, errors };
}

function matchDevice(devices, name) {
  const lower = name.toLowerCase();
  const exact = devices.find((d) => d.name.toLowerCase() === lower);
  if (exact) return exact;
  // "iPhone 14" belongs to an existing "iPhone" entry.
  return devices.find((d) => lower.startsWith(`${d.name.toLowerCase()} `)) || null;
}

/** Adds parsed records, creating missing kids and devices. Skips exact repeats. */
export function importRecords(state, records, now = Date.now()) {
  const counts = { added: 0, skipped: 0, kids: 0, devices: 0 };
  for (const r of records) {
    let kid = live(state.kids).find((k) => k.name.toLowerCase() === r.kid.toLowerCase());
    if (!kid) { kid = upsert(state, 'kids', makeKid(state, r.kid), now); counts.kids++; }
    let device = matchDevice(live(state.devices), r.device);
    if (!device) { device = upsert(state, 'devices', { id: newId(), name: r.device, archived: false }, now); counts.devices++; }
    const repeat = live(state.sessions).some((s) => s.kidId === kid.id && s.start === r.start && s.deviceId === device.id);
    if (repeat) { counts.skipped++; continue; }
    upsert(state, 'sessions', { id: newId(), kidId: kid.id, deviceId: device.id, start: r.start, end: r.end, running: false }, now);
    counts.added++;
  }
  return counts;
}

// ---------- Sync merge ----------
/** Stable JSON: Postgres jsonb reorders keys, so plain stringify cannot compare states. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
function newer(a, b) {
  const diff = (a.updatedAt || 0) - (b.updatedAt || 0);
  if (diff) return diff > 0 ? a : b;
  return canon(a) >= canon(b) ? a : b; // same timestamp: both devices must pick the same winner
}
/** Combines two copies record by record. The newest edit of each record wins. */
export function mergeStates(a, b) {
  const out = emptyState();
  for (const name of LISTS) {
    const map = new Map();
    for (const r of [...(a[name] || []), ...(b[name] || [])]) {
      const cur = map.get(r.id);
      map.set(r.id, cur ? newer(cur, r) : r);
    }
    out[name] = [...map.values()].sort((x, y) => (x.id < y.id ? -1 : 1));
  }
  out.settings = newer(a.settings || out.settings, b.settings || out.settings);
  return out;
}

// ---------- JSON backup ----------
export function exportBackup(state, now = Date.now()) {
  const settings = { ...state.settings };
  delete settings.pinHash; // a backup file should not carry the PIN
  return { app: 'playtime', format: 1, exportedAt: now, data: { ...state, settings } };
}
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const RULES = {
  kids: (r) => isStr(r.name) && isNum(r.allowanceMin) && r.allowanceMin >= 0,
  devices: (r) => isStr(r.name),
  sessions: (r) => isStr(r.kidId) && isNum(r.start) && (r.end == null || isNum(r.end)),
  ledger: (r) => isStr(r.kidId) && isNum(r.at),
  blocks: (r) => isStr(r.kidId) && isNum(r.until),
};
export function parseBackup(json) {
  let obj;
  try { obj = JSON.parse(json); } catch { throw new Error('That file is not valid JSON.'); }
  const data = obj && obj.app === 'playtime' ? obj.data : null;
  if (!data) throw new Error('That file is not a Playtime backup.');
  for (const name of LISTS) {
    if (!Array.isArray(data[name])) throw new Error(`The backup is missing "${name}".`);
    const bad = data[name].find((r) => !r || !isStr(r.id) || !RULES[name](r));
    if (bad) throw new Error(`The backup has a damaged record in "${name}".`);
  }
  if (data.settings && !isNum(data.settings.tokenMinutes)) throw new Error('The backup has damaged settings.');
  return data;
}
/** Restores a backup. Current records missing from it are soft deleted so they stay gone after a sync. */
export function restoreBackup(current, backup, now = Date.now()) {
  const next = emptyState();
  for (const name of LISTS) {
    const incoming = new Map(backup[name].map((r) => [r.id, { ...r, updatedAt: now }]));
    const gone = current[name]
      .filter((r) => !incoming.has(r.id))
      .map((r) => ({ ...r, deleted: true, updatedAt: now }));
    next[name] = [...incoming.values(), ...gone];
  }
  next.settings = {
    ...current.settings,
    tokenMinutes: backup.settings?.tokenMinutes ?? current.settings.tokenMinutes,
    updatedAt: now,
  };
  return next;
}
