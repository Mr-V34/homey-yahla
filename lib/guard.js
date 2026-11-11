'use strict';

// Tamper guard for app settings. The app's own memory is the truth: it
// remembers what it wrote last for each guarded key. If a key changes to
// anything else (someone wrote it from outside, e.g. through the Web API), the
// app's value is written back and the change is reported.
//
// Limit: changes made while the app is not running cannot be seen this way.

function createGuard(keys) {
  return { keys: new Set(keys), expected: new Map() };
}

function remember(guard, key, value) {
  guard.expected.set(key, JSON.stringify(value ?? null));
}

// Returns true when the stored value differs from what the app wrote.
function isTampered(guard, key, storedValue) {
  if (!guard.keys.has(key) || !guard.expected.has(key)) return false;
  return JSON.stringify(storedValue ?? null) !== guard.expected.get(key);
}

module.exports = { createGuard, remember, isTampered };
