'use strict';

const { normalizeMac, validIp, safeLabel } = require('../event');

// DHCP leases from dnsmasq, as logged by ASUS (Asuswrt, Merlin), OpenWrt and
// many other routers:
//   dnsmasq-dhcp[392]: DHCPACK(br0) 192.168.1.51 02:00:00:00:00:01 laptop
// Only DHCPACK (an address was handed out) is a join. Other dnsmasq-dhcp lines
// are skipped. The interface (br0, br-lan, br-iot ...) is used as the network.
// The hostname is chosen by the device, so it is shown only.
//
// The whole line must match up to its end, so a hostname cannot carry a
// second, made-up line.

const ID = 'dnsmasq-dhcp';
const TAG_RE = /\bdnsmasq-dhcp(?:\[\d{1,7}\])?: /;
const ACK_RE = /\bdnsmasq-dhcp(?:\[\d{1,7}\])?: DHCPACK\(([A-Za-z0-9_.-]{1,16})\) ([0-9A-Fa-f.:]{2,45}) ([0-9A-Fa-f]{2}(?:[:-][0-9A-Fa-f]{2}){5})(?: ([^\s]{1,64}))?\s*$/;

function parse(text, at) {
  if (!TAG_RE.test(text)) return null;
  const m = ACK_RE.exec(text);
  if (!m) return { result: 'skip' };
  const mac = normalizeMac(m[3]);
  if (!mac) return { result: 'bad', reason: 'nomac' };
  return {
    result: 'event',
    event: {
      mac,
      ip: validIp(m[2]),
      network: safeLabel(m[1], 32),
      vlan: null,
      where: null,
      name: safeLabel(m[4], 48, true),
      kind: 'join',
      at,
      source: ID,
    },
  };
}

module.exports = { ID, parse };
