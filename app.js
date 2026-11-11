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
const { createSessions, openSession, useSession } = require('./lib/session');
const watch = require('./lib/watch');
const { reportTokens } = require('./lib/report');

// ── YAHLA ─────────────────────────────────────────────────────────────────────
// Listens for syslog on UDP, turns client events into neutral events, and
// alerts on devices the owner has not approved. It never acts on the network.
// Logs hold counts only, never MAC or IP addresses. Owner changes need the PIN.

const PORT = 5514;
const SAVE_MS = 60 * 1000;
const TAMPER_NOTE_MS = 60 * 1000;
const REPORT_HOUR = 7; // local time of the daily report
const REPORT_KEY = 'report';
// Timeline levels. 'always' ignores the owner's log level: serious alarms and
// the daily report must never be hidden (fail loud).
const LOG_RANK = { minimum: 1, extended: 2, debug: 3 };
const ALARM_LEVEL = {
  silence: 'always', tamper: 'always', socket: 'always', flood: 'always', storeProblem: 'always',
  forged: 'extended', unknown: 'debug', resumed: 'debug',
};
const KEYS = {
  devices: 'devices', config: 'config', pin: 'pin', pinGuard: 'pinGuard', stats: 'stats',
};
const GUARDED = [KEYS.devices, KEYS.config, KEYS.pin, KEYS.pinGuard];

class YahlaApp extends Homey.App {

  async onInit() {
    const s = this.homey.settings;
    this.pendingAlarms = [];
    const loaded = loadStore(s.get(KEYS.devices));
    this.store = loaded.store;
    const conf = loadConfig(s.get(KEYS.config));
    this.config = conf.config;
    this.pinRecord = pin.validRecord(s.get(KEYS.pin)) ? s.get(KEYS.pin) : null;
    const g = s.get(KEYS.pinGuard);
    this.pinGuard = g && Number.isFinite(g.fails) && Number.isFinite(g.lockedUntil) ? g : { fails: 0, lockedUntil: 0 };
    for (const [what, problem] of [['device list', loaded.problem], ['settings', conf.problem]]) {
      if (problem && problem !== 'empty') {
        this.error(`${what}: ${problem}`);
        this.pendingAlarms.push({ kind: 'storeProblem', severity: 'HIGH', data: { what, problem } });
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
    this.sessions = createSessions();
    this.rx = createReceiver();
    this.trigger = this.homey.flow.getTriggerCard('unknown_device');
    this.alarmTrigger = this.homey.flow.getTriggerCard('system_alarm');
    this.reportTrigger = this.homey.flow.getTriggerCard('daily_report');
    this.watch = watch.createWatch(Date.now());
    this.initReportDate();
    this.pendingAlarms.forEach((a) => this.sendAlarm(a));
    this.pendingAlarms = [];
    this.listening = false;

    this.socket = dgram.createSocket({ type: 'udp4' });
    this.socket.on('message', (buf, rinfo) => this.onPacket(buf, rinfo));
    this.socket.on('error', (err) => {
      // Fail loud: without the socket YAHLA sees nothing.
      const code = typeof err.code === 'string' ? err.code.slice(0, 32) : 'unknown';
      this.error(`socket error: ${code}`);
      this.closeSocket();
      this.sendAlarm({ kind: 'socket', severity: 'CRITICAL', data: { code } });
    });
    this.socket.on('listening', () => {
      this.listening = true;
      this.log(`listening on UDP ${PORT}`);
    });
    this.socket.bind(PORT);

    this.saveTimer = this.homey.setInterval(() => this.everyMinute(), SAVE_MS);
    this.log(`started, ${Object.keys(this.store.devices).length} known devices`);
  }

  // ── Packets and alerts ──────────────────────────────────────────────────────

  onPacket(buf, rinfo) {
    try {
      const now = Date.now();
      const sender = rinfo && typeof rinfo.address === 'string' ? rinfo.address : null;
      const event = handlePacket(this.rx, buf, now, sender, this.config);
      const outcome = this.rx.last;
      const alarms = watch.notePacket(this.watch, now, outcome === 'foreign' || outcome === 'dropped' ? outcome : 'accepted');
      if (outcome !== 'foreign' && outcome !== 'dropped') alarms.push(...watch.noteResult(this.watch, now, outcome));
      if (event) {
        const isNew = !(event.mac in this.store.devices);
        if (event.name) this.watch.day.named += 1;
        const alert = handleEvent(this.store, event, this.config);
        this.dirty = true;
        alarms.push(...watch.noteEvent(this.watch, now, isNew));
        if (alert) {
          const gate = watch.allowDeviceAlert(this.watch, now);
          alarms.push(...gate.alarms);
          if (gate.allowed) this.sendAlert(alert);
        }
      }
      alarms.forEach((a) => this.sendAlarm(a));
    } catch (err) {
      // One bad packet must never take the app down.
      this.error(`packet failed: ${err.message}`);
    }
  }

  sendAlert(alert) {
    this.log(`alert ${alert.type} ${alert.severity}`);
    const n = notificationFor(alert, this.config.logLevel, (ms) => this.formatTime(ms));
    this.notify(n.key, n.tokens, 'minimum');
    this.trigger.trigger(tokensFor(alert))
      .catch((err) => this.error(`trigger failed: ${err.message}`));
  }

  // System alarms (fail loud): timeline + Flow trigger "system_alarm".
  sendAlarm(a) {
    const key = a.kind === 'flood' && a.data.capped ? 'alarm.floodCap' : `alarm.${a.kind}`;
    const text = this.homey.__(key, a.data);
    this.log(`alarm ${a.kind} ${a.severity}`);
    if (this.shows(ALARM_LEVEL[a.kind] || 'always')) {
      this.homey.notifications.createNotification({ excerpt: this.stamp(text) })
        .catch((err) => this.error(`notification failed: ${err.message}`));
    }
    this.alarmTrigger.trigger({ kind: a.kind, severity: a.severity, message: text.replace(/\*\*/g, '') })
      .catch((err) => this.error(`trigger failed: ${err.message}`));
  }

  // Does the owner's log level let this go to the timeline?
  shows(level) {
    if (level === 'always') return true;
    const own = (this.config && LOG_RANK[this.config.logLevel]) || LOG_RANK.extended;
    return own >= LOG_RANK[level];
  }

  formatTime(ms) {
    return watch.formatLocal(ms, this.homey.clock.getTimezone());
  }

  // Date and time first, so a push message on the phone says when it happened.
  stamp(text) {
    return `${this.formatTime(Date.now())} - ${text}`;
  }

  notify(key, tokens, level) {
    if (!this.shows(level)) return;
    this.homey.notifications.createNotification({ excerpt: this.stamp(this.homey.__(key, tokens)) })
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
        this.sendAlarm({ kind: 'tamper', severity: 'CRITICAL', data: { key } });
      }
    } catch (err) {
      this.error(`tamper check failed: ${err.message}`);
    }
  }

