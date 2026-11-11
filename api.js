'use strict';

// Web API for the settings page. Routes are protected by Homey (none public).
// Every body is untrusted: the app checks each field, and every change needs the PIN.

module.exports = {
  async getStatus({ homey }) {
    return homey.app.getStatus();
  },

  async getDevices({ homey }) {
    return homey.app.getDevices();
  },

  async setPin({ homey, body }) {
    return homey.app.setPin(body);
  },

  async deviceAction({ homey, body }) {
    return homey.app.deviceAction(body);
  },

  async setConfig({ homey, body }) {
    return homey.app.setConfig(body);
  },
};
