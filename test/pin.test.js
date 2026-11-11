'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_FAILS, LOCK_MS, validPin, hashPin, pinMatches, isLocked, afterTry,
} = require('../lib/pin');

test('only 6-12 digit strings are valid PINs', () => {
  assert.ok(validPin('123456'));
  assert.ok(validPin('123456789012'));
  assert.ok(!validPin('12345'));
  assert.ok(!validPin('1234567890123'));
  assert.ok(!validPin('12345a'));
  assert.ok(!validPin(123456));
  assert.ok(!validPin(null));
});

test('hash matches only the right PIN and never holds the PIN', async () => {
  const rec = await hashPin('482915');
  assert.ok(!JSON.stringify(rec).includes('482915'));
  assert.ok(await pinMatches(rec, '482915'));
  assert.ok(!(await pinMatches(rec, '482916')));
  assert.ok(!(await pinMatches(null, '482915')));
  assert.ok(!(await pinMatches({ v: 1, salt: 'zz', hash: 'short' }, '482915')));
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
