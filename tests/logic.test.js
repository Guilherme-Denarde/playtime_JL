import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';

const at = (y, m, d, hh = 0, mm = 0) => +new Date(y, m - 1, d, hh, mm);
const NOW = at(2026, 11, 2, 12, 0); // a Monday

function world() {
  const s = L.emptyState();
  const ana = L.upsert(s, 'kids', L.makeKid(s, 'Ana', 120), 1);
  const ben = L.upsert(s, 'kids', L.makeKid(s, 'Ben', 60), 1);
  const tablet = L.upsert(s, 'devices', { id: L.newId(), name: 'Tablet' }, 1);
  return { s, ana, ben, tablet };
}

test('durations read like 2h 04min', () => {
  assert.equal(L.fmtDuration(124 * L.MIN), '2h 04min');
  assert.equal(L.fmtDuration(45 * L.MIN), '45min');
  assert.equal(L.fmtDuration(-5), '0min');
  assert.equal(L.fmtCountdown(62 * L.MIN + 9000), '1:02:09');
  assert.equal(L.fmtCountdown(1), '0:01');
});

test('a running session counts down, warns at 10 min and hits time up at zero', () => {
  const { s, ana, tablet } = world();
  L.startSession(s, ana.id, tablet.id, NOW);
  assert.equal(L.kidStatus(s, ana, NOW + 100 * L.MIN).level, 'ok');
  assert.equal(L.kidStatus(s, ana, NOW + 110 * L.MIN).level, 'warn');
  assert.equal(L.kidStatus(s, ana, NOW + 119 * L.MIN).remaining, 1 * L.MIN);
  assert.equal(L.kidStatus(s, ana, NOW + 120 * L.MIN).level, 'up');
});

test('a session across midnight only uses the part inside today', () => {
  const { s, ana, tablet } = world();
  const today = at(2026, 11, 2, 0, 30);
  L.upsert(s, 'sessions', { id: 'x', kidId: ana.id, deviceId: tablet.id, start: at(2026, 11, 1, 23, 0), end: today, running: false });
  assert.equal(L.kidStatus(s, ana, NOW).used, 30 * L.MIN);
  assert.equal(L.kidTotals(s, ana.id, NOW).all, 90 * L.MIN);
});

test('sessions with no end show no duration and are not counted', () => {
  const { s, ana, tablet } = world();
  L.upsert(s, 'sessions', { id: 'x', kidId: ana.id, deviceId: tablet.id, start: NOW - L.HOUR, end: null, running: false });
  assert.equal(L.sessionMs(s.sessions[0], NOW), null);
  assert.equal(L.kidStatus(s, ana, NOW).used, 0);
  assert.equal(L.countNoEnd(s), 1);
});

test('saved tokens add no time until they are spent', () => {
  const { s, ana } = world();
  L.earnTokens(s, ana.id, 2, 'homework', false, NOW);
  assert.equal(L.tokenBalance(s, ana.id), 2);
  assert.equal(L.kidStatus(s, ana, NOW).allowed, 120 * L.MIN);
  L.spendTokens(s, ana.id, 1, 'treat', NOW);
  assert.equal(L.tokenBalance(s, ana.id), 1);
  assert.equal(L.kidStatus(s, ana, NOW).allowed, 135 * L.MIN);
});

test('tokens used immediately leave the balance unchanged and add time', () => {
  const { s, ana } = world();
  L.earnTokens(s, ana.id, 1, 'cleaned', true, NOW);
  assert.equal(L.tokenBalance(s, ana.id), 0);
  assert.equal(L.kidStatus(s, ana, NOW).allowed, 135 * L.MIN);
});

test('changing the token value does not change time already granted', () => {
  const { s, ana } = world();
  L.earnTokens(s, ana.id, 1, 'x', true, NOW);
  s.settings.tokenMinutes = 60;
  assert.equal(L.kidStatus(s, ana, NOW).allowed, 135 * L.MIN);
});

test('bonus minutes apply only to the day they were granted', () => {
  const { s, ana } = world();
  L.earnTokens(s, ana.id, 1, 'x', true, NOW);
  assert.equal(L.kidStatus(s, ana, L.addDays(NOW, 1)).allowed, 120 * L.MIN);
});

