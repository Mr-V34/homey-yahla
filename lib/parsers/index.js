'use strict';

const unifiCef = require('./unifi-cef');
const dnsmasqDhcp = require('./dnsmasq-dhcp');
const wifiAp = require('./wifi-ap');

// One parser per source. Each returns null when the text is not its format.
// Text that no parser claims is 'unknown': counted, and later an alarm, never guessed.
//
// Each parser's mark (where its format starts) is looked up, and the parser
// whose mark comes first in the line gets it. A device name later in the line
// (for example a DHCP hostname "CEF:0|...") can then never pick another parser.
const PARSERS = [
  { parser: unifiCef, mark: /CEF:/ },
  { parser: dnsmasqDhcp, mark: /\bdnsmasq-dhcp(?:\[\d{1,7}\])?: / },
  { parser: wifiAp, mark: /\b(?:hostapd(?:\[\d{1,7}\])?|wlceventd_proc_event\(\d{1,6}\)): / },
];

function parseText(text, at) {
  let best = null;
  let bestAt = Infinity;
  for (const p of PARSERS) {
    const m = p.mark.exec(text);
    if (m && m.index < bestAt) {
      best = p.parser;
      bestAt = m.index;
    }
  }
  return (best && best.parse(text, at)) || { result: 'unknown' };
}

module.exports = { parseText };
