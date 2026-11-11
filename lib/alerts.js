'use strict';

// Builds what an alert shows: Flow tokens and the notification text.
// All event fields were already validated or reduced to plain labels.

function tokensFor(alert) {
  const e = alert.event;
  return {
    type: alert.type,
    severity: alert.severity,
    mac: e.mac,
    ip: e.ip || '-',
    network: e.network || (e.vlan !== null && e.vlan !== undefined ? `VLAN ${e.vlan}` : '-'),
    where: e.where || '-',
    name: e.name || '-',
  };
}

// Locale key and tokens for the timeline notification. 'minimum' gives the
// short text (MAC and name); other levels the full one with first-seen time.
// formatTime turns ms into local text; it is passed in to keep this file pure.
function notificationFor(alert, logLevel, formatTime) {
  const tokens = { ...tokensFor(alert), first: formatTime(alert.first) };
  if (alert.type === 'full') return { key: 'alert.full', tokens };
  return { key: logLevel === 'minimum' ? `alertShort.${alert.type}` : `alert.${alert.type}`, tokens };
}

module.exports = { tokensFor, notificationFor };
