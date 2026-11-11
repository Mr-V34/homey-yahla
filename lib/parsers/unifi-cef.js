'use strict';

const {
  normalizeMac, validIp, boundedInt, safeLabel,
} = require('../event');

// UniFi Network client events in CEF, as sent by the "Activity Logging (SIEM
// server)" export. Parsed by event name and keys, never by event ID, since the
// IDs differ between Network versions.
//
// parse(text, at) returns one of:
//   null                          not a CEF line (another parser may try)
//   { result: 'skip' }            CEF, but not a client event
//   { result: 'bad', reason }     client event that cannot be trusted or read
//   { result: 'event', event }    a neutral event

const ID = 'unifi-cef';
const HEADER_SPLIT = /(?<!\\)\|/;
const KEY_RE = /(?:^|(?<=\s))([A-Za-z][A-Za-z0-9_.]*)=/g;
const MAX_FIELDS = 80;

// A client can put "UNIFIclientMac=..." in its own hostname. If one of these
// keys appears twice, the event cannot be trusted.
const TRUSTED_KEYS = new Set([
  'UNIFIclientMac', 'UNIFIclientIp', 'UNIFInetworkVlan', 'UNIFInetworkName',
  'UNIFIconnectedToDeviceMac', 'UNIFIconnectedToDevicePort',
  'UNIFIlastConnectedToDeviceMac', 'UNIFIlastConnectedToDevicePort',
]);

function splitHeader(text) {
  const start = text.indexOf('CEF:');
  if (start < 0) return null;
  // Split into at most 8 parts: 7 header fields and the extension.
  const parts = [];
  let rest = text.slice(start);
  for (let i = 0; i < 7; i += 1) {
    const m = HEADER_SPLIT.exec(rest);
    if (!m) return null;
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + 1);
  }
  parts.push(rest);
  return parts;
}

function parseExtension(extension) {
  const fields = Object.create(null);
  const repeated = new Set();
  const matches = [...extension.matchAll(KEY_RE)].slice(0, MAX_FIELDS);
  matches.forEach((m, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : extension.length;
    const value = extension.slice(m.index + m[0].length, end).trim()
      .replace(/\\=/g, '=').replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
    const key = m[1];
    if (key in fields) repeated.add(key);
    else fields[key] = value;
  });
  return { fields, repeated };
}

function parse(text, at) {
  const parts = splitHeader(text);
  if (!parts) return null;
  const name = parts[5];
  const { fields, repeated } = parseExtension(parts[7]);
  const lowered = name.toLowerCase();
  const isClient = lowered.includes('client') || 'UNIFIclientMac' in fields;
  if (!isClient) return { result: 'skip' };

  for (const key of repeated) {
    if (TRUSTED_KEYS.has(key)) return { result: 'bad', reason: 'repeated' };
  }
  const mac = normalizeMac(fields.UNIFIclientMac);
  if (!mac) return { result: 'bad', reason: 'nomac' };

  const join = lowered.includes('connected') && !lowered.includes('disconnected');
  const leave = lowered.includes('disconnected');
  if (!join && !leave) return { result: 'skip' };

  const port = boundedInt(fields.UNIFIconnectedToDevicePort ?? fields.UNIFIlastConnectedToDevicePort, 0, 65535);
  const place = safeLabel(fields.UNIFIconnectedToDeviceName ?? fields.UNIFIlastConnectedToDeviceName, 32);
  let where = place;
  if (where && port !== null) where = `${where} port ${port}`;

  return {
    result: 'event',
    event: {
      mac,
      ip: validIp(fields.UNIFIclientIp ?? fields.UNIFIclientIP),
      network: safeLabel(fields.UNIFInetworkName, 32),
      vlan: boundedInt(fields.UNIFInetworkVlan, 0, 4094),
      where,
      kind: join ? 'join' : 'leave',
      at,
      source: ID,
    },
  };
}

module.exports = { ID, parse };
