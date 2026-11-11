'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseText } = require('../lib/parsers');
const { handleEvent, COOLDOWN_MS } = require('../lib/detector');
const {
  emptyStore, loadStore, MAX_DEVICES,
} = require('../lib/registry');
const { createReceiver, handlePacket, MAX_PER_MINUTE } = require('../lib/receiver');
const { tokensFor } = require('../lib/alerts');
const f = require('./fixtures');

const T0 = 1700000000000;
const ev = (line, at) => parseText(line, at).event;

test('a new device alerts once, then waits for the cooldown', () => {
  const store = emptyStore();
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0)).type, 'new');
  assert.strictEqual(handleEvent(store, ev(f.WIFI_LEAVE, T0 + 1000)), null);
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0 + 2000)), null);
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0 + COOLDOWN_MS)).type, 'unapproved');
});

test('a device first seen leaving is still new', () => {
  assert.strictEqual(handleEvent(emptyStore(), ev(f.WIFI_LEAVE, T0)).type, 'new');
});

test('an unapproved device that changes network alerts at once', () => {
  const store = emptyStore();
  handleEvent(store, ev(f.joinOn('02:00:00:00:00:09', 10), T0));
  assert.strictEqual(handleEvent(store, ev(f.joinOn('02:00:00:00:00:09', 10), T0 + 1000)), null);
  assert.strictEqual(handleEvent(store, ev(f.joinOn('02:00:00:00:00:09', 30), T0 + 2000)).type, 'hop');
});

test('approved and ignored devices never alert', () => {
  const store = emptyStore();
  store.devices['02:00:00:00:00:01'] = { s: 'approved', f: T0, l: T0, n: 'vlan:10', a: null };
  store.devices['02:00:00:00:00:02'] = { s: 'ignored', f: T0, l: T0, n: 'vlan:20', a: null };
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0 + COOLDOWN_MS * 2)), null);
  assert.strictEqual(handleEvent(store, ev(f.joinOn('02:00:00:00:00:02', 99), T0 + 5)), null);
  assert.strictEqual(store.devices['02:00:00:00:00:01'].s, 'approved');
});

test('nothing in an event can approve a device', () => {
  const store = emptyStore();
  const line = f.cef('WiFi Client Connected', 'UNIFIclientMac=02:00:00:00:00:07 UNIFIclientAlias=approved UNIFInote=legit');
  handleEvent(store, ev(line, T0));
  assert.strictEqual(store.devices['02:00:00:00:00:07'].s, 'new');
});

test('a full list drops the oldest unapproved device first', () => {
  const store = emptyStore();
  for (let i = 0; i < MAX_DEVICES; i += 1) {
    const mac = `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    store.devices[mac] = { s: i === 0 ? 'new' : 'approved', f: T0, l: T0 + i, n: null, a: null };
  }
  assert.strictEqual(handleEvent(store, ev(f.joinOn('02:00:00:00:ff:ff', 1), T0)).type, 'new');
  assert.ok(!('02:00:00:00:00:00' in store.devices));
  assert.strictEqual(Object.keys(store.devices).length, MAX_DEVICES);
  // Now only approved devices remain besides the new one; fill the last unapproved slot.
  store.devices['02:00:00:00:ff:ff'].s = 'approved';
  assert.strictEqual(handleEvent(store, ev(f.joinOn('02:00:00:00:fe:fe', 1), T0)).type, 'full');
});

test('stored data is checked and old or broken data is not trusted', () => {
  assert.strictEqual(loadStore(null).problem, 'empty');
  assert.strictEqual(loadStore({ v: 99, devices: {} }).problem, 'unknown_version');
  const { store, problem } = loadStore({
    v: 1,
    devices: {
      '02:00:00:00:00:01': { s: 'approved', f: 1, l: 2, n: null, a: null },
      'not-a-mac': { s: 'approved', f: 1, l: 2, n: null, a: null },
      '02:00:00:00:00:02': { s: 'owner', f: 1, l: 2, n: null, a: null },
    },
  });
  assert.strictEqual(problem, 'dropped');
  assert.deepStrictEqual(Object.keys(store.devices), ['02:00:00:00:00:01']);
});

test('receiver caps size and rate and counts each outcome', () => {
  const rx = createReceiver();
  assert.strictEqual(handlePacket(rx, Buffer.alloc(20000), T0), null);
  assert.ok(handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0));
  handlePacket(rx, Buffer.from(f.ADMIN_LOGIN), T0);
  handlePacket(rx, Buffer.from(f.FORGED), T0);
  handlePacket(rx, Buffer.from('hello'), T0);
  for (let i = 0; i < MAX_PER_MINUTE; i += 1) handlePacket(rx, Buffer.from('x'), T0);
  assert.deepStrictEqual(rx.counters, {
    packets: 5 + MAX_PER_MINUTE, oversize: 1, rate: 4, unknown: MAX_PER_MINUTE - 4 + 1, bad: 1, skip: 1, events: 1,
  });
  assert.ok(handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0 + 60000), 'new minute, new budget');
});

test('alert tokens are always strings', () => {
  const store = emptyStore();
  const a = handleEvent(store, ev(f.cef('WiFi Client Connected', 'UNIFIclientMac=02:00:00:00:00:08'), T0));
  const t = tokensFor(a);
  for (const v of Object.values(t)) assert.strictEqual(typeof v, 'string');
  assert.deepStrictEqual(t, {
    type: 'new', severity: 'HIGH', mac: '02:00:00:00:00:08', ip: '-', network: '-', where: '-',
  });
});
