'use strict';

const { makeRoom, networkKey } = require('./registry');

// The rules. Pure: takes the store and one event, changes the store, and
// returns the alert to send (or null). Approval never comes from an event.
//
// Alert types:
//   'new'         never seen before
//   'unapproved'  seen before, still not approved (at most once per cooldown)
//   'hop'         unapproved device on another network than last time (always)
//   'full'        device list full of approved/ignored devices (system alarm)

const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SEVERITY = 'HIGH';

function handleEvent(store, event) {
  const now = event.at;
  const key = networkKey(event);
  let device = store.devices[event.mac];

  if (!device) {
    if (!makeRoom(store)) return { type: 'full', severity: 'CRITICAL', event };
    device = {
      s: 'new', f: now, l: now, n: key, a: now,
    };
    store.devices[event.mac] = device;
    // A device that is first seen leaving is still new (as in YALA).
    return { type: 'new', severity: DEFAULT_SEVERITY, event };
  }

  const previous = device.n;
  device.l = now;
  if (key) device.n = key;
  if (device.s !== 'new' || event.kind !== 'join') return null;

  const hopped = key !== null && previous !== null && key !== previous;
  const cooled = device.a === null || now - device.a >= COOLDOWN_MS;
  if (!hopped && !cooled) return null;
  device.a = now;
  return { type: hopped ? 'hop' : 'unapproved', severity: DEFAULT_SEVERITY, event };
}

module.exports = { COOLDOWN_MS, handleEvent };