  // ── Every minute: silence check, daily report, saving ───────────────────────

  everyMinute() {
    try {
      watch.tick(this.watch, Date.now()).forEach((a) => this.sendAlarm(a));
      this.maybeReport();
    } catch (err) {
      this.error(`minute check failed: ${err.message}`);
    }
    this.save();
  }

  localNow() {
    return watch.localTime(Date.now(), this.homey.clock.getTimezone());
  }

  // The first report comes the morning after install, not at once.
  initReportDate() {
    const r = this.homey.settings.get(REPORT_KEY);
    if (!r || typeof r.lastDate !== 'string') {
      const { date, hour } = this.localNow();
      this.homey.settings.set(REPORT_KEY, { v: 1, lastDate: hour >= REPORT_HOUR ? date : '' });
    }
  }

  maybeReport() {
    const { date, hour } = this.localNow();
    const r = this.homey.settings.get(REPORT_KEY) || {};
    if (hour < REPORT_HOUR || r.lastDate === date) return;
    this.homey.settings.set(REPORT_KEY, { v: 1, lastDate: date });
    const tokens = reportTokens(date, watch.takeDay(this.watch), this.statusCounts(), {
      listening: this.listening,
      lastPacket: this.watch.lastPacket,
      now: Date.now(),
      pinSet: Boolean(this.pinRecord),
      sendersSet: this.config.senders.length > 0,
      yes: this.homey.__('report.yes'),
      no: this.homey.__('report.no'),
      never: this.homey.__('report.never'),
    });
    const text = this.homey.__('report.text', tokens);
    this.log('daily report');
    this.homey.notifications.createNotification({ excerpt: text })
      .catch((err) => this.error(`notification failed: ${err.message}`));
    this.reportTrigger.trigger({ report: text.replace(/\*\*/g, '') })
      .catch((err) => this.error(`trigger failed: ${err.message}`));
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
  // With a PIN set, the page unlocks once with the PIN and then uses a session
  // token for changes. Without a PIN, changes need nothing (the page warns).

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
    if (!ok) {
      this.log('wrong PIN');
      return 'wrong';
    }
    if (pin.needsRehash(this.pinRecord)) {
      this.pinRecord = await pin.hashPin(given);
      this.writeGuarded(KEYS.pin, this.pinRecord);
      this.log('PIN hash upgraded');
    }
    return 'ok';
  }

