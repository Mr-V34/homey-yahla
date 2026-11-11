# YAHLA Network Guard for Homey

**Know when a stranger joins your network.**

YAHLA (Yet Another Homey Log Analyser) is a Homey Pro app that listens to the network logs your
UniFi network already sends. When a device that you have not approved joins the network,
YAHLA tells you in the Homey timeline and starts your Flows.

The source is public so that anyone can see exactly what the app does with the data it receives.

## What it does

- Receives syslog on UDP port 5514 and reads client events (device joined, device left).
- Keeps a small list of known devices: new, approved or ignored. Nothing in a log line can approve a
  device; only the owner can, on the settings page.
- Alerts on a new device, on an unapproved device that comes back (at most once a day), and at once
  when an unapproved device moves to another network.
- Watches itself and raises an alarm when the logs stop, when it is flooded with events, when a
  packet looks forged, or when its settings are changed from outside the app.
- Sends a daily report at 07:00. If the report does not come, YAHLA is not working.

Today YAHLA reads UniFi Network client events (the "Activity Logging (SIEM server)" export).
Other log formats are counted and reported, never guessed.

## What it does not do

- It never scans the network, never sends anything to your devices and never blocks anything.
- It does not use the cloud. Everything stays on your Homey.
- It needs no Homey permissions.

## Setup

1. Install YAHLA on your Homey Pro.
2. In UniFi Network, open the Activity Logging setting for a SIEM server (under CyberSecure or
   Control Plane, depending on your version) and enter your Homey's IP address and port `5514`.
   In the UniFi versions we have used, this setting takes one address only, so it replaces any
   other log server you send to.
3. Open the YAHLA settings page in the Homey app (Settings, Apps, YAHLA):
   - set a PIN right away (until a PIN is set, anyone who can open the page can set one),
   - under "Allowed senders", add the address your logs come from (the page lists the senders it
     has seen, for example `192.168.1.1`). Until you do, logs from any address are accepted,
   - approve the devices you know as they appear.
4. Use the Flow cards to decide what happens:
   - **An unapproved device was seen** (tokens: type, severity, MAC, IP, network, where, name)
   - **YAHLA raised an alarm** (tokens: kind, severity, message)
   - **YAHLA daily report is ready** (token: report)

## Notifications on your phone

YAHLA writes its alerts to the Homey timeline. Whether they also reach your phone as a push message is a
Homey setting, not a YAHLA one: in the Homey app, open the timeline settings and turn on push for YAHLA.
That is all most people need; no Flow is required.

Flows add more when you want it, for example:

- **YAHLA raised an alarm** with severity `CRITICAL` (settings changed from outside, a flood, cannot listen)
  → *Send a critical alert*, which also sounds when the phone is silent or in a Focus mode.
- **YAHLA daily report is ready** → set a Yes/No variable; a second Flow at 07:15 sends a push when the
  variable is still No, so you hear about it when YAHLA itself has stopped.

## Security model, plainly

- **Approval needs the owner.** With a PIN set, the settings page asks for it and stays unlocked for
  15 minutes after it was last used. Without the PIN the app's API only gives counts: no device
  list, no addresses and no changes. Five wrong tries lock it for 15 minutes. Only a salted
  PBKDF2-SHA256 hash of the PIN is stored.
- **Who can reach the app at all.** Tested on Homey Pro firmware 13.5: Homey blocks the Guest and
  regular user roles from the app's API. Managers most likely can reach it (not tested), which is
  what the PIN is for.
- **A lock can be abused.** Anyone who can reach the API can enter wrong PINs on purpose and keep
  the owner locked out, 15 minutes at a time. This cannot be prevented without weakening the lock;
  the timeline shows the wrong tries at the Debug level.
- **Outside changes are undone.** If the device list, settings or PIN are changed directly
  through Homey's API while the app runs, YAHLA restores its own copy and raises an alarm.
  Changes made while the app is stopped cannot be seen.
- **Everything in a packet is hostile.** Addresses are checked strictly, names are reduced to plain
  text, packets over 16 KB or above 6000 a minute are dropped, and a client event with repeated
  identity fields is treated as forged.
- **Known limits.** A device that copies the MAC address of an approved device is not detected.
  UDP senders can be faked from the same network, so "allowed senders" cuts noise but is no proof,
  and with an empty list every sender is accepted.
  The name a device gives itself can be anything; YAHLA shows it, never trusts it.

## Privacy

YAHLA stores, on your Homey only: per device the MAC address, the name it gives itself, last IP,
network, place, first and last seen. It keeps no event history and at most 500 devices. The app log
holds counts only, never addresses.

## Development

No dependencies. Tests use made-up addresses only.

```sh
npm test
homey app validate --level publish
```

## Licence and credits

MIT, see [LICENSE](LICENSE). Author: Peter Persson (Mr-V34). Contributor: B.Frank.
