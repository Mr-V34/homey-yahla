'use strict';

// Fail loud. Watches the stream itself, so that a silent or abused monitor
// never looks like a quiet network. Pure: takes times, returns alarms.
//
// Alarm: { kind, severity, data }
//   silence    no accepted packet for SILENCE_MS (once per silent period)
//   resumed    packets again after a silence
//   flood      FLOOD_NEW new devices or FLOOD_EVENTS client events in FLOOD_WINDOW_MS,
//              or the device-alert cap was hit (at most once per SYSTEM_COOLDOWN_MS)
//   unknown    a packet in no known format (at most once per SYSTEM_COOLDOWN_MS)
//   forged     a client event with repeated identity fields or no usable MAC (same limit)
// Device alerts are capped at ALERT_CAP per ALERT_WINDOW_MS; the rest are counted.

const SILENCE_MS = 30 * 60 * 1000;
const FLOOD_WINDOW_MS = 10 * 60 * 1000;
const FLOOD_NEW = 10;
const FLOOD_EVENTS = 100;
const ALERT_CAP = 20;
const ALERT_WINDOW_MS = 10 * 60 * 1000;
const SYSTEM_COOLDOWN_MS = 60 * 60 * 1000;
const BUCKET_MS = 60 * 1000;

function emptyDay() {
  return {
    packets: 0, accepted: 0, foreign: 0, dropped: 0, events: 0, newDevices: 0,
    alerts: 0, suppressed: 0, unknown: 0, forged: 0, alarms: 0, named: 0,
  };
}

function createWatch(now) {
  return {
    startedAt: now,
    lastPacket: null,
    silent: false,
    buckets: new Map(), // minute -> { fresh, events }
    alertTimes: [],
    lastAlarm: new Map(),
    day: emptyDay(),
  };
}

function prune(w, now) {
  const oldest = Math.floor((now - FLOOD_WINDOW_MS) / BUCKET_MS);
  for (const m of w.buckets.keys()) if (m <= oldest) w.buckets.delete(m);
  while (w.alertTimes.length && w.alertTimes[0] <= now - ALERT_WINDOW_MS) w.alertTimes.shift();
}

function cooled(w, kind, now) {
  const last = w.lastAlarm.get(kind);
  if (last !== undefined && now - last < SYSTEM_COOLDOWN_MS) return false;
  w.lastAlarm.set(kind, now);
  return true;
}

function alarm(w, kind, severity, data = {}) {
  w.day.alarms += 1;
  return { kind, severity, data };
}

// outcome: 'accepted', 'foreign' (sender not allowed) or 'dropped' (size/rate cap).
function notePacket(w, now, outcome) {
  w.day.packets += 1;
  if (outcome === 'foreign') { w.day.foreign += 1; return []; }
  if (outcome === 'dropped') { w.day.dropped += 1; return []; }
  w.day.accepted += 1;
  w.lastPacket = now;
  if (w.silent) {
    w.silent = false;
    return [alarm(w, 'resumed', 'INFO')];
  }
  return [];
}

// result of an accepted packet: 'event', 'skip', 'unknown' or 'bad'.
function noteResult(w, now, result) {
  if (result === 'unknown') {
    w.day.unknown += 1;
    return cooled(w, 'unknown', now) ? [alarm(w, 'unknown', 'WARNING')] : [];
  }
  if (result === 'bad') {
    w.day.forged += 1;
    return cooled(w, 'forged', now) ? [alarm(w, 'forged', 'HIGH')] : [];
  }
  if (result === 'event') w.day.events += 1;
  return [];
}

function floodAlarm(w, now, data) {
  return cooled(w, 'flood', now) ? [alarm(w, 'flood', 'CRITICAL', data)] : [];
}

// A client event was handled; isNew = first time this device was seen.
function noteEvent(w, now, isNew) {
  prune(w, now);
  const m = Math.floor(now / BUCKET_MS);
  const b = w.buckets.get(m) || { fresh: 0, events: 0 };
  b.events += 1;
  if (isNew) { b.fresh += 1; w.day.newDevices += 1; }
  w.buckets.set(m, b);
  let fresh = 0;
  let events = 0;
  for (const x of w.buckets.values()) { fresh += x.fresh; events += x.events; }
  if (fresh >= FLOOD_NEW || events >= FLOOD_EVENTS) return floodAlarm(w, now, { fresh, events });
  return [];
}

// May a device alert go out now? Over the cap it is counted and a flood alarm raised.
function allowDeviceAlert(w, now) {
  prune(w, now);
  if (w.alertTimes.length < ALERT_CAP) {
    w.alertTimes.push(now);
    w.day.alerts += 1;
    return { allowed: true, alarms: [] };
  }
  w.day.suppressed += 1;
  return { allowed: false, alarms: floodAlarm(w, now, { capped: ALERT_CAP }) };
}

// Called every minute. Silence counts from start when nothing came yet.
function tick(w, now) {
  const since = w.lastPacket ?? w.startedAt;
  if (!w.silent && now - since >= SILENCE_MS) {
    w.silent = true;
    return [alarm(w, 'silence', 'HIGH', { minutes: Math.round((now - since) / 60000) })];
  }
  return [];
}

// Day counters for the report; starts a new day.
function takeDay(w) {
  const day = w.day;
  w.day = emptyDay();
  return day;
}

// Date formatters are costly to build (native memory, freed late), so one is
// kept per time zone and reused. Only the last time zone is kept.
let fmtZone = null;
let fmt = null;

function formatter(timeZone) {
  if (fmt === null || fmtZone !== timeZone) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    fmtZone = timeZone;
  }
  return fmt;
}

function localParts(ms, timeZone) {
  const out = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) out[p.type] = p.value;
  return out;
}

// 'YYYY-MM-DD' and hour in the Homey's time zone.
function localTime(now, timeZone) {
  const p = localParts(now, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

// 'YYYY-MM-DD HH:MM' in the Homey's time zone.
function formatLocal(ms, timeZone) {
  if (!Number.isFinite(ms)) return '-';
  const p = localParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

module.exports = {
  SILENCE_MS, FLOOD_NEW, FLOOD_EVENTS, ALERT_CAP, SYSTEM_COOLDOWN_MS,
  createWatch, notePacket, noteResult, noteEvent, allowDeviceAlert, tick, takeDay, localTime, formatLocal,
};