test('penalties remove tokens or minutes, and allowed time never goes below zero', () => {
  const { s, ben } = world();
  L.penalize(s, ben.id, 'tokens', 2, 'rude', NOW);
  assert.equal(L.tokenBalance(s, ben.id), -2);
  L.penalize(s, ben.id, 'minutes', 30, 'late', NOW);
  assert.equal(L.kidStatus(s, ben, NOW).allowed, 30 * L.MIN);
  L.penalize(s, ben.id, 'minutes', 500, 'very late', NOW);
  assert.equal(L.kidStatus(s, ben, NOW).allowed, 0);
  assert.equal(L.kidStatus(s, ben, NOW).level, 'up');
});

test('blocks stop running sessions, prevent starting, expire and can be lifted', () => {
  const { s, ana, tablet } = world();
  const session = L.startSession(s, ana.id, tablet.id, NOW);
  const until = NOW + 2 * L.HOUR;
  assert.equal(L.blockKid(s, ana.id, until, 'fight', NOW + L.MIN), true);
  assert.equal(L.byId(s.sessions, session.id).end, NOW + L.MIN);
  assert.equal(L.runningSession(s, ana.id), null);
  assert.throws(() => L.startSession(s, ana.id, tablet.id, NOW + L.HOUR), /blocked/);
  assert.equal(L.activeBlock(s, ana.id, until + 1), null);
  L.liftBlocks(s, ana.id, NOW + L.HOUR);
  assert.equal(L.activeBlock(s, ana.id, NOW + L.HOUR + 1), null);
  assert.ok(L.startSession(s, ana.id, tablet.id, NOW + L.HOUR + 1));
});

test('only one running session per kid', () => {
  const { s, ana, tablet } = world();
  L.startSession(s, ana.id, tablet.id, NOW);
  assert.throws(() => L.startSession(s, ana.id, tablet.id, NOW), /already running/);
});

test('week, month and device totals use the right ranges', () => {
  const { s, ana, tablet } = world();
  const add = (id, start, mins) => L.upsert(s, 'sessions', { id, kidId: ana.id, deviceId: tablet.id, start, end: start + mins * L.MIN, running: false });
  add('today', at(2026, 11, 2, 8), 10);
  add('lastWeek', at(2026, 11, 1, 8), 20); // Sunday: previous week, same month
  add('lastMonth', at(2026, 10, 31, 8), 30);
  add('old', at(2026, 4, 1, 8), 40);
  assert.deepEqual(L.kidTotals(s, ana.id, NOW), {
    today: 10 * L.MIN, week: 10 * L.MIN, month: 30 * L.MIN, all: 100 * L.MIN,
  });
  assert.equal(L.deviceTotals(s, tablet.id, NOW).all, 100 * L.MIN);
});

test('weekly series groups by Monday-based week', () => {
  const { s, ana, ben, tablet } = world();
  L.upsert(s, 'sessions', { id: 'a', kidId: ana.id, deviceId: tablet.id, start: at(2026, 10, 26, 8), end: at(2026, 10, 26, 9), running: false });
  L.upsert(s, 'sessions', { id: 'b', kidId: ben.id, deviceId: tablet.id, start: at(2026, 11, 2, 8), end: at(2026, 11, 2, 8, 30), running: false });
  const w = L.weeklySeries(s, [ana, ben], NOW, 2, NOW);
  assert.equal(w[0].start, at(2026, 10, 26));
  assert.equal(w[0].perKid[ana.id], L.HOUR);
  assert.equal(w[1].perKid[ben.id], 30 * L.MIN);
});

test('parses the written record format', () => {
  const text = `Ana 17/04 14:34–18:44 Big Tablet
Ben 06/05 17:04–(no end) Phone 14
Ana 03/06 13:26-15:26 Console

Ben 01/12/2025 23:00–01:00 Console`;
  const { records, errors } = L.parseRecords(text, NOW);
  assert.equal(errors.length, 0);
  assert.equal(records.length, 4);
  assert.equal(records[0].device, 'Big Tablet');
  assert.equal(records[0].end - records[0].start, 250 * L.MIN);
  assert.equal(new Date(records[0].start).getFullYear(), 2026);
  assert.equal(new Date(records[0].start).getMonth(), 3, 'dates are day/month');
  assert.equal(records[1].end, null);
  assert.equal(records[1].device, 'Phone 14');
  assert.equal(records[3].end - records[3].start, 2 * L.HOUR, 'crosses midnight');
});

