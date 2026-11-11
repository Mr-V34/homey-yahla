'use strict';

const { normalizeMac } = require('./event');

// Owner actions on the device list. Only called after a correct PIN.
//   approve    -> 'approved' (never alerts)
//   ignore     -> 'ignored'  (never alerts)
//   unapprove  -> 'new'      (alerts again, from the next cooldown)
//   forget     -> removed    (alerts as new when seen again)

const ACTIONS = new Set(['approve', 'ignore', 'unapprove', 'forget']);

// Returns a code: 'ok', 'invalid' or 'unknown_device'. Changes store only on 'ok'.
function applyDeviceAction(store, macInput, action, now) {
  const mac = normalizeMac(macInput);
  if (!mac || !ACTIONS.has(action)) return 'invalid';
  const device = store.devices[mac];
  if (!device) return 'unknown_device';
  if (action === 'forget') delete store.devices[mac];
  else if (action === 'approve') { device.s = 'approved'; device.a = null; }
  else if (action === 'ignore') { device.s = 'ignored'; device.a = null; }
  else { device.s = 'new'; device.a = now; }
  return 'ok';
}

// Device list for the page, newest first. Plain data only.
function deviceList(store) {
  return Object.entries(store.devices)
    .map(([mac, d]) => ({
      mac, state: d.s, firstSeen: d.f, lastSeen: d.l, network: d.n, ip: d.i, where: d.w,
    }))
    .sort((a, b) => b.lastSeen - a.lastSeen);
}

module.exports = { ACTIONS, applyDeviceAction, deviceList };
