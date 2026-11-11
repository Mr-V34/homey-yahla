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

test('day counters are handed over and reset', () => {
  const w = w8.createWatch(T0);
  w8.notePacket(w, T0, 'accepted');
  w8.noteResult(w, T0, 'event');
  const day = w8.takeDay(w);
  assert.strictEqual(day.packets, 1);
  assert.strictEqual(day.events, 1);
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

test('report tokens are plain strings with counts only', () => {
  const { reportTokens } = require('../lib/report');
  const w = w8.createWatch(T0);
  w8.notePacket(w, T0, 'accepted');
  const tok = reportTokens('2026-01-15', w8.takeDay(w), { new: 1, approved: 2, ignored: 0 }, {
    listening: true, lastPacket: T0, now: T0 + 5 * MIN, pinSet: true, sendersSet: false, yes: 'ja', no: 'nej', never: 'aldrig',
  });
  for (const v of Object.values(tok)) assert.strictEqual(typeof v, 'string');
  assert.strictEqual(tok.lastPacket, '5');
  assert.strictEqual(tok.sendersSet, 'nej');
});

test('local time text for alerts', () => {
  assert.strictEqual(w8.formatLocal(Date.UTC(2026, 0, 15, 6, 5), 'Europe/Stockholm'), '2026-01-15 07:05');
  assert.strictEqual(w8.formatLocal(undefined, 'UTC'), '-');
});
