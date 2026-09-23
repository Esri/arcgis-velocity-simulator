/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const UDP_CLIENT_REGISTRATION_MESSAGE = 'UDP Client connected';
const UDP_CLIENT_REGISTRATION_BYTES = Buffer.from(UDP_CLIENT_REGISTRATION_MESSAGE);
const DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS = 30000;
const MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS = 2147483647;
const { assertUdpPayloadSize } = require('./payload-format-utils');

function encodeUdpPayload(data, format, appendNewline = false) {
  const payload = appendNewline && format === 'delimited' ? `${data}\n` : data;
  assertUdpPayloadSize(payload);
  return Buffer.from(payload);
}

function isUdpClientRegistrationMessage(message) {
  return Buffer.isBuffer(message) && message.equals(UDP_CLIENT_REGISTRATION_BYTES);
}

/**
 * Custom app-pair convention, not UDP or ArcGIS Velocity behavior: announces a
 * receiving Logger client to a Simulator server that learns reply endpoints.
 *
 * @param {import('dgram').Socket} socket connected UDP socket
 * @returns {Promise<void>}
 */
function registerUdpClient(socket) {
  return new Promise((resolve, reject) => {
    socket.send(Buffer.from(UDP_CLIENT_REGISTRATION_MESSAGE), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function startUdpClientRegistration(socket, {
  intervalMs = DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  onError,
} = {}) {
  if (!socket || typeof socket.send !== 'function') {
    throw new TypeError('UDP client registration requires a socket with a send method.');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1
      || intervalMs > MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS) {
    throw new RangeError(
      `UDP client registration interval must be between 1 and ${MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS} milliseconds.`
    );
  }
  if (typeof onError !== 'function') {
    throw new TypeError('UDP client registration onError must be a function.');
  }

  let stopped = false;
  let timer = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(renew, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  };
  const renew = () => {
    if (stopped) return;
    registerUdpClient(socket).then(schedule, (error) => {
      if (stopped) return;
      try {
        onError(error);
      } catch (callbackError) {
        stop();
        queueMicrotask(() => { throw callbackError; });
        return;
      }
      schedule();
    });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const ready = registerUdpClient(socket)
    .then(() => {
      schedule();
    })
    .catch((error) => {
      stop();
      throw error;
    });

  return { ready, stop };
}

module.exports = {
  encodeUdpPayload,
  DEFAULT_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  MAX_UDP_CLIENT_REGISTRATION_INTERVAL_MS,
  UDP_CLIENT_REGISTRATION_MESSAGE,
  isUdpClientRegistrationMessage,
  registerUdpClient,
  startUdpClientRegistration,
};
