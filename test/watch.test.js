'use strict';

const test = require('node:test');
const assert = require('node:assert');
const w8 = require('../lib/watch');
const { createReceiver, handlePacket } = require('../lib/receiver');
const f = require('./fixtures');

const T0 = 1700000000000;
const MIN = 60000;
const kinds = (alarms) => alarms.map((a) => a.kind);

test('silence alarms once after 30 min, and resumes with one note', () => {
  const w = w8.createWatch(T0);
  assert.deepStrictEqual(w8.tick(w, T0 + 29 * MIN), []);
  assert.deepStrictEqual(kinds(w8.tick(w, T0 + 30 * MIN)), ['silence']);
  assert.deepStrictEqual(w8.tick(w, T0 + 90 * MIN), [], 'not repeated');
  assert.deepStrictEqual(kinds(w8.notePacket(w, T0 + 91 * MIN, 'accepted')), ['resumed']);
  assert.deepStrictEqual(w8.tick(w, T0 + 100 * MIN), []);
  assert.deepStrictEqual(kinds(w8.tick(w, T0 + 121 * MIN)), ['silence']);
});

test('rejected packets do not count as signs of life', () => {
  const w = w8.createWatch(T0);
  w8.notePacket(w, T0 + 10 * MIN, 'foreign');
  w8.notePacket(w, T0 + 20 * MIN, 'dropped');
  assert.deepStrictEqual(kinds(w8.tick(w, T0 + 30 * MIN)), ['silence']);
});

test('10 new devices in 10 minutes is a flood, once per hour', () => {
  const w = w8.createWatch(T0);
  let alarms = [];
  for (let i = 0; i < 10; i += 1) alarms = alarms.concat(w8.noteEvent(w, T0 + i * 30000, true));
  assert.deepStrictEqual(kinds(alarms), ['flood']);
  assert.strictEqual(alarms[0].data.fresh, 10);
  assert.deepStrictEqual(w8.noteEvent(w, T0 + 6 * MIN, true), [], 'cooldown');
  assert.deepStrictEqual(kinds(w8.noteEvent(w, T0 + 66 * MIN, true).concat(
    ...Array.from({ length: 9 }, (_, i) => w8.noteEvent(w, T0 + 66 * MIN + i, true)),
  )), ['flood']);
});

test('new devices spread over more than 10 minutes are not a flood', () => {
  const w = w8.createWatch(T0);
  let alarms = [];
  for (let i = 0; i < 30; i += 1) alarms = alarms.concat(w8.noteEvent(w, T0 + i * 2 * MIN, true));
  assert.deepStrictEqual(alarms, []);
});

test('100 client events in 10 minutes is a flood', () => {
  const w = w8.createWatch(T0);
  let alarms = [];
  for (let i = 0; i < 100; i += 1) alarms = alarms.concat(w8.noteEvent(w, T0 + i * 1000, false));
  assert.deepStrictEqual(kinds(alarms), ['flood']);
});

test('device alerts are capped at 20 per 10 minutes, the rest counted', () => {
  const w = w8.createWatch(T0);
  const results = Array.from({ length: 25 }, (_, i) => w8.allowDeviceAlert(w, T0 + i));
  assert.strictEqual(results.filter((r) => r.allowed).length, 20);
  assert.deepStrictEqual(kinds(results.flatMap((r) => r.alarms)), ['flood']);
  assert.strictEqual(w.day.suppressed, 5);
  assert.ok(w8.allowDeviceAlert(w, T0 + 11 * MIN).allowed, 'window moves on');
});

test('unknown and forged packets alarm once per hour', () => {
  const w = w8.createWatch(T0);
  assert.deepStrictEqual(kinds(w8.noteResult(w, T0, 'unknown')), ['unknown']);
  assert.deepStrictEqual(w8.noteResult(w, T0 + MIN, 'unknown'), []);
  assert.deepStrictEqual(kinds(w8.noteResult(w, T0, 'bad')), ['forged']);
  assert.deepStrictEqual(kinds(w8.noteResult(w, T0 + 61 * MIN, 'unknown')), ['unknown']);
  assert.strictEqual(w.day.unknown, 3);
  assert.deepStrictEqual(w8.noteResult(w, T0, 'skip'), []);
});

