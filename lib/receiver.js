'use strict';

const { parseText } = require('./parsers');
const { senderAllowed } = require('./config');

// Turns one UDP packet into a parse result, with size and rate caps.
// Counters are plain numbers; nothing from a packet is kept here.

const MAX_PACKET = 16384;
const MAX_PER_MINUTE = 6000;
const MAX_SENDERS_SEEN = 10;

function createCounters() {
  return {
    packets: 0, oversize: 0, rate: 0, foreign: 0, unknown: 0, bad: 0, skip: 0, events: 0, named: 0,
  };
}

function createReceiver() {
  // senders: which IPs sent packets lately (to help the owner pick allowed ones).
  return {
    counters: createCounters(), minute: 0, inMinute: 0, senders: new Map(), last: null,
  };
}

function noteSender(rx, ip, allowed, now) {
  const seen = rx.senders.get(ip);
  if (seen) {
    seen.count += 1;
    seen.last = now;
    seen.allowed = allowed;
  } else if (rx.senders.size < MAX_SENDERS_SEEN) {
    rx.senders.set(ip, { count: 1, last: now, allowed });
  }
}

// Returns null when the packet was dropped or held no event, else the event.
// rx.last tells what happened: 'foreign', 'dropped', 'event', 'skip', 'unknown', 'bad'.
// senderIp comes from the socket (UDP sources can be forged on the same subnet,
// so the filter cuts noise; it is not proof of origin).
function handlePacket(rx, buf, now, senderIp = null, config = null) {
  const c = rx.counters;
  c.packets += 1;
  if (senderIp !== null) {
    const allowed = !config || senderAllowed(config, senderIp);
    noteSender(rx, senderIp, allowed, now);
    if (!allowed) {
      c.foreign += 1;
      rx.last = 'foreign';
      return null;
    }
  }
  if (!Buffer.isBuffer(buf) || buf.length > MAX_PACKET) {
    c.oversize += 1;
    rx.last = 'dropped';
    return null;
  }
  const minute = Math.floor(now / 60000);
  if (minute !== rx.minute) {
    rx.minute = minute;
    rx.inMinute = 0;
  }
  rx.inMinute += 1;
  if (rx.inMinute > MAX_PER_MINUTE) {
    c.rate += 1;
    rx.last = 'dropped';
    return null;
  }
  const out = parseText(buf.toString('utf8'), now);
  rx.last = out.result; // 'event', 'skip', 'unknown' or 'bad'
  if (out.result === 'event') {
    c.events += 1;
    if (out.event.name) c.named += 1;
    return out.event;
  }
  c[out.result] += 1; // 'unknown', 'bad' or 'skip'
  return null;
}

module.exports = {
  MAX_PACKET, MAX_PER_MINUTE, createCounters, createReceiver, handlePacket,
};
