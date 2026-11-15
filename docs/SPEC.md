# YAHLA Network Guard: system spec

Blueprint of the app `com.v34.yahla` as it is after version 0.3.0. Written 2026-11-15 from the real code. B.Frank.

**Who reads this:** whoever writes the code. Names here are exact: copy them, never retype from memory. If
something you need is missing or unclear, stop and ask. Do not guess.

**This file must stay true.** A change to settings, stored data, Web API routes, Flow cards or a function
contract updates this file in the same piece of work. A spec that disagrees with the code is a bug.

---

## 0. Rules for the coder

1. Change only what the work order says. No refactors, no renamed things, no "improvements".
2. No npm dependencies. No `eval`, no `new Function`. JSON only through `JSON.parse`.
3. Everything from a packet, from the settings page and from stored settings is untrusted. Validate before use.
4. Logs hold counts and codes only. Never a MAC, IP, name or PIN in `this.log` / `this.error`.
5. Timers only through `this.homey.setInterval` / `this.homey.setTimeout`, cleared in `onUninit`.
6. Every text a user can see exists in `locales/en.json` and `locales/sv.json` with the same keys.
7. Files under `lib/` are pure: no `homey`, no timers, no clock. Time comes in as a parameter (`now`, ms).
   Only `app.js` and `api.js` touch Homey. `lib/pin.js` and `lib/session.js` may use `crypto`.
8. Tests: `npm test` (node:test). Test data uses made-up addresses only: MACs `02:00:00:...`, IPs `192.168.1.x`.
9. Done means: `npm test` passes, `homey app validate --level publish` passes, and what was not run on a real
   Homey is listed as "not seen live".
10. No tool or model names anywhere. Credit is B.Frank.

---

## 1. Overview

YAHLA listens for syslog on UDP port 5514, turns client lines (a device joined or left) into one neutral event
shape, and alerts when a device the owner has not approved shows up. It never sends anything to the network.

Who decides what:

- **Parsers** (`lib/parsers/`) decide whether a line is a client event. Unknown formats are counted, never guessed.
- **Detector** (`lib/detector.js`) decides whether an event gives a device alert.
- **Watch** (`lib/watch.js`) decides system alarms (silence, flood, unknown, forged) and caps device alerts.
- **The owner** decides approval, on the settings page only. Nothing in a packet can approve a device.
- **app.js** wires it together: socket, storage, timeline notifications, Flow triggers, Web API.

---

## 2. File tree

```
.homeycompose/app.json                    manifest source (app.json is generated from it; never edit app.json)
.homeycompose/flow/triggers/unknown_device.json   Flow trigger for device alerts
.homeycompose/flow/triggers/system_alarm.json     Flow trigger for system alarms
.homeycompose/flow/triggers/daily_report.json     Flow trigger for the daily report (the heartbeat)
app.js                 socket, storage, tamper guard, minute tick, notifications, Web API methods
api.js                 Web API routes; each only forwards `body` to the app method of the same name
lib/event.js           field checks for everything that comes from a packet; private-address check
lib/parsers/index.js   picks the parser whose mark comes first in the line
lib/parsers/unifi-cef.js     UniFi Network CEF client events
lib/parsers/dnsmasq-dhcp.js  dnsmasq DHCPACK lines (ASUS, OpenWrt)
lib/parsers/wifi-ap.js       hostapd and ASUS wlceventd join/leave lines
lib/receiver.js        one UDP packet -> counters + parse result (sender filter, size cap, rate cap)
lib/registry.js        the device store: load, migrate, make room, network key
lib/detector.js        the alert rules
lib/hold.js            holds a Wi-Fi-only alert up to 10 s for the DHCP line
lib/watch.js           silence, flood, unknown, forged, alert cap, day counters, local time text
lib/report.js          builds the daily report text
lib/alerts.js          Flow tokens and timeline text for a device alert
lib/config.js          owner settings: check, load, migrate
lib/admin.js           owner actions on the device list
lib/guard.js           tamper guard for stored settings
lib/pin.js             PIN hash and lock-out
lib/session.js         unlocked settings-page sessions
settings/index.html    the settings page
locales/en.json, locales/sv.json   all texts
README.txt, README.sv.txt          store text (plain text, two short paragraphs)
.homeychangelog.json   store changelog, en and sv
docs/                  this spec and the manual (kept out of the build by .homeyignore)
test/                  node:test files (kept out of the build)
tools/send-cef.js      sends a made-up test line (kept out of the build)
```