  pinFail(code) {
    return { ok: false, code, triesLeft: pin.MAX_FAILS - (this.pinGuard.fails || 0) };
  }

  // 'ok' when a change may go ahead: no PIN set, or a live session token.
  allowed(token) {
    if (!this.pinRecord) return true;
    return useSession(this.sessions, token, Date.now());
  }

  // Counts and lock state are always shown. Addresses (senders, settings,
  // devices) only to an unlocked page when a PIN is set.
  getStatus(body) {
    const status = {
      listening: this.listening,
      counts: this.statusCounts(),
      pinSet: Boolean(this.pinRecord),
      locked: pin.isLocked(this.pinGuard, Date.now()),
      lockedUntil: this.pinGuard.lockedUntil || 0,
      triesLeft: pin.MAX_FAILS - (this.pinGuard.fails || 0),
      silent: this.watch.silent,
      lastPacket: this.watch.lastPacket,
      unlocked: this.allowed((body || {}).token),
    };
    if (!status.unlocked) return status;
    status.senders = [...this.rx.senders.entries()].map(([ip, x]) => ({
      ip, count: x.count, last: x.last, allowed: x.allowed,
    }));
    status.config = this.config;
    return status;
  }

  getDevices(body) {
    if (!this.allowed((body || {}).token)) return { ok: false, code: 'needUnlock' };
    return { ok: true, devices: deviceList(this.store) };
  }

  unlock(body) {
    return this.serial(async () => {
      if (!this.pinRecord) return { ok: true, code: 'open' };
      const res = await this.tryPin((body || {}).pin);
      if (res !== 'ok') return this.pinFail(res);
      return { ok: true, code: 'unlocked', token: openSession(this.sessions, Date.now()) };
    });
  }

  setPin(body) {
    return this.serial(async () => {
      const { token, newPin } = body || {};
      if (!this.allowed(token)) return { ok: false, code: 'needUnlock' };
      if (!pin.validPin(newPin)) return { ok: false, code: 'invalid' };
      const first = !this.pinRecord;
      this.pinRecord = await pin.hashPin(newPin);
      this.writeGuarded(KEYS.pin, this.pinRecord);
      // Every other open page must unlock with the new PIN.
      this.sessions.clear();
      this.log(first ? 'PIN set' : 'PIN changed');
      this.notify(first ? 'alert.pinSet' : 'alert.pinChanged', {}, 'debug');
      return { ok: true, code: 'pinSaved', token: openSession(this.sessions, Date.now()) };
    });
  }

  removePin(body) {
    return this.serial(async () => {
      if (!this.pinRecord) return { ok: true, code: 'open' };
      if (!this.allowed((body || {}).token)) return { ok: false, code: 'needUnlock' };
      this.pinRecord = null;
      this.writeGuarded(KEYS.pin, null);
      this.sessions.clear();
      this.log('PIN removed');
      this.notify('alert.pinRemoved', {}, 'always');
      return { ok: true, code: 'pinRemoved' };
    });
  }

  deviceAction(body) {
    return this.serial(async () => {
      const { token, mac, action } = body || {};
      if (!this.allowed(token)) return { ok: false, code: 'needUnlock' };
      const code = applyDeviceAction(this.store, mac, action, Date.now());
      if (code !== 'ok') return { ok: false, code };
      this.writeGuarded(KEYS.devices, this.store);
      this.dirty = false;
      this.log(`device ${action}`);
      this.notify(`alert.action.${action}`, { mac: String(mac).toLowerCase().replace(/-/g, ':') }, 'debug');
      return { ok: true, code: 'done' };
    });
  }

  setConfig(body) {
    return this.serial(async () => {
      const { token, config } = body || {};
      if (!this.allowed(token)) return { ok: false, code: 'needUnlock' };
      const clean = checkConfig(config);
      if (!clean) return { ok: false, code: 'invalid' };
      this.config = clean;
      this.writeGuarded(KEYS.config, this.config);
      this.log('settings changed');
      this.notify('alert.configChanged', {}, 'debug');
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
