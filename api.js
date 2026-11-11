'use strict';

// Web API for the settings page. Routes are protected by Homey (none public).
// Every body is untrusted: the app checks each field. With a PIN set, every
// change needs a session token from /unlock.

module.exports = {
  async getStatus({ homey }) {
    return homey.app.getStatus();
  },

  async getDevices({ homey }) {
    return homey.app.getDevices();
  },

  async unlock({ homey, body }) {
    return homey.app.unlock(body);
  },

  async setPin({ homey, body }) {
    return homey.app.setPin(body);
  },

  async removePin({ homey, body }) {
    return homey.app.removePin(body);
  },

  async deviceAction({ homey, body }) {
    return homey.app.deviceAction(body);
  },

  async setConfig({ homey, body }) {
    return homey.app.setConfig(body);
  },
};
