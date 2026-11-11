'use strict';

const { normalizeMac, safeLabel } = require('../event');

// Wi-Fi join and leave from the access point itself. Two shapes:
//   hostapd (OpenWrt and others):
//     hostapd: wlan1: AP-STA-CONNECTED 02:00:00:00:00:01
//     hostapd: wlan1: AP-STA-DISCONNECTED 02:00:00:00:00:01
//   ASUS stock firmware (wlceventd):
//     wlceventd_proc_event(556): eth2: Assoc 02:00:00:00:00:01, status: Successful (0), rssi:0
//     wlceventd_proc_event(508): eth2: Deauth_ind 02:00:00:00:00:01, status: 0, reason: ...
// These lines hold no IP and no name; the DHCP line usually follows.
// The radio interface (wlan1, eth2) is kept as the place.

const ID = 'wifi-ap';
const HOSTAPD_TAG = /\bhostapd(?:\[\d{1,7}\])?: /;
const HOSTAPD_RE = /\bhostapd(?:\[\d{1,7}\])?: ([A-Za-z0-9_.-]{1,16}): AP-STA-(CONNECTED|DISCONNECTED) ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})(?: [A-Za-z_]{1,24}=[^\s]{0,64}){0,8}\s*$/;
const WLC_TAG = /\bwlceventd_proc_event\(\d{1,6}\): /;
const WLC_RE = /\bwlceventd_proc_event\(\d{1,6}\): ([A-Za-z0-9_.-]{1,16}): ([A-Za-z_]{1,20}) ([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}), status: ([^,]{1,40})(?:, .{0,200})?$/;

const WLC_JOIN = new Set(['Assoc', 'ReAssoc']);
const WLC_LEAVE = new Set(['Disassoc', 'Disassoc_ind', 'Deauth', 'Deauth_ind']);

function event(mac, iface, kind, at) {
  return {
    result: 'event',
    event: {
      mac, ip: null, network: null, vlan: null, where: safeLabel(iface, 32), name: null, kind, at, source: ID,
    },
  };
}

function parseHostapd(text, at) {
  const m = HOSTAPD_RE.exec(text);
  if (!m) return { result: 'skip' };
  const mac = normalizeMac(m[3]);
  if (!mac) return { result: 'bad', reason: 'nomac' };
  return event(mac, m[1], m[2] === 'CONNECTED' ? 'join' : 'leave', at);
}

function parseWlc(text, at) {
  const m = WLC_RE.exec(text);
  if (!m) return { result: 'skip' };
  const [, iface, what, rawMac, status] = m;
  let kind = null;
  if (WLC_JOIN.has(what) && status.startsWith('Successful')) kind = 'join';
  else if (WLC_LEAVE.has(what)) kind = 'leave';
  if (!kind) return { result: 'skip' }; // Auth, failed Assoc and the rest
  const mac = normalizeMac(rawMac);
  if (!mac) return { result: 'bad', reason: 'nomac' };
  return event(mac, iface, kind, at);
}

function parse(text, at) {
  if (HOSTAPD_TAG.test(text)) return parseHostapd(text, at);
  if (WLC_TAG.test(text)) return parseWlc(text, at);
  return null;
}

module.exports = { ID, parse };
