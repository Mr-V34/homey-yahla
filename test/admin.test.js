'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseText } = require('../lib/parsers');
const { handleEvent } = require('../lib/detector');
const { emptyStore } = require('../lib/registry');
const {
  defaultConfig, checkConfig, loadConfig, severityFor,
} = require('../lib/config');
const { applyDeviceAction, deviceList } = require('../lib/admin');
const { createGuard, remember, isTampered } = require('../lib/guard');
const { createReceiver, handlePacket } = require('../lib/receiver');
const f = require('./fixtures');

const T0 = 1700000000000;
const ev = (line, at) => parseText(line, at).event;

test('config accepts only clean, complete input', () => {
  const ok = checkConfig({ senders: ['192.168.1.1', '192.168.1.1'], severity: { 'vlan:10': 'NONE', 'name:Guest net': 'INFO' }, defaultSeverity: 'HIGH', logLevel: 'extended' });
  assert.deepStrictEqual(ok.senders, ['192.168.1.1']);
  assert.strictEqual(checkConfig({ senders: ['1.2.3.4', 'evil'], severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: ['fe80::1'], severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: [], severity: { 'vlan:10': 'LOUD' }, defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: [], severity: { '<b>': 'HIGH' }, defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: [], severity: {}, defaultSeverity: 'NONE', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: new Array(6).fill('1.2.3.4'), severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(checkConfig({ senders: [], severity: [], defaultSeverity: 'HIGH', logLevel: 'extended' }), null);
  assert.strictEqual(loadConfig({ v: 1, senders: 'x' }).problem, 'invalid');
  assert.strictEqual(severityFor(defaultConfig(), 'vlan:10'), 'HIGH');
});

test('a silent network records devices but never alerts', () => {
  const config = checkConfig({ senders: [], severity: { 'vlan:10': 'NONE' }, defaultSeverity: 'HIGH', logLevel: 'extended' });
  const store = emptyStore();
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0), config), null);
  assert.ok(store.devices['02:00:00:00:00:01']);
  const a = handleEvent(store, ev(f.WIRED_JOIN, T0), checkConfig({ senders: [], severity: { 'vlan:20': 'CRITICAL' }, defaultSeverity: 'HIGH', logLevel: 'extended' }));
  assert.strictEqual(a.severity, 'CRITICAL');
});

test('owner actions change state, bad input changes nothing', () => {
  const store = emptyStore();
  handleEvent(store, ev(f.WIFI_JOIN, T0));
  const before = JSON.stringify(store);
  assert.strictEqual(applyDeviceAction(store, 'nope', 'approve', T0), 'invalid');
  assert.strictEqual(applyDeviceAction(store, '02:00:00:00:00:01', 'own', T0), 'invalid');
  assert.strictEqual(applyDeviceAction(store, '02:00:00:00:00:99', 'approve', T0), 'unknown_device');
  assert.strictEqual(JSON.stringify(store), before);
  assert.strictEqual(applyDeviceAction(store, '02-00-00-00-00-01', 'approve', T0), 'ok');
  assert.strictEqual(store.devices['02:00:00:00:00:01'].s, 'approved');
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0 + 9e9)), null, 'approved: no alert');
  assert.strictEqual(applyDeviceAction(store, '02:00:00:00:00:01', 'unapprove', T0), 'ok');
  assert.strictEqual(applyDeviceAction(store, '02:00:00:00:00:01', 'forget', T0), 'ok');
  assert.strictEqual(handleEvent(store, ev(f.WIFI_JOIN, T0 + 1)).type, 'new', 'forgotten: new again');
  assert.strictEqual(deviceList(store)[0].mac, '02:00:00:00:00:01');
});

test('guard sees outside writes only', () => {
  const g = createGuard(['devices']);
  remember(g, 'devices', { v: 2, devices: {} });
  assert.ok(!isTampered(g, 'devices', { v: 2, devices: {} }));
  assert.ok(isTampered(g, 'devices', { v: 2, devices: { x: 1 } }));
  assert.ok(isTampered(g, 'devices', null));
  assert.ok(!isTampered(g, 'other', 1));
});

test('sender filter drops other senders and remembers who sent', () => {
  const config = checkConfig({ senders: ['192.168.1.1'], severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended' });
  const rx = createReceiver();
  assert.ok(handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0, '192.168.1.1', config));
  assert.strictEqual(handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0, '192.168.1.66', config), null);
  assert.strictEqual(rx.counters.foreign, 1);
  assert.deepStrictEqual([...rx.senders.keys()], ['192.168.1.1', '192.168.1.66']);
  assert.strictEqual(rx.senders.get('192.168.1.66').allowed, false);
  for (let i = 0; i < 20; i += 1) handlePacket(rx, Buffer.from('x'), T0, `10.0.0.${i}`, config);
  assert.strictEqual(rx.senders.size, 10, 'list of seen senders is capped');
  assert.ok(handlePacket(rx, Buffer.from(f.WIFI_JOIN), T0, '10.0.0.1', defaultConfig()), 'empty list accepts all');
});

test('config v1 is migrated to v2 with log level extended; bad log levels are refused', () => {
  const { config, problem } = loadConfig({ v: 1, senders: ['192.168.1.1'], severity: { 'vlan:11': 'CRITICAL' }, defaultSeverity: 'WARNING' });
  assert.strictEqual(problem, null);
  assert.deepStrictEqual(config, { v: 2, senders: ['192.168.1.1'], severity: { 'vlan:11': 'CRITICAL' }, defaultSeverity: 'WARNING', logLevel: 'extended' });
  assert.strictEqual(checkConfig({ senders: [], severity: {}, defaultSeverity: 'HIGH', logLevel: 'loud' }), null);
  assert.strictEqual(checkConfig({ senders: [], severity: {}, defaultSeverity: 'HIGH' }), null);
});

test('minimum gives the short text, other levels the full one with first seen', () => {
  const { notificationFor } = require('../lib/alerts');
  const store = emptyStore();
  const a = handleEvent(store, ev(f.WIFI_JOIN, T0));
  const fmt = (ms) => `t${ms}`;
  assert.strictEqual(notificationFor(a, 'minimum', fmt).key, 'alertShort.new');
  const full = notificationFor(a, 'extended', fmt);
  assert.strictEqual(full.key, 'alert.new');
  assert.strictEqual(full.tokens.first, `t${T0}`);
});
