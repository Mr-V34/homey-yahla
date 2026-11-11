'use strict';

// Router syslog shapes other than UniFi (ASUS, OpenWrt). Lines are shaped like
// public forum samples; addresses are made up (02:... MACs, example IPs).

const test = require('node:test');
const assert = require('node:assert');
const { parseText } = require('../lib/parsers');

const AT = 1700000000000;
const ACK = '<30>Nov 11 12:00:02 dnsmasq-dhcp[392]: DHCPACK(br0) 192.168.1.51 02:00:00:00:02:01 test-laptop';
const ASSOC = '<14>Nov 11 12:00:01 syslog: wlceventd_proc_event(556): eth2: Assoc 02:00:00:00:02:01, status: Successful (0), rssi:0';
const AUTH = '<14>Nov 11 12:00:01 syslog: wlceventd_proc_event(527): eth2: Auth 02:00:00:00:02:01, status: Successful (0), rssi:0';
const DEAUTH = '<14>Nov 11 12:30:00 syslog: wlceventd_proc_event(508): eth2: Deauth_ind 02:00:00:00:02:01, status: 0, reason: Deauthenticated because sending station is leaving (or has left) IBSS or ESS (3), rssi:0';
const STA_ON = 'Sat Dec  4 14:32:17 2021 daemon.notice hostapd: wlan1: AP-STA-CONNECTED 02:00:00:00:03:01';
const STA_OFF = '<29>Nov 11 12:30:00 hostapd: wlan1: AP-STA-DISCONNECTED 02:00:00:00:03:01';

test('dnsmasq DHCPACK is a join with IP, interface as network, and name', () => {
  assert.deepStrictEqual(parseText(ACK, AT), {
    result: 'event',
    event: {
      mac: '02:00:00:00:02:01', ip: '192.168.1.51', network: 'br0', vlan: null,
      where: null, name: 'test-laptop', kind: 'join', at: AT, source: 'dnsmasq-dhcp',
    },
  });
});

test('DHCPACK without a hostname still joins, name null', () => {
  const e = parseText('dnsmasq-dhcp: DHCPACK(br-lan) 192.168.1.52 02:00:00:00:03:01', AT).event;
  assert.strictEqual(e.name, null);
  assert.strictEqual(e.network, 'br-lan');
});

test('other dnsmasq-dhcp lines are skipped, not unknown', () => {
  assert.strictEqual(parseText('dnsmasq-dhcp[392]: DHCPDISCOVER(br0) 02:00:00:00:02:01', AT).result, 'skip');
  assert.strictEqual(parseText('dnsmasq-dhcp[392]: DHCPOFFER(br0) 192.168.1.58 02:00:00:00:02:01', AT).result, 'skip');
});

test('ASUS Assoc Successful is a join on the radio; Auth is skipped', () => {
  const e = parseText(ASSOC, AT).event;
  assert.strictEqual(e.kind, 'join');
  assert.strictEqual(e.where, 'eth2');
  assert.strictEqual(e.ip, null);
  assert.strictEqual(e.source, 'wifi-ap');
  assert.strictEqual(parseText(AUTH, AT).result, 'skip');
});

test('ASUS failed Assoc is skipped, Deauth_ind is a leave', () => {
  const failed = ASSOC.replace('Successful (0)', 'Unspecified failure (1)');
  assert.strictEqual(parseText(failed, AT).result, 'skip');
  assert.strictEqual(parseText(DEAUTH, AT).event.kind, 'leave');
});

test('hostapd connected and disconnected', () => {
  assert.strictEqual(parseText(STA_ON, AT).event.kind, 'join');
  assert.strictEqual(parseText(STA_OFF, AT).event.kind, 'leave');
  assert.strictEqual(parseText(`${STA_ON} auth_alg=open`, AT).event.kind, 'join');
  assert.strictEqual(parseText('hostapd: wlan1: STA 02:00:00:00:03:01 IEEE 802.11: associated', AT).result, 'skip');
});

test('a hostname cannot smuggle a second line or another format', () => {
  // Extra text after the hostname breaks the end anchor.
  assert.strictEqual(parseText(`${ACK} AP-STA-CONNECTED 02:00:00:00:09:09`, AT).result, 'skip');
  // A CEF-looking hostname stays a DHCP event for the real MAC.
  const long = 'dnsmasq-dhcp[1]: DHCPACK(br0) 192.168.1.60 02:00:00:00:02:02 CEF:0|Ubiquiti|UniFi|1|400|WiFi_Client_Connected|2|UNIFIclientMac=02:00:00:00:09:09';
  assert.strictEqual(parseText(long, AT).result, 'skip');
  const sneaky = 'dnsmasq-dhcp[1]: DHCPACK(br0) 192.168.1.60 02:00:00:00:02:02 CEF:0|U|U|1|4|Connected|2|UNIFIclientMac=02:00:00:00:09:09';
  const e = parseText(sneaky, AT).event;
  assert.strictEqual(e.source, 'dnsmasq-dhcp');
  assert.strictEqual(e.mac, '02:00:00:00:02:02');
  assert.ok(!/[|=]/.test(e.name));
});

test('bad MAC shapes are not events', () => {
  assert.strictEqual(parseText('dnsmasq-dhcp: DHCPACK(br0) 192.168.1.5 02:00:00:00:02', AT).result, 'skip');
  assert.strictEqual(parseText('hostapd: wlan1: AP-STA-CONNECTED zz:00:00:00:03:01', AT).result, 'skip');
});

test('plain router noise is still unknown', () => {
  assert.strictEqual(parseText('<14>Nov 11 12:00:00 kernel: br0: port 2 entered forwarding state', AT).result, 'unknown');
});
