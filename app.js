'use strict';

const Homey = require('homey');
const dgram = require('dgram');
const { createReceiver, handlePacket } = require('./lib/receiver');
const { loadStore } = require('./lib/registry');
const { handleEvent } = require('./lib/detector');
const { tokensFor, notificationFor } = require('./lib/alerts');
const { loadConfig, checkConfig } = require('./lib/config');
const { applyDeviceAction, deviceList } = require('./lib/admin');
const { createGuard, remember, isTampered } = require('./lib/guard');
const pin = require('./lib/pin');

// ── YAHLA ─────────────────────────────────────────────────────────────────────
// Listens for syslog on UDP, turns client events into neutral events, and
// alerts on devices the owner has not approved. It never acts on the network.
// Logs hold counts only, never MAC or IP addresses. Owner changes need the PIN.

const PORT = 5514;
const SAVE_MS = 60 * 1000;
const TAMPER_NOTE_MS = 60 * 1000;
const KEYS = {
  devices: 'devices', config: 'config', pin: 'pin', pinGuard: 'pinGuard', stats: 'stats',
};
const GUARDED = [KEYS.devices, KEYS.config, KEYS.pin, KEYS.pinGuard];

function validPinRecord(r) {
  return r && typeof r === 'object' && r.v === 1 && typeof r.salt === 'string' && typeof r.hash === 'string';
}

class YahlaApp extends Homey.App {

  async onInit() {
    const s = this.homey.settings;
    const loaded = loadStore(s.get(KEYS.devices));
    this.store = loaded.store;
    const conf = loadConfig(s.get(KEYS.config));
    this.config = conf.config;
    this.pinRecord = validPinRecord(s.get(KEYS.pin)) ? s.get(KEYS.pin) : null;
    const g = s.get(KEYS.pinGuard);
    this.pinGuard = g && Number.isFinite(g.fails) && Number.isFinite(g.lockedUntil) ? g : { fails: 0, lockedUntil: 0 };
    for (const [what, problem] of [['device list', loaded.problem], ['settings', conf.problem]]) {
      if (problem && problem !== 'empty') {
        this.error(`${what}: ${problem}`);
        this.notify('alert.storeProblem', { what, problem });
      }
    }

    // Write back what was loaded (migrates old versions), then start guarding.
    this.guard = createGuard(GUARDED);
    this.lastTamperNote = new Map();
    this.writeGuarded(KEYS.devices, this.store);
    this.writeGuarded(KEYS.config, this.config);
    this.writeGuarded(KEYS.pin, this.pinRecord);
    this.writeGuarded(KEYS.pinGuard, this.pinGuard);
    this.onSettingChange = (key) => this.checkTamper(key);
    s.on('set', this.onSettingChange);
    s.on('unset', this.onSettingChange);

    this.dirty = false;
    this.pinQueue = Promise.resolve();
    this.rx = createReceiver();
    this.trigger = this.homey.flow.getTriggerCard('unknown_device');
    this.listening = false;

    this.socket = dgram.createSocket({ type: 'udp4' });
    this.socket.on('message', (buf, rinfo) => this.onPacket(buf, rinfo));
    this.socket.on('error', (err) => {
      // Fail loud: without the socket YAHLA sees nothing.
      const code = typeof err.code === 'string' ? err.code.slice(0, 32) : 'unknown';
      this.error(`socket error: ${code}`);
      this.closeSocket();
      this.notify('alert.socket', { code });
    });
    this.socket.on('listening', () => {
      this.listening = true;
      this.log(`listening on UDP ${PORT}`);
    });
    this.socket.bind(PORT);

    this.saveTimer = this.homey.setInterval(() => this.save(), SAVE_MS);
    this.log(`started, ${Object.keys(this.store.devices).length} known devices`);
  }

  // ── Packets and alerts ──────────────────────────────────────────────────────

