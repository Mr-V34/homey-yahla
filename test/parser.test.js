'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseText } = require('../lib/parsers');
const { safeLabel, normalizeMac, validIp } = require('../lib/event');
const f = require('./fixtures');

const AT = 1700000000000;

test('Wi-Fi join becomes a neutral join event', () => {
  const out = parseText(f.WIFI_JOIN, AT);
  assert.strictEqual(out.result, 'event');
  assert.deepStrictEqual(out.event, {
    mac: '02:00:00:00:00:01', ip: '192.168.1.50', network: 'Home', vlan: 10,
    where: 'Hall AP', name: null, kind: 'join', at: AT, source: 'unifi-cef',
  });
});

test('Wi-Fi leave is a leave, not a join', () => {
  assert.strictEqual(parseText(f.WIFI_LEAVE, AT).event.kind, 'leave');
});

test('wired join keeps switch and port', () => {
  const e = parseText(f.WIRED_JOIN, AT).event;
  assert.strictEqual(e.where, 'Office Switch port 4');
  assert.strictEqual(e.vlan, 20);
});

test('non-client CEF is skipped, plain text is unknown', () => {
  assert.strictEqual(parseText(f.ADMIN_LOGIN, AT).result, 'skip');
  assert.strictEqual(parseText('<14>Jan  1 12:00:00 host kernel: hello', AT).result, 'unknown');
  assert.strictEqual(parseText('', AT).result, 'unknown');
});

test('repeated identity keys make the event untrusted', () => {
  assert.deepStrictEqual(parseText(f.FORGED, AT), { result: 'bad', reason: 'repeated' });
});

test('client event without a usable MAC is bad', () => {
  assert.deepStrictEqual(parseText(f.NO_MAC, AT), { result: 'bad', reason: 'nomac' });
});

test('hostile labels lose markup and control characters', () => {
  assert.strictEqual(safeLabel('**Free** <a href=x>wifi</a>\u0007'), '??Free?? ?a href?x?wifi??a?');
  assert.strictEqual(safeLabel('Café 5G_x-1.2'), 'Café 5G_x-1.2');
  assert.strictEqual(safeLabel('‮evil'), 'evil');
  assert.strictEqual(safeLabel('a'.repeat(500)).length, 48);
  assert.strictEqual(safeLabel(''), null);
  assert.strictEqual(safeLabel(42), null);
});

test('MAC and IP checks are strict', () => {
  assert.strictEqual(normalizeMac('02-00-00-00-00-0A'), '02:00:00:00:00:0a');
  assert.strictEqual(normalizeMac('02:00:00:00:00'), null);
  assert.strictEqual(normalizeMac('02:00:00:00:00:01 x'), null);
  assert.strictEqual(validIp('192.168.1.50'), '192.168.1.50');
  assert.strictEqual(validIp('192.168.1.256'), null);
  assert.strictEqual(validIp('fe80::1'), 'fe80::1');
  assert.strictEqual(validIp('1.2.3.4; rm'), null);
});

test('a label in a CEF field cannot inject markup into the event', () => {
  const line = f.cef('WiFi Client Connected',
    'UNIFIclientMac=02:00:00:00:00:05 UNIFInetworkName=**Admin** UNIFIconnectedToDeviceName=[link](x)');
  const e = parseText(line, AT).event;
  assert.strictEqual(e.network, '??Admin??');
  assert.strictEqual(e.where, '?link??x?');
});

test('huge and odd input does not throw', () => {
  const junk = `CEF:0|${'|'.repeat(5)}${'k=v '.repeat(5000)}`;
  assert.doesNotThrow(() => parseText(junk, AT));
  assert.doesNotThrow(() => parseText('CEF:' + '\\|'.repeat(4000), AT));
  assert.doesNotThrow(() => parseText('\u0000￿'.repeat(1000), AT));
});

test('device name: alias first, else hostname, always a plain label', () => {
  const both = f.cef('WiFi Client Connected', 'UNIFIclientMac=02:00:00:00:00:0d UNIFIclientHostname=phone-1 UNIFIclientAlias=Kitchen tablet');
  assert.strictEqual(parseText(both, AT).event.name, 'Kitchen tablet');
  const host = f.cef('WiFi Client Connected', 'UNIFIclientMac=02:00:00:00:00:0d UNIFIclientHostname=<b>evil</b>');
  assert.strictEqual(parseText(host, AT).event.name, '?b?evil??b?');
  assert.strictEqual(parseText(f.WIFI_JOIN, AT).event.name, null);
});

test('a long name is cut to 48 characters with no space at the end', () => {
  const long = f.cef('WiFi Client Connected', 'UNIFIclientMac=02:00:00:00:00:0f UNIFIclientHostname=Example-Personal-Weather-Station-With-A-Long Name Here');
  const name = parseText(long, AT).event.name;
  assert.ok(name.length <= 48);
  assert.strictEqual(name, name.trim());
  assert.strictEqual(safeLabel('abc ' + 'd'.repeat(10), 4), 'abc');
});