---

## 3. Data model and state

### 3.1 App settings (persisted with `this.homey.settings`)

| Key | Type and format | Written by | Empty / missing means |
|---|---|---|---|
| `devices` | `{ v: 3, devices: { "<mac>": Device } }` | app.js `writeGuarded` | no devices yet |
| `config` | Config, see below | app.js `writeGuarded` | defaults |
| `pin` | `{ v: 2, salt: 32 hex, hash: 64 hex, it: integer }` or `null` (v 1 = old scrypt record, still accepted) | app.js `writeGuarded` | no PIN: changes need no unlock |
| `pinGuard` | `{ fails: number, lockedUntil: ms }` | app.js `writeGuarded` | `{ fails: 0, lockedUntil: 0 }` |
| `stats` | `{ v: 1, ...counters, new, approved, ignored, at: ISO text }` | app.js `save` | nothing reads it; for support only |
| `report` | `{ v: 1, lastDate: "YYYY-MM-DD" or "" }` | app.js | first report comes the next time the report hour is reached |

`devices`, `config`, `pin` and `pinGuard` are **guarded**: a write from outside the app is undone (section 4.9).

**Device** (key = MAC, lower case, colons):

| Field | Type | Meaning |
|---|---|---|
| `s` | `'new'` \| `'approved'` \| `'ignored'` | state |
| `f` | ms | first seen |
| `l` | ms | last seen |
| `n` | text or `null` | last network key: `vlan:<0-4094>` or `name:<label>` |
| `a` | ms or `null` | time of the last alert |
| `i` | text (max 45) or `null` | last IP |
| `w` | text (max 48) or `null` | last place (access point, switch port, radio) |
| `h` | text (max 48) or `null` | the name the device gives itself |

At most 500 devices (`MAX_DEVICES`). Store versions: 1 (no `i`, `w`, `h`), 2 (no `h`), 3 (current).

**Config** (version 3):

