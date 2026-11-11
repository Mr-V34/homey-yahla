'use strict';

const crypto = require('crypto');

// Owner PIN. Only a salted hash is stored, never the PIN.
// After MAX_FAILS wrong tries in a row, PIN checks are locked for LOCK_MS.
//
// Record v2: PBKDF2-SHA256. Record v1 (scrypt, older builds) is still accepted
// so an existing PIN keeps working; the caller rehashes it to v2 on a match.
// scrypt was dropped because each check took 16 MB in the thread pool, and
// that memory was not given back (measured on the Homey: 17 MB -> 93 MB).

const PIN_RE = /^\d{6,12}$/;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const KEYLEN = 32;
const PBKDF2_ITERATIONS = 210000;
const SCRYPT_V1 = { N: 16384, r: 8, p: 1 };

function validPin(pin) {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

function pbkdf2(pin, salt, iterations) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(pin, salt, iterations, KEYLEN, 'sha256', (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function scryptV1(pin, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, KEYLEN, SCRYPT_V1, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await pbkdf2(pin, salt, PBKDF2_ITERATIONS);
  return {
    v: 2, salt: salt.toString('hex'), hash: key.toString('hex'), it: PBKDF2_ITERATIONS,
  };
}

function validRecord(r) {
  if (!r || typeof r !== 'object' || typeof r.salt !== 'string' || typeof r.hash !== 'string') return false;
  if (!/^[0-9a-f]{32}$/.test(r.salt) || !/^[0-9a-f]{64}$/.test(r.hash)) return false;
  if (r.v === 1) return true;
  return r.v === 2 && Number.isInteger(r.it) && r.it >= 100000 && r.it <= 2000000;
}

async function pinMatches(record, pin) {
  if (!validRecord(record) || !validPin(pin)) return false;
  const salt = Buffer.from(record.salt, 'hex');
  const key = record.v === 1 ? await scryptV1(pin, salt) : await pbkdf2(pin, salt, record.it);
  return crypto.timingSafeEqual(key, Buffer.from(record.hash, 'hex'));
}

function needsRehash(record) {
  return validRecord(record) && (record.v !== 2 || record.it !== PBKDF2_ITERATIONS);
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

module.exports = {
  MAX_FAILS, LOCK_MS, validPin, validRecord, hashPin, pinMatches, needsRehash, isLocked, afterTry,
};
