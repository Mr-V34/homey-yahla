'use strict';

const crypto = require('crypto');

// Unlocked settings-page sessions. After the PIN is entered once, the page gets
// a random token that allows changes until it has been idle for IDLE_MS.
// Tokens live only in memory: an app restart locks every page again.

const IDLE_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 5;

function createSessions() {
  return new Map(); // token -> last use
}

function prune(sessions, now) {
  for (const [token, last] of sessions) if (now - last >= IDLE_MS) sessions.delete(token);
}

function openSession(sessions, now) {
  prune(sessions, now);
  if (sessions.size >= MAX_SESSIONS) {
    // Drop the least recently used one.
    let oldest = null;
    for (const [token, last] of sessions) if (oldest === null || last < sessions.get(oldest)) oldest = token;
    sessions.delete(oldest);
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, now);
  return token;
}

// True and refreshed when the token is a live session.
function useSession(sessions, token, now) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
  prune(sessions, now);
  if (!sessions.has(token)) return false;
  sessions.set(token, now);
  return true;
}

module.exports = {
  IDLE_MS, MAX_SESSIONS, createSessions, openSession, useSession,
};