  onPacket(buf, rinfo) {
    try {
      const sender = rinfo && typeof rinfo.address === 'string' ? rinfo.address : null;
      const event = handlePacket(this.rx, buf, Date.now(), sender, this.config);
      if (!event) return;
      const alert = handleEvent(this.store, event, this.config);
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
    this.notify(n.key, n.tokens);
    this.trigger.trigger(tokensFor(alert))
      .catch((err) => this.error(`trigger failed: ${err.message}`));
  }

  notify(key, tokens) {
    this.homey.notifications.createNotification({ excerpt: this.homey.__(key, tokens) })
      .catch((err) => this.error(`notification failed: ${err.message}`));
  }

  // ── Storage and tamper guard ────────────────────────────────────────────────

  writeGuarded(key, value) {
    remember(this.guard, key, value);
    this.homey.settings.set(key, value);
  }

  ownValue(key) {
    if (key === KEYS.devices) return this.store;
    if (key === KEYS.config) return this.config;
    if (key === KEYS.pin) return this.pinRecord;
    return this.pinGuard;
  }

  // Someone wrote a guarded key from outside: put the app's value back and say so.
  checkTamper(key) {
    try {
      if (!isTampered(this.guard, key, this.homey.settings.get(key))) return;
      this.error(`TAMPER: setting "${key}" was changed outside the app, restored`);
      this.writeGuarded(key, this.ownValue(key));
      const now = Date.now();
      if (now - (this.lastTamperNote.get(key) || 0) >= TAMPER_NOTE_MS) {
        this.lastTamperNote.set(key, now);
        this.notify('alert.tamper', { key });
      }
    } catch (err) {
      this.error(`tamper check failed: ${err.message}`);
    }
  }

  save() {
    try {
      if (this.dirty) {
        this.writeGuarded(KEYS.devices, this.store);
        this.dirty = false;
      }
      this.homey.settings.set(KEYS.stats, { v: 1, ...this.statusCounts(), at: new Date().toISOString() });
    } catch (err) {
      this.error(`save failed: ${err.message}`);
    }
  }

  statusCounts() {
    const states = { new: 0, approved: 0, ignored: 0 };
    for (const d of Object.values(this.store.devices)) states[d.s] += 1;
    return { ...this.rx.counters, ...states };
  }

  // ── Owner actions (Web API, settings page) ──────────────────────────────────

  // One PIN check at a time, so parallel calls cannot slip past the lock.
  serial(fn) {
    const run = this.pinQueue.then(fn, fn);
    this.pinQueue = run.catch(() => {});
    return run;
  }

  async tryPin(given) {
    const now = Date.now();
    if (!this.pinRecord) return 'noPin';
    if (pin.isLocked(this.pinGuard, now)) return 'locked';
    const ok = await pin.pinMatches(this.pinRecord, given);
    this.pinGuard = pin.afterTry(this.pinGuard, ok, now);
    this.writeGuarded(KEYS.pinGuard, this.pinGuard);
    if (!ok) this.log('wrong PIN');
    return ok ? 'ok' : 'wrong';
  }

  getStatus() {
    return {
      listening: this.listening,
      counts: this.statusCounts(),
      senders: [...this.rx.senders.entries()].map(([ip, x]) => ({
        ip, count: x.count, last: x.last, allowed: x.allowed,
      })),
      pinSet: Boolean(this.pinRecord),
      locked: pin.isLocked(this.pinGuard, Date.now()),
      config: this.config,
    };
  }

  getDevices() {
    return deviceList(this.store);
  }

  setPin(body) {
    return this.serial(async () => {
      const { newPin, oldPin } = body || {};
      if (!pin.validPin(newPin)) return { ok: false, code: 'invalid' };
      if (this.pinRecord) {
        const res = await this.tryPin(oldPin);
        if (res !== 'ok') return { ok: false, code: res };
      }
      const first = !this.pinRecord;
      this.pinRecord = await pin.hashPin(newPin);
      this.writeGuarded(KEYS.pin, this.pinRecord);
      this.log(first ? 'PIN set' : 'PIN changed');
      this.notify(first ? 'alert.pinSet' : 'alert.pinChanged', {});
      return { ok: true, code: 'pinSaved' };
    });
  }

  deviceAction(body) {
    return this.serial(async () => {
      const { pin: given, mac, action } = body || {};
      const res = await this.tryPin(given);
      if (res !== 'ok') return { ok: false, code: res };
      const code = applyDeviceAction(this.store, mac, action, Date.now());
      if (code !== 'ok') return { ok: false, code };
      this.writeGuarded(KEYS.devices, this.store);
      this.dirty = false;
      this.log(`device ${action}`);
      this.notify(`alert.action.${action}`, { mac: String(mac).toLowerCase().replace(/-/g, ':') });
      return { ok: true, code: 'done' };
    });
  }

  setConfig(body) {
    return this.serial(async () => {
      const { pin: given, config } = body || {};
      const res = await this.tryPin(given);
      if (res !== 'ok') return { ok: false, code: res };
      const clean = checkConfig(config);
      if (!clean) return { ok: false, code: 'invalid' };
      this.config = clean;
      this.writeGuarded(KEYS.config, this.config);
      this.log('settings changed');
      this.notify('alert.configChanged', {});
      return { ok: true, code: 'done' };
    });
  }

  // ── Shutdown ────────────────────────────────────────────────────────────────

  closeSocket() {
    this.listening = false;
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = null;
    try { sock.close(); } catch (e) { /* already closed */ }
  }

  async onUninit() {
    if (this.saveTimer) this.homey.clearInterval(this.saveTimer);
    if (this.onSettingChange) {
      this.homey.settings.off('set', this.onSettingChange);
      this.homey.settings.off('unset', this.onSettingChange);
    }
    this.save();
    this.closeSocket();
  }

}

module.exports = YahlaApp;
