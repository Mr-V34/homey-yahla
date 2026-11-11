'use strict';

const unifiCef = require('./unifi-cef');

// One parser per source. Each returns null when the text is not its format.
// Text that no parser claims is 'unknown': counted, and later an alarm, never guessed.
const PARSERS = [unifiCef];

function parseText(text, at) {
  for (const parser of PARSERS) {
    const out = parser.parse(text, at);
    if (out) return out;
  }
  return { result: 'unknown' };
}

module.exports = { parseText };
