'use strict';

// Tokens for the daily report text (see locales "report.text").
// Counts only; no addresses.

function reportTokens(date, day, counts, info) {
  const ago = info.lastPacket ? `${Math.round((info.now - info.lastPacket) / 60000)}` : info.never;
  return {
    date,
    listening: info.listening ? info.yes : info.no,
    packets: String(day.packets),
    accepted: String(day.accepted),
    foreign: String(day.foreign),
    dropped: String(day.dropped),
    events: String(day.events),
    named: String(day.named),
    newDevices: String(day.newDevices),
    alerts: String(day.alerts),
    suppressed: String(day.suppressed),
    unknown: String(day.unknown),
    forged: String(day.forged),
    alarms: String(day.alarms),
    fresh: String(counts.new),
    approved: String(counts.approved),
    ignored: String(counts.ignored),
    lastPacket: ago,
    pinSet: info.pinSet ? info.yes : info.no,
    sendersSet: info.sendersSet ? info.yes : info.no,
  };
}

module.exports = { reportTokens };
