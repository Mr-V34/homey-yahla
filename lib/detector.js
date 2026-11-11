'use strict';

const { makeRoom, networkKey } = require('./registry');
const { defaultConfig, severityFor } = require('./config');

// The rules. Pure: takes the store and one event, changes the store, and
// returns the alert to send (or null). Approval never comes from an event.
//
// Alert types:
//   'new'         never seen before
//   'unapproved'  seen before, still not approved (at most once per cooldown)
//   'hop'         unapproved device on another network than last time (always)
//   'full'        device list full of approved/ignored devices (system alarm)

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Severity comes from the owner's setting for the network; 'NONE' means a
// silent network: the device is recorded but never alerted.
function handleEvent(store, event, config = defaultConfig()) {
  const now = event.at;
  const key = networkKey(event);
  const severity = severityFor(config, key);
  let device = store.devices[event.mac];

  if (!device) {
    if (!makeRoom(store)) return { type: 'full', severity: 'CRITICAL', event };
    device = {
      s: 'new', f: now, l: now, n: key, a: now, i: event.ip, w: event.where,
    };
    store.devices[event.mac] = device;
    // A device that is first seen leaving is still new (as in YALA).
    return severity === 'NONE' ? null : { type: 'new', severity, event };
  }

  const previous = device.n;
  device.l = now;
  if (key) device.n = key;
  if (event.ip) device.i = event.ip;
  if (event.where) device.w = event.where;
  if (device.s !== 'new' || event.kind !== 'join') return null;

  const hopped = key !== null && previous !== null && key !== previous;
  const cooled = device.a === null || now - device.a >= COOLDOWN_MS;
  if (!hopped && !cooled) return null;
  if (severity === 'NONE') return null;
  device.a = now;
  return { type: hopped ? 'hop' : 'unapproved', severity, event };
}

module.exports = { COOLDOWN_MS, handleEvent };
