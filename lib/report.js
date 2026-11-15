'use strict';

// The daily report text. Counts only; never an address or a name.
//
// mode  'short' (one line: the heartbeat) or 'full' (devices, alerts, problems)
// d     { listening, silent, lastPacket, since, accepted, newDevices, events, unknown,
//         alerts, suppressed, alarms, foreign, fresh, approved, ignored }
//       lastPacket and since are already formatted local times (lastPacket may be null).
// tr    (key, tokens) -> text. Every token value is passed as a string.

// The first line names the cause: the port on the Homey, no logs, logs YAHLA
// cannot read, or all well.
function firstLine(d, tr) {
  if (!d.listening) return tr('report.noSocket');
  if (d.silent || d.lastPacket === null) return tr('report.problem', { last: d.lastPacket ?? tr('report.never') });
  if (d.events === 0 && d.unknown > 0) {
    return tr('report.unreadable', { since: String(d.since), packets: String(d.accepted), unknown: String(d.unknown) });
  }
  return tr('report.ok', { since: String(d.since), packets: String(d.accepted), newDevices: String(d.newDevices) });
}

function reportText(mode, d, tr) {
  const first = firstLine(d, tr);
  if (mode === 'short') return first;
  const lines = [
    first,
    tr('report.devices', { fresh: String(d.fresh), approved: String(d.approved), ignored: String(d.ignored) }),
    tr('report.alerts', { alerts: String(d.alerts) }),
  ];
  // Problem lines only when there is something to say.
  if (d.suppressed > 0) lines.push(tr('report.suppressed', { suppressed: String(d.suppressed) }));
  if (d.alarms > 0) lines.push(tr('report.alarms', { alarms: String(d.alarms) }));
  if (d.foreign > 0) lines.push(tr('report.foreign', { foreign: String(d.foreign) }));
  return lines.join('\n');
}

module.exports = { reportText };
