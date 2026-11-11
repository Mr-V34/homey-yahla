'use strict';

const { validIp } = require('./event');

// Owner settings: which senders may send syslog, and how serious a new device
// is on each network. Changed only through the PIN-protected page.
//
// config: { v, senders: [ip], severity: { networkKey: level }, defaultSeverity }
//   senders empty  = accept every sender (first setup; the page warns)
//   level 'NONE'   = silent network (devices are recorded, never alerted)

const VERSION = 1;
const LEVELS = ['NONE', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const MAX_SENDERS = 5;
const MAX_NETWORKS = 32;
const KEY_RE = /^(vlan:\d{1,4}|name:[\p{L}\p{N} ._?-]{1,32})$/u;

function defaultConfig() {
  return {
    v: VERSION, senders: [], severity: {}, defaultSeverity: 'HIGH',
  };
}

// Checks a whole config (stored or sent by the page). Returns the clean
// config, or null when anything is wrong: never half-applied.
function checkConfig(input) {
  if (!input || typeof input !== 'object') return null;
  const { senders, severity, defaultSeverity } = input;
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
  return {
    v: VERSION, senders: cleanSenders, severity: cleanSeverity, defaultSeverity,
  };
}

function loadConfig(raw) {
  if (raw === null || raw === undefined) return { config: defaultConfig(), problem: 'empty' };
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
  LEVELS, MAX_SENDERS, defaultConfig, checkConfig, loadConfig, severityFor, senderAllowed,
};
