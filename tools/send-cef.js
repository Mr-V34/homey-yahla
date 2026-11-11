'use strict';

// Sends made-up UniFi-style CEF client events, for testing YAHLA.
// Usage: node tools/send-cef.js <host> <join|leave|junk|forged> <last MAC byte 00-ff> [vlan=10] [port=5514]
// Example: node tools/send-cef.js 192.168.1.50 join 0a
// MACs are always 02:00:00:00:00:xx (locally administered, never a real device).

const dgram = require('dgram');

const [host, kind, byte, vlanArg, portArg] = process.argv.slice(2);
if (!/^[0-9.]{7,15}$/.test(host || '') || !['join', 'leave', 'junk', 'forged'].includes(kind)
  || !/^[0-9a-f]{2}$/.test(byte || '')) {
  console.error('Usage: node tools/send-cef.js <IPv4 host> <join|leave|junk|forged> <00-ff> [vlan] [port]');
  process.exit(1);
}
const vlan = /^\d{1,4}$/.test(vlanArg || '') ? vlanArg : '10';
const port = /^\d{1,5}$/.test(portArg || '') ? Number(portArg) : 5514;
const mac = `02:00:00:00:00:${byte}`;

const head = '<14>Jan  1 12:00:00 test CEF:0|Ubiquiti|UniFi Network|10.0.0|400|';
const lines = {
  join: `${head}WiFi Client Connected|2|UNIFIclientMac=${mac} UNIFIclientIp=192.168.1.50 UNIFInetworkName=Test UNIFInetworkVlan=${vlan} UNIFIconnectedToDeviceName=Test AP`,
  leave: `${head}WiFi Client Disconnected|2|UNIFIclientMac=${mac} UNIFInetworkName=Test UNIFInetworkVlan=${vlan}`,
  junk: 'this is not a log line',
  forged: `${head}WiFi Client Connected|2|UNIFIclientMac=${mac} UNIFIclientHostname=x UNIFIclientMac=02:00:00:00:00:ff`,
};

const sock = dgram.createSocket('udp4');
sock.send(Buffer.from(lines[kind]), port, host, (err) => {
  console.log(err ? `send error: ${err.code}` : `sent ${kind} for ${kind === 'junk' ? '-' : mac} (vlan ${vlan})`);
  sock.close();
});
