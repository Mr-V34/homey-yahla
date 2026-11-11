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
  };
}

// Locale key and tokens for the timeline notification.
function notificationFor(alert) {
  return { key: `alert.${alert.type}`, tokens: tokensFor(alert) };
}

module.exports = { tokensFor, notificationFor };
