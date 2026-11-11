'use strict';

const crypto = require('crypto');

// Owner PIN for approvals. Only a salted scrypt hash is stored, never the PIN.
// After MAX_FAILS wrong tries in a row, PIN checks are locked for LOCK_MS.

const PIN_RE = /^\d{6,12}$/;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 32;

function validPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

function scrypt(pin, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEYLEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt);
  return { v: 1, salt: salt.toString('hex'), hash: key.toString('hex') };
}

async function pinMatches(record, pin) {
  if (!record || record.v !== 1 || !validPin(pin)) return false;
  if (typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length !== KEYLEN) return false;
  const key = await scrypt(pin, Buffer.from(record.salt, 'hex'));
  return crypto.timingSafeEqual(key, expected);
}

// guard: { fails, lockedUntil } (plain object, stored by the caller)
function isLocked(guard, now) {
  return Boolean(guard && guard.lockedUntil && guard.lockedUntil > now);
}

function afterTry(guard, ok, now) {
  if (ok) return { fails: 0, lockedUntil: 0 };
  const fails = ((guard && guard.fails) || 0) + 1;
  if (fails >= MAX_FAILS) return { fails: 0, lockedUntil: now + LOCK_MS };
  return { fails, lockedUntil: 0 };
}

module.exports = { MAX_FAILS, LOCK_MS, validPin, hashPin, pinMatches, isLocked, afterTry };
