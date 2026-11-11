'use strict';

const Homey = require('homey');
const dgram = require('dgram');
const { createReceiver, handlePacket } = require('./lib/receiver');
const { loadStore } = require('./lib/registry');
const { handleEvent } = require('./lib/detector');
const { tokensFor, notificationFor } = require('./lib/alerts');

// ── YAHLA ─────────────────────────────────────────────────────────────────────
// Listens for syslog on UDP, turns client events into neutral events, and
// alerts on devices the owner has not approved. It never acts on the network.
// Logs hold counts only, never MAC or IP addresses.

const PORT = 5514;
const SAVE_MS = 60 * 1000;
const DEVICES_KEY = 'devices';
const STATS_KEY = 'stats';

class YahlaApp extends Homey.App {

  async onInit() {
    const { store, problem } = loadStore(this.homey.settings.get(DEVICES_KEY));
    this.store = store;
    if (problem && problem !== 'empty') this.error(`device list: ${problem}`);
    this.dirty = false;

    this.rx = createReceiver();
    this.trigger = this.homey.flow.getTriggerCard('unknown_device');

    this.socket = dgram.createSocket({ type: 'udp4' });
    this.socket.on('message', (buf) => this.onPacket(buf));
    this.socket.on('error', (err) => {
      // Fail loud: without the socket YAHLA sees nothing.
      const code = typeof err.code === 'string' ? err.code.slice(0, 32) : 'unknown';
      this.error(`socket error: ${code}`);
      this.closeSocket();
      this.homey.notifications.createNotification({ excerpt: this.homey.__('alert.socket', { code }) })
        .catch((e) => this.error(`notification failed: ${e.message}`));
    });
    this.socket.on('listening', () => this.log(`listening on UDP ${PORT}`));
    this.socket.bind(PORT);

    this.saveTimer = this.homey.setInterval(() => this.save(), SAVE_MS);
    this.log(`started, ${Object.keys(this.store.devices).length} known devices`);
  }

  onPacket(buf) {
    try {
      const event = handlePacket(this.rx, buf, Date.now());
      if (!event) return;
      const alert = handleEvent(this.store, event);
      this.dirty = true;
      if (alert) this.sendAlert(alert);
    } catch (err) {
      // One bad packet must never take the app down.
      this.error(`packet failed: ${err.message}`);
    }
  }

  sendAlert(alert) {
    this.log(`alert ${alert.type} ${alert.severity}`);
    const n = notificationFor(alert);
    this.homey.notifications.createNotification({ excerpt: this.homey.__(n.key, n.tokens) })
      .catch((err) => this.error(`notification failed: ${err.message}`));
    this.trigger.trigger(tokensFor(alert))
      .catch((err) => this.error(`trigger failed: ${err.message}`));
  }

  save() {
    try {
      if (this.dirty) {
        this.homey.settings.set(DEVICES_KEY, this.store);
        this.dirty = false;
      }
      this.homey.settings.set(STATS_KEY, {
        v: 1, ...this.rx.counters, devices: Object.keys(this.store.devices).length, at: new Date().toISOString(),
      });
    } catch (err) {
      this.error(`save failed: ${err.message}`);
    }
  }

  closeSocket() {
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = null;
    try { sock.close(); } catch (e) { /* already closed */ }
  }

  async onUninit() {
    if (this.saveTimer) this.homey.clearInterval(this.saveTimer);
    this.save();
    this.closeSocket();
  }

}

module.exports = YahlaApp;
