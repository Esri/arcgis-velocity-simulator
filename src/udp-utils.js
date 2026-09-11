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

function isUdpClientRegistrationMessage(message) {
  return Buffer.isBuffer(message) && message.equals(UDP_CLIENT_REGISTRATION_BYTES);
}

/**
 * Announces a receiving UDP client to a server that learns reply endpoints from
 * inbound datagrams.
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

module.exports = {
  UDP_CLIENT_REGISTRATION_MESSAGE,
  isUdpClientRegistrationMessage,
  registerUdpClient,
};
