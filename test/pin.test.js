'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const {
  MAX_FAILS, LOCK_MS, validPin, hashPin, pinMatches, needsRehash, isLocked, afterTry,
} = require('../lib/pin');
const {
  IDLE_MS, MAX_SESSIONS, createSessions, openSession, useSession,
} = require('../lib/session');

test('only 6-12 digit strings are valid PINs', () => {
  assert.ok(validPin('123456'));
  assert.ok(validPin('123456789012'));
  assert.ok(!validPin('12345'));
  assert.ok(!validPin('1234567890123'));
  assert.ok(!validPin('12345a'));
  assert.ok(!validPin(' 123456'));
  assert.ok(!validPin(123456));
  assert.ok(!validPin(null));
});

test('new hashes are PBKDF2 (v2), match only the right PIN, never hold the PIN', async () => {
  const rec = await hashPin('482915');
  assert.strictEqual(rec.v, 2);
  assert.ok(!JSON.stringify(rec).includes('482915'));
  assert.ok(await pinMatches(rec, '482915'));
  assert.ok(!(await pinMatches(rec, '482916')));
  assert.ok(!needsRehash(rec));
  assert.ok(!(await pinMatches(null, '482915')));
  assert.ok(!(await pinMatches({ v: 2, salt: 'zz', hash: 'short', it: 210000 }, '482915')));
  assert.ok(!(await pinMatches({ ...rec, it: 5 }, '482915')), 'weak iteration count refused');
});

test('an old scrypt (v1) PIN still works and asks for a rehash', async () => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('482915', salt, 32, { N: 16384, r: 8, p: 1 });
  const v1 = { v: 1, salt: salt.toString('hex'), hash: key.toString('hex') };
  assert.ok(await pinMatches(v1, '482915'));
  assert.ok(!(await pinMatches(v1, '000000')));
  assert.ok(needsRehash(v1));
});

test('PIN checks do not keep large amounts of memory', async () => {
  const rec = await hashPin('482915');
  const before = process.memoryUsage().rss;
  for (let i = 0; i < 6; i += 1) await pinMatches(rec, '000000');
  const grown = (process.memoryUsage().rss - before) / 1048576;
  assert.ok(grown < 16, `rss grew ${grown.toFixed(1)} MB`);
});

test('lock after MAX_FAILS wrong tries, reset on success', () => {
  const now = 1000;
  let g = { fails: 0, lockedUntil: 0 };
  for (let i = 0; i < MAX_FAILS - 1; i += 1) g = afterTry(g, false, now);
  assert.ok(!isLocked(g, now));
  g = afterTry(g, false, now);
  assert.ok(isLocked(g, now));
  assert.ok(!isLocked(g, now + LOCK_MS + 1));
  assert.deepStrictEqual(afterTry(g, true, now), { fails: 0, lockedUntil: 0 });
});

test('sessions: valid until idle, capped, bad tokens refused', () => {
  const s = createSessions();
  const a = openSession(s, 0);
  assert.ok(useSession(s, a, IDLE_MS - 1), 'use refreshes');
  assert.ok(useSession(s, a, 2 * IDLE_MS - 2));
  assert.ok(!useSession(s, a, 4 * IDLE_MS), 'idle too long');
  assert.ok(!useSession(s, 'x'.repeat(64), 0));
  assert.ok(!useSession(s, null, 0));
  assert.ok(!useSession(s, { length: 64 }, 0));
  const tokens = Array.from({ length: MAX_SESSIONS + 1 }, (_, i) => openSession(s, 10 * IDLE_MS + i));
  assert.strictEqual(s.size, MAX_SESSIONS);
  assert.ok(!useSession(s, tokens[0], 10 * IDLE_MS + 10), 'oldest dropped');
  assert.ok(useSession(s, tokens[MAX_SESSIONS], 10 * IDLE_MS + 10));
});
