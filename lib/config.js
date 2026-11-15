'use strict';

const { validIp } = require('./event');

// Owner settings: which senders may send syslog, and how serious a new device
// is on each network. Changed only through the PIN-protected page.
//
// config: { v, senders: [ip], severity: { networkKey: level }, defaultSeverity, logLevel, report, reportHour }
//   senders empty  = accept every sender (first setup; the page warns)
//   level 'NONE'   = silent network (devices are recorded, never alerted)
//   logLevel       = how much goes to the Homey timeline: 'minimum', 'extended' or 'debug'
//                    (serious system alarms always do; Flow triggers always fire).
//                    Added in v2; v1 configs get 'extended'.
//   report         = what the daily report writes to the timeline: 'off', 'short' or 'full'
//   reportHour     = local hour (0-23) of the daily report
//                    Both added in v3; older configs get 'short' and 7.

const VERSION = 3;
const LEVELS = ['NONE', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const LOG_LEVELS = ['minimum', 'extended', 'debug'];
const REPORT_MODES = ['off', 'short', 'full'];
const MAX_SENDERS = 5;
const MAX_NETWORKS = 32;
const KEY_RE = /^(vlan:\d{1,4}|name:[\p{L}\p{N} ._?-]{1,32})$/u;

function defaultConfig() {
  return {
    v: VERSION, senders: [], severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended', report: 'short', reportHour: 7,
  };
}

// Checks a whole config (stored or sent by the page). Returns the clean
// config, or null when anything is wrong: never half-applied.
function checkConfig(input) {
  if (!input || typeof input !== 'object') return null;
  const {
    senders, severity, defaultSeverity, logLevel, report, reportHour,
  } = input;
  if (!Array.isArray(senders) || senders.length > MAX_SENDERS) return null;
  const cleanSenders = [];
  for (const s of senders) {
    const ip = validIp(s);
    if (!ip || ip.includes(':')) return null; // IPv4 only for now
    if (!cleanSenders.includes(ip)) cleanSenders.push(ip);
  }
  if (!severity || typeof severity !== 'object' || Array.isArray(severity)) return null;
  const entries = Object.entries(severity);
  if (entries.length > MAX_NETWORKS) return null;
  const cleanSeverity = {};
  for (const [key, level] of entries) {
    if (!KEY_RE.test(key) || !LEVELS.includes(level)) return null;
    cleanSeverity[key] = level;
  }
  if (!LEVELS.includes(defaultSeverity) || defaultSeverity === 'NONE') return null;
  if (!LOG_LEVELS.includes(logLevel)) return null;
  if (!REPORT_MODES.includes(report)) return null;
  if (!Number.isInteger(reportHour) || reportHour < 0 || reportHour > 23) return null;
  return {
    v: VERSION, senders: cleanSenders, severity: cleanSeverity, defaultSeverity, logLevel, report, reportHour,
  };
}

function loadConfig(input) {
  if (input === null || input === undefined) return { config: defaultConfig(), problem: 'empty' };
  // Old versions are migrated in steps, never reset.
  let raw = input;
  if (typeof raw === 'object' && raw.v === 1) raw = { ...raw, v: 2, logLevel: 'extended' };
  if (typeof raw === 'object' && raw.v === 2) raw = { ...raw, v: VERSION, report: 'short', reportHour: 7 };
  if (typeof raw !== 'object' || raw.v !== VERSION) return { config: defaultConfig(), problem: 'unknown_version' };
  const config = checkConfig(raw);
  return config ? { config, problem: null } : { config: defaultConfig(), problem: 'invalid' };
}

function severityFor(config, networkKey) {
  if (networkKey && config.severity[networkKey]) return config.severity[networkKey];
  return config.defaultSeverity;
}

function senderAllowed(config, ip) {
  return config.senders.length === 0 || config.senders.includes(ip);
}

module.exports = {
  LEVELS, LOG_LEVELS, REPORT_MODES, MAX_SENDERS, defaultConfig, checkConfig, loadConfig, severityFor, senderAllowed,
};
