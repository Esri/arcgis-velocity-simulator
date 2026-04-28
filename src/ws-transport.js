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

/**
 * @file ws-transport.js
 * @description
 * WebSocket (ws:// / wss://) transport for the ArcGIS Velocity Simulator and Logger.
 *
 * Supports the same data formats as HTTP (matching Velocity WebSocket feed):
 *   - delimited   (text/plain)        — CSV rows, default
 *   - json        (application/json)
 *   - esri-json   (application/json)
 *   - geo-json    (application/geo+json)
 *   - xml         (application/xml)
 *
 * Client mode: Connects to a remote WebSocket server, sends/receives text frames.
 * Server mode: Hosts a WebSocket server that accepts connections and broadcasts
 *              data to all connected clients.
 *
 * Extra controls (matching Velocity WebSocket feed capabilities):
 *   - Subscription message: sent to the server immediately after connecting.
 *   - Ignore first message: skips the first message received (e.g. subscription ack).
 *   - Custom HTTP headers: sent during the WebSocket upgrade handshake.
 */

const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const { buildHttpsAgentOptions, buildHttpsServerOptions, formatTlsCertSummary, getSystemRootCertificates } = require('./tls-utils');
const { DATA_FORMATS, VALID_DATA_FORMATS, FORMAT_CONTENT_TYPES, DEFAULT_FORMAT } = require('./format-utils');

/**
 * Default ports for WebSocket modes (same as HTTP — WebSocket upgrades from HTTP).
 */
const WS_DEFAULT_PORT = 80;
const WSS_DEFAULT_PORT = 443;

// =============================================================================
// Client Transport
// =============================================================================

/**
 * Creates a WebSocket client transport.
 * @param {object} opts
 * @param {string} opts.ip - Target host
 * @param {number} opts.port - Target port
 * @param {string} [opts.wsFormat='delimited'] - Data format
 * @param {string} [opts.wsPath='/'] - URL path
 * @param {boolean} [opts.wsTls=true] - Use wss://
 * @param {string} [opts.wsTlsCaPath] - Custom CA cert path
 * @param {string} [opts.wsTlsCertPath] - Client cert path (mTLS)
 * @param {string} [opts.wsTlsKeyPath] - Client key path (mTLS)
 * @param {string} [opts.wsSubscriptionMsg] - Message sent after connecting
 * @param {boolean} [opts.wsIgnoreFirstMsg=false] - Skip first received message
 * @param {string} [opts.wsHeaders] - JSON string of custom HTTP headers
 * @param {function} [opts.onData] - Callback for received messages: (data, metadata) => {}
 */
function createWsClientTransport(opts) {
  const {
    ip, port,
    wsFormat = DEFAULT_FORMAT,
    wsPath = '/',
    wsTls = true,
    wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath,
    wsSubscriptionMsg,
    wsIgnoreFirstMsg = false,
    wsHeaders,
    onData,
  } = opts;

  let ws = null;
  let connected = false;
  let firstMsgSkipped = false;

  return {
    async connect() {
      const scheme = wsTls ? 'wss' : 'ws';
      const pathNorm = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
      const url = `${scheme}://${ip}:${port}${pathNorm}`;

      const wsOpts = {};

      // TLS options
      if (wsTls) {
        const tlsOpts = buildHttpsAgentOptions({ tlsCaPath: wsTlsCaPath, tlsCertPath: wsTlsCertPath, tlsKeyPath: wsTlsKeyPath });
        // ws package uses these directly
        Object.assign(wsOpts, tlsOpts);
      }

      // Custom HTTP headers for the upgrade request
      if (wsHeaders) {
        try {
          const parsed = typeof wsHeaders === 'string' ? JSON.parse(wsHeaders) : wsHeaders;
          wsOpts.headers = { ...(wsOpts.headers || {}), ...parsed };
        } catch (e) {
          throw new Error(`Invalid wsHeaders JSON: ${e.message}`);
        }
      }

      return new Promise((resolve, reject) => {
        try {
          ws = new WebSocket(url, wsOpts);
        } catch (err) {
          return reject(err);
        }

        const onOpen = () => {
          connected = true;
          firstMsgSkipped = false;
          cleanup();

          // Send subscription message if provided
          if (wsSubscriptionMsg) {
            ws.send(wsSubscriptionMsg);
          }

          // Listen for incoming messages
          if (onData) {
            ws.on('message', (data) => {
              if (wsIgnoreFirstMsg && !firstMsgSkipped) {
                firstMsgSkipped = true;
                return;
              }
              const msg = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
              onData(msg, {
                protocol: 'WebSocket',
                mode: 'client',
                wsFormat,
                tls: wsTls ? 'on (WSS)' : 'off (WS)',
                contentType: FORMAT_CONTENT_TYPES[wsFormat] || 'text/plain',
                remote: `${ip}:${port}`,
              });
            });
          }

          const tlsInfo = wsTls
            ? formatTlsCertSummary({ tlsCaPath: wsTlsCaPath, tlsCertPath: wsTlsCertPath, tlsKeyPath: wsTlsKeyPath })
            : 'tls=off (unsecure)';

          resolve({
            success: true,
            protocol: 'ws',
            mode: 'client',
            wsFormat,
            address: url,
            contentType: FORMAT_CONTENT_TYPES[wsFormat] || 'text/plain',
            tlsInfo,
          });
        };

        const onError = (err) => {
          cleanup();
          reject(err);
        };

        const cleanup = () => {
          ws.removeListener('open', onOpen);
          ws.removeListener('error', onError);
        };

        ws.on('open', onOpen);
        ws.on('error', onError);
      });
    },

    send(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket client is not connected');
      }
      ws.send(data);
    },

    disconnect() {
      if (ws) {
        connected = false;
        ws.close();
        ws = null;
      }
    },

    isConnected() {
      return connected && ws && ws.readyState === WebSocket.OPEN;
    },
  };
}