| Field | Type | Rule | Default |
|---|---|---|---|
| `v` | number | `3` | 3 |
| `senders` | array of IPv4 text | max 5, no duplicates; empty = accept every sender | `[]` |
| `severity` | `{ "<network key>": level }` | max 32 keys; key matches `KEY_RE`; level in `LEVELS` | `{}` |
| `defaultSeverity` | level | in `LEVELS`, never `'NONE'` | `'HIGH'` |
| `logLevel` | `'minimum'` \| `'extended'` \| `'debug'` | | `'extended'` |
| `report` | `'off'` \| `'short'` \| `'full'` | what the daily report writes to the timeline | `'short'` |
| `reportHour` | integer 0-23 | local hour (Homey's time zone) of the daily report | `7` |

`LEVELS = ['NONE', 'INFO', 'WARNING', 'HIGH', 'CRITICAL']`. Config versions: 1 (no `logLevel`), 2 (no `report`,
`reportHour`), 3 (current). Migration fills the defaults above.

### 3.2 State in memory only (lost at restart)

| Name (on the app object) | What |
|---|---|
| `rx` | receiver: `counters` (`packets, oversize, rate, foreign, unknown, bad, skip, events, named`), per-minute rate, up to 10 seen senders, `last` outcome |
| `watch` | `startedAt`, `lastPacket`, `silent`, flood buckets, alert times, last alarm per kind, `day` counters, `dayStart` (ms when the day counters were started) |
| `held` | Map mac -> `{ alert, due }`, max 50 |
| `sessions` | Map token -> last use, max 5, idle limit 15 min |
| `guard` | what the app last wrote for each guarded key (JSON text) |
| `saveNow`, `saveLater` | booleans: the device list has a change that must be saved soon / may wait |
| `lastSlowSave` | ms of the last slow save (device list for `saveLater`, and `stats`) |
| `socket`, `listening`, `socketDown` | the UDP socket or `null`; bound or not; a socket alarm is open |

### 3.3 The neutral event

`{ mac, ip, network, vlan, where, name, kind, at, source }`

- `mac` valid, lower case. `ip` IPv4/IPv6 text or `null`. `network`, `where`, `name` plain labels or `null`.
- `vlan` 0-4094 or `null`. `kind` `'join'` or `'leave'`. `at` = time of receipt (ms). `source` = parser id:
  `'unifi-cef'`, `'dnsmasq-dhcp'` or `'wifi-ap'`.

### 3.4 Alerts and alarms

- **Device alert:** `{ type, severity, event, first }`. `type`: `'new'`, `'unapproved'`, `'hop'`, `'full'`.
- **System alarm:** `{ kind, severity, data }`. Kinds and when they reach the timeline:

| kind | severity | data | timeline level |
|---|---|---|---|
| `silence` | HIGH | `{ minutes }` | always |
| `resumed` | INFO | `{}` | debug |
| `flood` | CRITICAL | `{ fresh, events }` or `{ capped }` | always |
| `unknown` | WARNING | `{}` | debug |
| `forged` | HIGH | `{}` | extended |
| `tamper` | CRITICAL | `{ key }` | always |
| `socket` | CRITICAL | `{ code }` | always |
| `socketBack` | INFO | `{}` | always |
| `storeProblem` | HIGH | `{ what, problem }`; `what` is `'devices'`, `'config'` or `'pin'` | always |

Every system alarm always fires the Flow trigger `system_alarm`, whatever the timeline level.

### 3.5 Constants

| Name | Value | File |
|---|---|---|
| `PORT` | 5514 | app.js |
| `SAVE_MS` | 60 000 (the minute tick) | app.js |
| `SLOW_SAVE_MS` | 15 min | app.js |
| `TAMPER_NOTE_MS` | 60 000 | app.js |
| `MAX_PACKET` / `MAX_PER_MINUTE` / `MAX_SENDERS_SEEN` | 16384 / 6000 / 10 | lib/receiver.js |
| `MAX_DEVICES` | 500 | lib/registry.js |
| `COOLDOWN_MS` | 24 h | lib/detector.js |
| `HOLD_MS` / `MAX_HELD` | 10 s / 50 | lib/hold.js |
| `SILENCE_MS` | 30 min | lib/watch.js |
| `FLOOD_NEW` / `FLOOD_EVENTS` / `FLOOD_WINDOW_MS` | 10 / 100 / 10 min | lib/watch.js |
| `ALERT_CAP` / `ALERT_WINDOW_MS` | 20 / 10 min | lib/watch.js |
| `SYSTEM_COOLDOWN_MS` | 60 min | lib/watch.js |
| `MAX_FAILS` / `LOCK_MS` | 5 / 15 min | lib/pin.js |
| `IDLE_MS` / `MAX_SESSIONS` | 15 min / 5 | lib/session.js |

### 3.6 Flow cards (triggers, no arguments)

| id | Tokens (all strings) |
|---|---|
| `unknown_device` | `type`, `severity`, `mac`, `ip`, `network`, `where`, `name` (missing value = `-`) |
| `system_alarm` | `kind`, `severity`, `message` |
| `daily_report` | `report` |

Token values `type`, `severity` and `kind` are fixed codes in English (for use in logic cards); each card's
hint lists them.

### 3.7 Web API (all POST, none public; body is untrusted)

| Route | App method | Body | Answer |
|---|---|---|---|
| `/status` | `getStatus` | `{ token }` | counts and lock state always; `senders` and `config` only when unlocked |
| `/devices` | `getDevices` | `{ token }` | `{ ok, devices }` or `{ ok: false, code: 'needUnlock' }` |
| `/unlock` | `unlock` | `{ pin }` | `{ ok, code: 'unlocked', token }`, `{ ok, code: 'open' }` or a PIN failure |
| `/pin` | `setPin` | `{ token, newPin }` | `{ ok, code: 'pinSaved', token }`, `needUnlock` or `invalid` |
| `/pin/remove` | `removePin` | `{ token }` | `{ ok, code: 'pinRemoved' }`, `open` or `needUnlock` |
| `/device` | `deviceAction` | `{ token, mac, action }` | `{ ok, code: 'done' }`, `needUnlock`, `invalid` or `unknown_device` |
| `/config` | `setConfig` | `{ token, config }` | `{ ok, code: 'done' }`, `needUnlock` or `invalid` |

"Unlocked" = no PIN is set, or `token` is a live session. PIN failure = `{ ok: false, code, triesLeft }` with
code `'wrong'`, `'locked'` or `'noPin'`.

---

## 4. Function contracts

### 4.1 lib/event.js

- `normalizeMac(value)` -> lower-case colon MAC or `null`. Accepts `-` as separator, trims.
- `validIp(value)` -> the IP text or `null`.
- `boundedInt(value, low, high)` -> number or `null`; input must be a text of 1-5 digits.
- `safeLabel(value, limit = 48, allowColon = false)` -> plain label or `null`. Control characters are removed,
  anything but letters, digits, space, `.`, `_`, `-` (and `:` when allowed) becomes `?`.
- `isPrivateMac(mac)` -> `true` when the MAC is a locally administered ("private", often random) address: the
  second hex digit of a normalised MAC is `2`, `6`, `a` or `e`. Input is an already normalised MAC; anything
  else gives `false`.

### 4.2 lib/parsers

- `parseText(text, at)` (index.js) -> `{ result: 'event', event }`, `{ result: 'skip' }`, `{ result: 'bad', reason }`
  or `{ result: 'unknown' }`. The parser whose mark comes first in the line gets the line.
- Each parser: `parse(text, at)` -> `null` (not my format) or one of the results above, never `'unknown'`.
- Parsers get the text **with line endings already removed** (the receiver does that, section 4.3).

### 4.3 lib/receiver.js

- `createReceiver()` -> the `rx` state.
- `handlePacket(rx, buf, now, senderIp = null, config = null)` -> event or `null`; sets `rx.last` to
  `'foreign'`, `'dropped'`, `'event'`, `'skip'`, `'unknown'` or `'bad'`. Steps:
  1. `packets += 1`.
  2. With a `senderIp`: note the sender; when not allowed by `config`: `foreign += 1`, last `'foreign'`, return `null`.
  3. Not a Buffer or longer than `MAX_PACKET`: `oversize += 1`, last `'dropped'`, return `null`.
  4. More than `MAX_PER_MINUTE` in this minute: `rate += 1`, last `'dropped'`, return `null`.
  5. Text = the buffer as UTF-8 with every trailing space and control character removed (character code
     32 or lower, which covers line feed, carriage return and NUL). Syslog senders differ: some end a line
     with a line feed, some with NUL. This is done with a loop from the end (`stripEnd`), never with a
     regex: `/[\s\0]+$/` needs about n * n steps for a packet full of blanks.
  6. `parseText(text, now)`; count the result; return the event or `null`.

### 4.4 lib/registry.js

- `loadStore(input)` -> `{ store, problem }`; problem `null`, `'empty'`, `'unknown_version'` or `'dropped'`.
  Migrates v1 and v2 to v3. Invalid devices are dropped.
- `makeRoom(store)` -> `true` when a new device fits (drops the oldest `'new'` device when full), else `false`.
- `networkKey(event)` -> `vlan:<n>`, `name:<label>` or `null`.

### 4.5 lib/detector.js

- `handleEvent(store, event, config)` -> device alert or `null`. Changes the store. Rules:
  1. Unknown MAC: make room (no room -> alert `'full'`, CRITICAL); add as `'new'`; alert `'new'` unless the
     network's level is `'NONE'`.
  2. Known MAC: update `l`, and `n`, `i`, `w`, `h` when the event has them.
  3. No alert unless state is `'new'` and the event is a `'join'`.
  4. Alert `'hop'` when the network key changed; alert `'unapproved'` when the last alert is 24 h old or `null`.
     Never when the level is `'NONE'`. An alert sets `a = now`.

### 4.6 lib/hold.js

- `holdAlert(held, alert, now)` -> `true` when held (only alerts whose event source is `'wifi-ap'`).
- `fillHeld(held, event, config)` -> the held alert filled with this event's IP, name and network, or `null`.
- `takeDue(held, now)` -> alerts whose 10 s are over. `nextDue(held)` -> ms or `Infinity`.

### 4.7 lib/watch.js

- `createWatch(now)` -> state with `startedAt = now`, `dayStart = now`, empty day counters.
- `notePacket(w, now, outcome)`, `noteResult(w, now, result)`, `noteEvent(w, now, isNew)` -> array of alarms.
- `allowDeviceAlert(w, now)` -> `{ allowed, alarms }` (cap 20 per 10 min).
- `tick(w, now)` -> `[silence alarm]` once per silent period, else `[]`.
- `takeDay(w, now)` -> the day counters plus `since` (the old `dayStart`); then starts new counters with
  `dayStart = now`.
- `localTime(now, timeZone)` -> `{ date: 'YYYY-MM-DD', hour }`. `formatLocal(ms, timeZone)` -> `'YYYY-MM-DD HH:MM'`
  or `'-'`.

### 4.8 lib/report.js

`reportText(mode, d, tr)` -> the report text.

- `mode`: `'short'` or `'full'`.
- `d`: `{ listening: boolean, silent: boolean, lastPacket: text or null, since: text, accepted, newDevices,
  events, unknown, alerts, suppressed, alarms, foreign, fresh, approved, ignored }` (the last twelve are
  numbers; `events` and `unknown` are the day counters of client events and lines in no known format;
  `lastPacket` and `since` are already formatted local times).
- `tr(key, tokens)` -> text (the app passes `this.homey.__`). Every token value is passed as a string.

Steps:

1. First line, the first rule that matches:
   - `!d.listening` -> `tr('report.noSocket')` (the port on the Homey is the cause, not the router);
   - `d.silent || d.lastPacket === null` -> `tr('report.problem', { last: d.lastPacket ?? tr('report.never') })`;
   - `d.events === 0 && d.unknown > 0` -> `tr('report.unreadable', { since, packets: accepted, unknown })`
     (logs arrive but YAHLA cannot read them, so no device is checked);
   - else -> `tr('report.ok', { since, packets: accepted, newDevices })`.
2. `mode === 'short'`: return the first line.
3. Else lines = first line, `tr('report.devices', { fresh, approved, ignored })`, `tr('report.alerts', { alerts })`;
   then only when the number is above 0: `tr('report.suppressed', { suppressed })`,
   `tr('report.alarms', { alarms })`, `tr('report.foreign', { foreign })`. Return the lines joined with `\n`.

The report never holds an address or a name.

### 4.9 app.js

- `onInit()`: load store, config, PIN and PIN guard; a stored value that cannot be read gives a
  `storeProblem` alarm (`what`: `'devices'`, `'config'`, or `'pin'` when a `pin` value exists but is not a valid
  record); write the loaded values back (this migrates old versions); start the tamper guard; `openSocket()`;
  start the minute tick.
- `openSocket()`: create a `udp4` socket, bind `PORT`. On `listening`: `listening = true`; when `socketDown`
  is set, clear it and send alarm `socketBack`. On `error` (only from the socket that is current): close it,
  and when `socketDown` is not set: log `socket error: <code>`, set it and send alarm `socket`. So one log line
  and one alarm per outage, not one per try; the retry every minute is silent.
- `everyMinute()`: when `socket` is `null`, call `openSocket()` (retry); `watch.tick`; `maybeReport()`; `save()`.
- `onPacket(buf, rinfo)`: receiver -> watch -> detector -> hold -> alert. After `handleEvent`: a new device or
  a returned alert sets `saveNow`; any other event sets `saveLater`. Never throws.
- `save(force = false)`: write `devices` when `saveNow`, or when `saveLater` and `SLOW_SAVE_MS` has passed
  since `lastSlowSave`, or when `force` and either flag is set. Write `stats` when the counters changed and
  (`SLOW_SAVE_MS` has passed or `force`). `onUninit` calls `save(true)`.
- `maybeReport()`: `{ date, hour }` = local time. Return when `hour < config.reportHour` or the stored
  `lastDate` equals `date`. Else store `lastDate = date`, build the text with
  `reportText(config.report === 'full' ? 'full' : 'short', ...)` (with `events` and `unknown` from the day
  counters), write it to the timeline (with the date-time
  stamp) unless `config.report === 'off'`, and **always** fire `daily_report` with the text (without `**`).
- `initReportDate()`: with no stored `lastDate`: store today's date when `hour >= config.reportHour`, else `''`.
- `sendAlert(alert)`: timeline text (level `'minimum'`) + trigger `unknown_device`. In the timeline text a
  private MAC is followed by the note `alert.privateNote`; the Flow token `mac` stays the bare MAC.
- `sendAlarm(a)`: timeline when the level allows + trigger `system_alarm`. For `storeProblem` the `what` code
  is shown as the text `alarm.what.<code>`.
- `writeGuarded(key, value)` / `checkTamper(key)`: the app remembers what it wrote; a guarded key that changes
  to anything else is written back and gives a `tamper` alarm (at most one per key per minute).
- Web API methods: section 3.7. Every method that checks or changes the PIN, the device list or the config
  runs through `serial()` (one at a time).
- `onUninit()`: clear timers, remove listeners, `save(true)`, close the socket.

### 4.10 Other lib files

- `lib/config.js`: `checkConfig(input)` -> clean config or `null` (never half applied);
  `loadConfig(input)` -> `{ config, problem }`; `severityFor(config, networkKey)`; `senderAllowed(config, ip)`.
- `lib/admin.js`: `applyDeviceAction(store, mac, action, now)` -> `'ok'`, `'invalid'` or `'unknown_device'`;
  `deviceList(store)`.
- `lib/alerts.js`: `tokensFor(alert)`; `notificationFor(alert, logLevel, formatTime, privateNote)` ->
  `{ key, tokens }` where `tokens.mac` has `privateNote` appended when `isPrivateMac(event.mac)`.
- `lib/guard.js`, `lib/pin.js`, `lib/session.js`: see the comments at the top of each file.

### 4.11 Settings page (`settings/index.html`)

- Shows status, the router list, the unlock box (when a PIN is set and the page is locked), and when unlocked:
  new devices, known devices, allowed senders, timeline level, daily report (mode and hour), alert level per
  network, PIN.
- Everything from the app is put on the page with `textContent`, never as HTML.
- Homey-styled elements are hidden with `element.style.display`, never with a CSS class.
- No `Homey.confirm`: its callback did not run on the real Homey. Confirm with a second press.
- One save for the whole config: the body of `/config` always holds all six fields.

---

## 5. What must stay true after every change

1. Nothing in a packet can approve a device, change a setting or reach the timeline as markup.
2. An old installation keeps its devices, approvals, settings and PIN after an update (migrate, never reset).
3. A value the app cannot read is never used and never silent: defaults plus a `storeProblem` alarm.
4. Fail loud: when YAHLA cannot do its job (no socket, no logs, flood) the owner is told, whatever the timeline
   level. The Flow triggers always fire.
5. Growth is capped: 500 devices, 10 seen senders, 5 sessions, 50 held alerts, 16 KB per packet, 6000 packets
   a minute. Nothing is kept as history.
6. No address, name or PIN in the app log. The daily report holds counts only.
7. Flow card ids and token names never change (users' Flows depend on them). Titles and hints may.
8. en and sv have the same keys, and no raw key is ever shown.
9. No permissions, no dependencies, no cloud.