test('day counters are handed over with their start time, and reset', () => {
  const w = w8.createWatch(T0);
  w8.notePacket(w, T0, 'accepted');
  w8.noteResult(w, T0, 'event');
  const day = w8.takeDay(w, T0 + 5 * MIN);
  assert.strictEqual(day.packets, 1);
  assert.strictEqual(day.events, 1);
  assert.strictEqual(day.since, T0);
  assert.strictEqual(w.dayStart, T0 + 5 * MIN);
  assert.strictEqual(w.day.packets, 0);
});

test('local date and hour follow the time zone', () => {
  const at = Date.UTC(2026, 0, 15, 6, 30); // 06:30 UTC
  assert.deepStrictEqual(w8.localTime(at, 'Europe/Stockholm'), { date: '2026-01-15', hour: 7 });
  assert.deepStrictEqual(w8.localTime(at, 'UTC'), { date: '2026-01-15', hour: 6 });
});

test('receiver tells what happened to the last packet', () => {
  const rx = createReceiver();
  handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0, '192.168.1.1', null);
  assert.strictEqual(rx.last, 'event');
  handlePacket(rx, Buffer.alloc(20000), T0);
  assert.strictEqual(rx.last, 'dropped');
  handlePacket(rx, Buffer.from(f.FORGED), T0);
  assert.strictEqual(rx.last, 'bad');
});

const { reportText } = require('../lib/report');
const seen = [];
const tr = (key, tokens) => { seen.push(tokens); return key + JSON.stringify(tokens); };
const healthy = {
  listening: true, silent: false, lastPacket: '2026-01-15 06:55', since: '2026-01-14 07:00',
  accepted: 1200, newDevices: 1, events: 260, unknown: 0, alerts: 1, suppressed: 0, alarms: 0, foreign: 0, fresh: 1, approved: 20, ignored: 2,
};
const keys = (text) => text.split('\n').map((l) => l.split('{')[0]);

test('short report: one line, counts only, every token a string', () => {
  seen.length = 0;
  const text = reportText('short', healthy, tr);
  assert.ok(text.startsWith('report.ok'));
  assert.ok(!text.includes('\n'));
  assert.deepStrictEqual(seen, [{ since: '2026-01-14 07:00', packets: '1200', newDevices: '1' }]);
});

test('short report says so when YAHLA is not getting logs', () => {
  assert.ok(reportText('short', { ...healthy, silent: true }, tr).startsWith('report.problem'));
  const never = reportText('short', { ...healthy, lastPacket: null }, tr);
  assert.ok(never.startsWith('report.problem'));
  assert.strictEqual(never, `report.problem${JSON.stringify({ last: 'report.neverundefined' })}`);
});

test('report blames the port, not the router, when YAHLA cannot listen', () => {
  assert.strictEqual(reportText('short', { ...healthy, listening: false }, tr), 'report.noSocketundefined');
  assert.strictEqual(reportText('short', { ...healthy, listening: false, lastPacket: null }, tr), 'report.noSocketundefined');
});

test('report says so when logs arrive but cannot be read', () => {
  seen.length = 0;
  const text = reportText('short', { ...healthy, events: 0, unknown: 40 }, tr);
  assert.ok(text.startsWith('report.unreadable'));
  assert.deepStrictEqual(seen, [{ since: '2026-01-14 07:00', packets: '1200', unknown: '40' }]);
  assert.ok(reportText('short', { ...healthy, events: 0, unknown: 0 }, tr).startsWith('report.ok'));
  assert.deepStrictEqual(keys(reportText('full', { ...healthy, events: 0, unknown: 40 }, tr)),
    ['report.unreadable', 'report.devices', 'report.alerts']);
});

test('detailed report: three lines, and problem lines only when there is something to say', () => {
  seen.length = 0;
  assert.deepStrictEqual(keys(reportText('full', healthy, tr)), ['report.ok', 'report.devices', 'report.alerts']);
  for (const tokens of seen) for (const v of Object.values(tokens)) assert.strictEqual(typeof v, 'string');
  const busy = reportText('full', { ...healthy, suppressed: 2, alarms: 1, foreign: 5 }, tr);
  assert.deepStrictEqual(keys(busy), ['report.ok', 'report.devices', 'report.alerts', 'report.suppressed', 'report.alarms', 'report.foreign']);
});

test('local time text for alerts', () => {
  assert.strictEqual(w8.formatLocal(Date.UTC(2026, 0, 15, 6, 5), 'Europe/Stockholm'), '2026-01-15 07:05');
  assert.strictEqual(w8.formatLocal(undefined, 'UTC'), '-');
});