// =============================================================================
// Server Transport
// =============================================================================

/**
 * Creates a WebSocket server transport.
 * @param {object} opts
 * @param {string} opts.ip - Bind address
 * @param {number} opts.port - Bind port
 * @param {string} [opts.wsFormat='delimited'] - Data format
 * @param {string} [opts.wsPath='/'] - URL path for upgrade requests
 * @param {boolean} [opts.wsTls=true] - Use wss://
 * @param {string} [opts.wsTlsCaPath] - CA cert path
 * @param {string} [opts.wsTlsCertPath] - Server cert path (required for TLS)
 * @param {string} [opts.wsTlsKeyPath] - Server key path (required for TLS)
 * @param {function} [opts.onData] - Callback for received messages: (data, metadata) => {}
 * @param {function} [opts.onClientConnected] - Called when first client connects
 */
function createWsServerTransport(opts) {
  const {
    ip, port,
    wsFormat = DEFAULT_FORMAT,
    wsPath = '/',
    wsTls = true,
    wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath,
    onData,
    onClientConnected,
  } = opts;

  let httpServer = null;
  let wss = null;
  let connected = false;
  const clients = new Set();

  return {
    async connect() {
      const pathNorm = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;

      // Create underlying HTTP(S) server
      if (wsTls) {
        const serverOpts = buildHttpsServerOptions({ tlsCaPath: wsTlsCaPath, tlsCertPath: wsTlsCertPath, tlsKeyPath: wsTlsKeyPath });
        httpServer = https.createServer(serverOpts);
      } else {
        httpServer = http.createServer();
      }

      // Create WebSocket server attached to the HTTP server
      wss = new WebSocket.Server({ server: httpServer, path: pathNorm });

      wss.on('connection', (clientWs, req) => {
        clients.add(clientWs);

        if (clients.size === 1 && onClientConnected) {
          onClientConnected();
        }

        clientWs.on('message', (data) => {
          if (onData) {
            const msg = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
            const remote = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
            onData(msg, {
              protocol: 'WebSocket',
              mode: 'server',
              method: 'MESSAGE',
              path: pathNorm,
              wsFormat,
              tls: wsTls ? 'on (WSS)' : 'off (WS)',
              contentType: FORMAT_CONTENT_TYPES[wsFormat] || 'text/plain',
              remote,
            });
          }
        });

        clientWs.on('close', () => {
          clients.delete(clientWs);
        });

        clientWs.on('error', () => {
          clients.delete(clientWs);
        });
      });

      return new Promise((resolve, reject) => {
        httpServer.on('error', reject);
        httpServer.listen(port, ip, () => {
          connected = true;
          const addr = httpServer.address();
          const scheme = wsTls ? 'wss' : 'ws';
          const tlsInfo = wsTls
            ? formatTlsCertSummary({ tlsCaPath: wsTlsCaPath, tlsCertPath: wsTlsCertPath, tlsKeyPath: wsTlsKeyPath })
            : 'tls=off (unsecure)';

          resolve({
            success: true,
            protocol: 'ws',
            mode: 'server',
            wsFormat,
            address: { address: addr.address, port: addr.port },
            url: `${scheme}://${addr.address}:${addr.port}${pathNorm}`,
            contentType: FORMAT_CONTENT_TYPES[wsFormat] || 'text/plain',
            tlsInfo,
          });
        });
      });
    },

    send(data) {
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    },

    disconnect() {
      connected = false;
      for (const client of clients) {
        client.close();
      }
      clients.clear();
      if (wss) { wss.close(); wss = null; }
      if (httpServer) { httpServer.close(); httpServer = null; }
    },

    isConnected() {
      return connected;
    },

    getClientCount() {
      return clients.size;
    },
  };
}

module.exports = {
  createWsClientTransport,
  createWsServerTransport,
  WS_DEFAULT_PORT,
  WSS_DEFAULT_PORT,
  // Re-export format constants for convenience
  DATA_FORMATS,
  VALID_DATA_FORMATS,
  FORMAT_CONTENT_TYPES,
  DEFAULT_FORMAT,
};