test('a date with no year uses the most recent past date', () => {
  const { records } = L.parseRecords('Ana 25/12 10:00–11:00 Tablet', NOW);
  assert.equal(new Date(records[0].start).getFullYear(), 2025);
});

test('reports bad lines rather than guessing', () => {
  const { records, errors } = L.parseRecords('hello there\nAna 31/02 10:00–11:00 Tablet\nAna 10/10 25:00–26:00 Tablet', NOW);
  assert.equal(records.length, 0);
  assert.deepEqual(errors.map((e) => e.line), [1, 2, 3]);
});

test('import creates what is missing, matches device variants and skips repeats', () => {
  const s = L.emptyState();
  L.upsert(s, 'devices', { id: 'p', name: 'Phone' }, 1);
  const { records } = L.parseRecords('Ana 17/04 14:00–15:00 Phone 14\nana 17/04 16:00–17:00 Tablet', NOW);
  assert.deepEqual(L.importRecords(s, records, NOW), { added: 2, skipped: 0, kids: 1, devices: 1 });
  assert.equal(s.sessions[0].deviceId, 'p');
  assert.deepEqual(L.importRecords(s, records, NOW), { added: 0, skipped: 2, kids: 0, devices: 0 });
});

test('merge keeps the newest edit of each record, deletions included', () => {
  const a = L.emptyState();
  const b = L.emptyState();
  L.upsert(a, 'kids', { id: 'k', name: 'Old' }, 1);
  L.upsert(b, 'kids', { id: 'k', name: 'New' }, 2);
  L.upsert(a, 'devices', { id: 'onlyA', name: 'A' }, 1);
  L.upsert(b, 'devices', { id: 'gone', name: 'B' }, 1);
  L.upsert(a, 'devices', { id: 'gone', name: 'B', deleted: true }, 5);
  const m = L.mergeStates(a, b);
  assert.equal(m.kids[0].name, 'New');
  assert.equal(L.live(m.devices).length, 1);
  assert.equal(L.canon(L.mergeStates(a, b)), L.canon(L.mergeStates(b, a)), 'both devices end up the same');
});

test('canon ignores key order, as Postgres jsonb reorders keys', () => {
  assert.equal(L.canon({ b: 1, a: [{ d: 1, c: null }] }), L.canon({ a: [{ c: null, d: 1 }], b: 1 }));
});

test('backups leave out the PIN and restore cleanly', () => {
  const { s, ana } = world();
  s.settings.pinHash = { hash: 'secret' };
  const file = JSON.stringify(L.exportBackup(s, NOW));
  assert.ok(!file.includes('secret'));

  const after = structuredClone(s);
  L.upsert(after, 'kids', L.makeKid(after, 'Newer'), NOW);
  const restored = L.restoreBackup(after, L.parseBackup(file), NOW + 1);
  assert.deepEqual(L.live(restored.kids).map((k) => k.name).sort(), ['Ana', 'Ben']);
  assert.equal(restored.settings.pinHash.hash, 'secret', 'current PIN is kept');
  // The removed kid must stay removed after merging with a copy that still has it.
  assert.equal(L.live(L.mergeStates(after, restored).kids).length, 2);
  assert.ok(L.byId(restored.kids, ana.id));
});

test('damaged backups are rejected', () => {
  assert.throws(() => L.parseBackup('nope'), /not valid JSON/);
  assert.throws(() => L.parseBackup('{"a":1}'), /not a Playtime backup/);
  const bad = L.exportBackup(L.emptyState());
  bad.data.sessions = [{ id: 'x', kidId: 'k', start: 'soon' }];
  assert.throws(() => L.parseBackup(JSON.stringify(bad)), /damaged record/);
});

test('overlap check finds clashes for the same kid only', () => {
  const { s, ana, ben, tablet } = world();
  L.upsert(s, 'sessions', { id: 'a', kidId: ana.id, deviceId: tablet.id, start: at(2026, 5, 1, 10), end: at(2026, 5, 1, 11), running: false });
  const clash = (kidId, h1, h2) => L.findOverlaps(s, { id: 'new', kidId, start: at(2026, 5, 1, h1), end: at(2026, 5, 1, h2) }, NOW).length;
  assert.equal(clash(ana.id, 10, 12), 1);
  assert.equal(clash(ana.id, 11, 12), 0, 'touching is fine');
  assert.equal(clash(ben.id, 10, 12), 0);
});
