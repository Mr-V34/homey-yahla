'use strict';

// The neutral event that every parser produces, and the checks on its fields.
// Everything here comes from the network and is treated as hostile.
//
// Event: { mac, ip, network, vlan, where, name, kind, at, source }
//   mac      'aa:bb:cc:dd:ee:ff' (always valid, lower case)
//   ip       IPv4/IPv6 string or null
//   network  short plain label or null
//   vlan     0-4094 or null
//   where    short plain label (access point, switch port) or null
//   name     what the device calls itself (alias or hostname), plain label or null.
//            Chosen by the device, so it can lie: shown only, never used to decide.
//   kind     'join' or 'leave'
//   at       ms since epoch (time of receipt, not the sender's clock)
//   source   parser id, e.g. 'unifi-cef'

const MAC_RE = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/;
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6_RE = /^[0-9a-f:]{2,39}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');
const UNSAFE_LABEL_RE = /[^\p{L}\p{N} ._\-]/gu;

function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const mac = value.trim().toLowerCase().replace(/-/g, ':');
  return MAC_RE.test(mac) ? mac : null;
}

function validIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  if (IPV4_RE.test(ip)) return ip;
  if (ip.includes(':') && IPV6_RE.test(ip)) return ip.toLowerCase();
  return null;
}

function boundedInt(value, low, high) {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= low && n <= high ? n : null;
}

// Client-chosen text (names, SSIDs) becomes a short plain label, so an alert
// can never carry markup, a link or control characters.
function safeLabel(value, limit = 48) {
  if (typeof value !== 'string') return null;
  const text = value.slice(0, limit * 2).replace(CONTROL_RE, '').replace(UNSAFE_LABEL_RE, '?')
    .trim().slice(0, limit).trim();
  return text || null;
}

module.exports = {
  normalizeMac, validIp, boundedInt, safeLabel,
};
