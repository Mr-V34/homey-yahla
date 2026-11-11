'use strict';

// Neutral, made-up CEF lines shaped like UniFi Network client events.
// No real addresses: MACs are locally administered (02:...), IPs are examples.

function cef(name, ext) {
  return `<14>Jan  1 12:00:00 gateway CEF:0|Ubiquiti|UniFi Network|10.0.0|400|${name}|2|${ext}`;
}

const WIFI_JOIN = cef('WiFi Client Connected',
  'UNIFIcategory=Monitoring UNIFIclientMac=02:00:00:00:00:01 UNIFIclientIp=192.168.1.50 '
  + 'UNIFInetworkName=Home UNIFInetworkVlan=10 UNIFIconnectedToDeviceName=Hall AP UNIFIwifiName=Example');

const WIFI_LEAVE = cef('WiFi Client Disconnected',
  'UNIFIclientMac=02:00:00:00:00:01 UNIFIclientIp=192.168.1.50 UNIFInetworkName=Home UNIFInetworkVlan=10 '
  + 'UNIFIlastConnectedToDeviceName=Hall AP');

const WIRED_JOIN = cef('Wired Client Connected',
  'UNIFIclientMac=02:00:00:00:00:02 UNIFIclientIp=192.168.1.51 UNIFInetworkName=IoT UNIFInetworkVlan=20 '
  + 'UNIFIconnectedToDeviceName=Office Switch UNIFIconnectedToDevicePort=4');

const ADMIN_LOGIN = cef('Admin Accessed UniFi Network', 'UNIFIadmin=someone UNIFIaccessMethod=web');

// A client hides a second MAC in its hostname.
const FORGED = cef('WiFi Client Connected',
  'UNIFIclientMac=02:00:00:00:00:03 UNIFIclientHostname=x UNIFIclientMac=02:00:00:00:00:04 UNIFInetworkVlan=10');

const NO_MAC = cef('WiFi Client Connected', 'UNIFIclientIp=192.168.1.52 UNIFInetworkVlan=10');

function joinOn(mac, vlan, network = 'Net') {
  return cef('WiFi Client Connected', `UNIFIclientMac=${mac} UNIFIclientIp=192.168.1.60 UNIFInetworkName=${network} UNIFInetworkVlan=${vlan}`);
}

module.exports = {
  cef, WIFI_JOIN, WIFI_LEAVE, WIRED_JOIN, ADMIN_LOGIN, FORGED, NO_MAC, joinOn,
};
