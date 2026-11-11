'use strict';

// Known devices, kept small: no history, only what the rules need.
// Stored as one versioned object; older versions are migrated, unknown ones
// are not trusted (start empty and say so).
//
// device: { s: state, f: first seen, l: last seen, n: last network key, a: last alert,
//           i: last IP or null, w: last place (AP, switch port) or null,   (i, w added in v2)
//           h: name the device gave itself or null }                    (h added in v3)
//   state 'new'      seen, not approved by the owner
//         'approved' approved by the owner (only through the PIN-protected page)
//         'ignored'  owner chose to never alert on it

const VERSION = 3;
const MAX_DEVICES = 500;
const STATES = new Set(['new', 'approved', 'ignored']);

function emptyStore() {
  return { v: VERSION, devices: {} };
}

function validDevice(d) {
  return d && typeof d === 'object' && STATES.has(d.s)
    && Number.isFinite(d.f) && Number.isFinite(d.l)
    && (d.n === null || typeof d.n === 'string')
    && (d.a === null || Number.isFinite(d.a))
    && (d.i === null || (typeof d.i === 'string' && d.i.length <= 45))
    && (d.w === null || (typeof d.w === 'string' && d.w.length <= 48))
    && (d.h === null || (typeof d.h === 'string' && d.h.length <= 48));
}

// v1 had no i/w, v2 had no h. Missing fields become null; the result is
// then checked as the current version.
function migrate(raw) {
  if ((raw.v === 1 || raw.v === 2) && raw.devices && typeof raw.devices === 'object') {
    const devices = {};
    for (const [mac, d] of Object.entries(raw.devices)) {
      if (!d || typeof d !== 'object') { devices[mac] = d; continue; }
      devices[mac] = raw.v === 1 ? { ...d, i: null, w: null, h: null } : { ...d, h: null };
    }
    return { v: VERSION, devices };
  }
  return raw;
}

// Returns { store, problem } where problem is null, 'empty', 'unknown_version' or 'dropped'.
function loadStore(input) {
  if (input === null || input === undefined) return { store: emptyStore(), problem: 'empty' };
  const raw = typeof input === 'object' ? migrate(input) : input;
  if (typeof raw !== 'object' || raw.v !== VERSION || typeof raw.devices !== 'object' || !raw.devices) {
    return { store: emptyStore(), problem: 'unknown_version' };
  }
  const devices = {};
  let dropped = false;
  for (const [mac, d] of Object.entries(raw.devices)) {
    if (/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(mac) && validDevice(d)) devices[mac] = { ...d };
    else dropped = true;
  }
  return { store: { v: VERSION, devices }, problem: dropped ? 'dropped' : null };
}

// Room for a new device: drop the oldest unapproved one if full.
// Returns false when full of approved/ignored devices (caller must alarm).
function makeRoom(store) {
  const macs = Object.keys(store.devices);
  if (macs.length < MAX_DEVICES) return true;
  let oldest = null;
  for (const mac of macs) {
    const d = store.devices[mac];
    if (d.s === 'new' && (!oldest || d.l < store.devices[oldest].l)) oldest = mac;
  }
  if (!oldest) return false;
  delete store.devices[oldest];
  return true;
}

function networkKey(event) {
  if (event.vlan !== null && event.vlan !== undefined) return `vlan:${event.vlan}`;
  if (event.network) return `name:${event.network}`;
  return null;
}

module.exports = {
  VERSION, MAX_DEVICES, emptyStore, loadStore, makeRoom, networkKey,
};
