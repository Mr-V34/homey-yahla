'use strict';

const { severityFor } = require('./config');
const { networkKey } = require('./registry');

// Holds back a device alert that came from a Wi-Fi line (no IP, no name), so
// the DHCP line that usually follows a second later can fill them in. Then
// the alert says as much as a UniFi one. If no such line comes within HOLD_MS,
// the alert goes out as it is. Held alerts live in memory only.

const HOLD_MS = 10 * 1000;
const MAX_HELD = 50;
const HOLD_SOURCES = new Set(['wifi-ap']);

function createHold() {
  return new Map(); // mac -> { alert, due }
}

// True when the alert is held (the caller sends nothing now).
function holdAlert(held, alert, now) {
  if (!HOLD_SOURCES.has(alert.event.source)) return false;
  if (held.has(alert.event.mac)) return true; // one alert per device is enough
  if (held.size >= MAX_HELD) return false;
  held.set(alert.event.mac, { alert, due: now + HOLD_MS });
  return true;
}

// A later event for a held device. When it has an IP, its fields fill the held
// alert, the severity follows the network it names, and the alert is returned
// to be sent now. Returns null when nothing is to be sent (yet), and also when
// the owner silenced that network ('NONE').
function fillHeld(held, event, config) {
  const entry = held.get(event.mac);
  if (!entry || !event.ip) return null;
  held.delete(event.mac);
  const old = entry.alert.event;
  const merged = {
    ...old,
    ip: event.ip,
    name: event.name || old.name,
    network: event.network || old.network,
    vlan: event.vlan ?? old.vlan,
    where: old.where || event.where,
  };
  const severity = severityFor(config, networkKey(merged));
  if (severity === 'NONE') return null;
  return { ...entry.alert, severity, event: merged };
}

// Alerts whose wait is over, oldest first; they leave the hold.
function takeDue(held, now) {
  const out = [];
  for (const [mac, entry] of held) {
    if (entry.due <= now) {
      out.push(entry.alert);
      held.delete(mac);
    }
  }
  return out;
}

// When the next held alert is due (ms), or Infinity when none is held.
function nextDue(held) {
  let next = Infinity;
  for (const entry of held.values()) next = Math.min(next, entry.due);
  return next;
}

module.exports = {
  HOLD_MS, MAX_HELD, createHold, holdAlert, fillHeld, takeDue, nextDue,
};
