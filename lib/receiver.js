'use strict';

const { parseText } = require('./parsers');

// Turns one UDP packet into a parse result, with size and rate caps.
// Counters are plain numbers; nothing from a packet is kept here.

const MAX_PACKET = 16384;
const MAX_PER_MINUTE = 6000;

function createCounters() {
  return {
    packets: 0, oversize: 0, rate: 0, unknown: 0, bad: 0, skip: 0, events: 0,
  };
}

function createReceiver() {
  return { counters: createCounters(), minute: 0, inMinute: 0 };
}

// Returns null when the packet was dropped or held no event, else the event.
function handlePacket(rx, buf, now) {
  const c = rx.counters;
  c.packets += 1;
  if (!Buffer.isBuffer(buf) || buf.length > MAX_PACKET) {
    c.oversize += 1;
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
    return null;
  }
  const out = parseText(buf.toString('utf8'), now);
  if (out.result === 'event') {
    c.events += 1;
    return out.event;
  }
  c[out.result] += 1; // 'unknown', 'bad' or 'skip'
  return null;
}

module.exports = {
  MAX_PACKET, MAX_PER_MINUTE, createCounters, createReceiver, handlePacket,
};
