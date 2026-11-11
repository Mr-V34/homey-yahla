'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseText } = require('../lib/parsers');
const { handleEvent } = require('../lib/detector');
const { emptyStore } = require('../lib/registry');
const { defaultConfig } = require('../lib/config');
const hold = require('../lib/hold');

const T = 1700000000000;
const ASSOC = 'wlceventd_proc_event(556): eth2: Assoc 02:00:00:00:02:01, status: Successful (0), rssi:0';
const ACK = 'dnsmasq-dhcp[392]: DHCPACK(br0) 192.168.1.51 02:00:00:00:02:01 test-laptop';
const UNIFI = '<14>Jan  1 12:00:00 gw CEF:0|Ubiquiti|UniFi Network|10.0.0|400|WiFi Client Connected|2|'
  + 'UNIFIclientMac=02:00:00:00:01:01 UNIFIclientIp=192.168.1.50 UNIFInetworkVlan=10';

function alertFor(store, line, at, config = defaultConfig()) {
  return handleEvent(store, parseText(line, at).event, config);
}

test('a Wi-Fi alert waits, and the DHCP line fills in IP, name and network', () => {
  const held = hold.createHold();
  const store = emptyStore();
  const first = alertFor(store, ASSOC, T);
  assert.strictEqual(first.type, 'new');
  assert.strictEqual(hold.holdAlert(held, first, T), true);
  assert.strictEqual(hold.nextDue(held), T + hold.HOLD_MS);

  const ack = parseText(ACK, T + 1000).event;
  assert.strictEqual(handleEvent(store, ack, defaultConfig()), null); // no second alert
  const out = hold.fillHeld(held, ack, defaultConfig());
  assert.strictEqual(out.type, 'new');
  assert.strictEqual(out.event.ip, '192.168.1.51');
  assert.strictEqual(out.event.name, 'test-laptop');
  assert.strictEqual(out.event.network, 'br0');
  assert.strictEqual(out.event.where, 'eth2');
  assert.strictEqual(held.size, 0);
});

test('severity follows the network named by the DHCP line', () => {
  const config = { ...defaultConfig(), severity: { 'name:br-iot': 'CRITICAL' } };
  const held = hold.createHold();
  hold.holdAlert(held, alertFor(emptyStore(), ASSOC, T, config), T);
  const ack = parseText(ACK.replace('br0', 'br-iot'), T + 500).event;
  assert.strictEqual(hold.fillHeld(held, ack, config).severity, 'CRITICAL');
});

test('a silenced network drops the held alert', () => {
  const config = { ...defaultConfig(), severity: { 'name:br0': 'NONE' } };
  const held = hold.createHold();
  hold.holdAlert(held, alertFor(emptyStore(), ASSOC, T, config), T);
  assert.strictEqual(hold.fillHeld(held, parseText(ACK, T + 500).event, config), null);
  assert.strictEqual(held.size, 0);
});

test('without a DHCP line the alert goes out as it is after the wait', () => {
  const held = hold.createHold();
  hold.holdAlert(held, alertFor(emptyStore(), ASSOC, T), T);
  assert.deepStrictEqual(hold.takeDue(held, T + hold.HOLD_MS - 1), []);
  const due = hold.takeDue(held, T + hold.HOLD_MS);
  assert.strictEqual(due.length, 1);
  assert.strictEqual(due[0].event.ip, null);
  assert.strictEqual(held.size, 0);
});

test('UniFi alerts are never held; a full hold sends at once', () => {
  const held = hold.createHold();
  assert.strictEqual(hold.holdAlert(held, alertFor(emptyStore(), UNIFI, T), T), false);
  const store = emptyStore();
  for (let i = 0; i < hold.MAX_HELD; i += 1) {
    const mac = `02:00:00:00:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 255).toString(16).padStart(2, '0')}`;
    assert.strictEqual(hold.holdAlert(held, alertFor(store, ASSOC.replace('02:00:00:00:02:01', mac), T), T), true);
  }
  assert.strictEqual(hold.holdAlert(held, alertFor(store, ASSOC.replace('02:01,', 'ff:ff,'), T), T), false);
});

test('a later Wi-Fi line without IP keeps the alert waiting', () => {
  const held = hold.createHold();
  const store = emptyStore();
  hold.holdAlert(held, alertFor(store, ASSOC, T), T);
  assert.strictEqual(hold.fillHeld(held, parseText(ASSOC, T + 200).event, defaultConfig()), null);
  assert.strictEqual(held.size, 1);
});
