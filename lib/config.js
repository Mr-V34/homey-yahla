'use strict';

const { validIp } = require('./event');

// Owner settings: which senders may send syslog, and how serious a new device
// is on each network. Changed only through the PIN-protected page.
//
// config: { v, senders: [ip], severity: { networkKey: level }, defaultSeverity, logLevel }
//   senders empty  = accept every sender (first setup; the page warns)
//   level 'NONE'   = silent network (devices are recorded, never alerted)
//   logLevel       = how much goes to the Homey timeline: 'minimum', 'extended' or 'debug'
//                    (serious system alarms and the daily report always do; Flow triggers
//                    always fire). Added in v2; v1 configs get 'extended'.

const VERSION = 2;
const LEVELS = ['NONE', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const LOG_LEVELS = ['minimum', 'extended', 'debug'];
const MAX_SENDERS = 5;
const MAX_NETWORKS = 32;
const KEY_RE = /^(vlan:\d{1,4}|name:[\p{L}\p{N} ._?-]{1,32})$/u;

function defaultConfig() {
  return {
    v: VERSION, senders: [], severity: {}, defaultSeverity: 'HIGH', logLevel: 'extended',
  };
}

// Checks a whole config (stored or sent by the page). Returns the clean
// config, or null when anything is wrong: never half-applied.
function checkConfig(input) {
  if (!input || typeof input !== 'object') return null;
  const {
    senders, severity, defaultSeverity, logLevel,
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
  return {
    v: VERSION, senders: cleanSenders, severity: cleanSeverity, defaultSeverity, logLevel,
  };
}

function loadConfig(input) {
  if (input === null || input === undefined) return { config: defaultConfig(), problem: 'empty' };
  const raw = input && typeof input === 'object' && input.v === 1 ? { ...input, v: VERSION, logLevel: 'extended' } : input;
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
  LEVELS, LOG_LEVELS, MAX_SENDERS, defaultConfig, checkConfig, loadConfig, severityFor, senderAllowed,
};
