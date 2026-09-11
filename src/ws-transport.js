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
const { formatNetworkAuthority } = require('./network-address-utils');

/**
 * Default ports for WebSocket modes (same as HTTP — WebSocket upgrades from HTTP).
 */
const WS_DEFAULT_PORT = 8080;
const WSS_DEFAULT_PORT = 8443;

/**
 * Bound applied to every teardown wait. A peer that never answers the close
 * handshake, or a keep-alive socket that never ends, must not stall disconnect:
 * the wait expires, the socket is forced shut, and the port is released.
 */
const WS_CLOSE_TIMEOUT_MS = 2000;

/**
 * Closes one WebSocket and resolves once it is closed or the bound wait
 * expires, terminating it in that case so teardown always completes.
 *
 * @param {object} socket - ws WebSocket instance
 * @param {number} [timeoutMs] - bound on the close handshake
 * @returns {Promise<void>}
 */
function closeWebSocket(socket, timeoutMs = WS_CLOSE_TIMEOUT_MS) {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener('close', finish);
      resolve();
    };
    const timer = setTimeout(() => {
      try { socket.terminate(); } catch (_) { /* already gone */ }
      finish();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    socket.once('close', finish);
    try {
      socket.close();
    } catch (_) {
      try { socket.terminate(); } catch (__) { /* already gone */ }
      finish();
    }
  });
}

/**
 * Runs a callback-style close and resolves when it completes or when the bound
 * wait expires, so one unresponsive connection cannot stall teardown.
 *
 * @param {function} start - receives the completion callback
 * @param {number} [timeoutMs] - bound on the close
 * @param {function} [onTimeout] - forced cleanup applied when the wait expires
 * @returns {Promise<void>}
 */
function closeWithTimeout(start, timeoutMs = WS_CLOSE_TIMEOUT_MS, onTimeout = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      if (onTimeout) { try { onTimeout(); } catch (_) { /* best effort */ } }
      finish();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      start(finish);
    } catch (_) {
      finish();
    }
  });
}

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
 * @param {boolean} [opts.wsAllowUnverifiedTls=false] - Explicitly skip certificate
 *   verification (any host). Off by default.
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
    wsAllowUnverifiedTls = false,
    wsSubscriptionMsg,
    wsIgnoreFirstMsg = false,
    wsHeaders,
    authToken,
    authQueryToken,
    authBasic,
    onData,
    onStateChange,
  } = opts;

  let ws = null;
  let connected = false;
  let firstMsgSkipped = false;

  return {
    async connect() {
      const scheme = wsTls ? 'wss' : 'ws';
      const pathNorm = wsPath.startsWith('/') ? wsPath : `/${wsPath}`;
      const url = `${scheme}://${formatNetworkAuthority(ip, port)}${pathNorm}`;
      let connectionUrl = url;
      if (authQueryToken) {
        if (!wsTls) throw new Error('A stream token cannot be sent over an unsecure WebSocket connection.');
        const credentialUrl = new URL(url);
        credentialUrl.searchParams.set('token', authQueryToken);
        connectionUrl = credentialUrl.href;
      }
      const safeError = (error) => {
        if (!authQueryToken) return error;
        const message = String(error.message || error)
          .split(connectionUrl).join(url)
          .replace(/([?&]token=)[^&\s]*/gi, '$1[hidden]')
          .split(encodeURIComponent(authQueryToken)).join('[hidden]')
          .split(authQueryToken).join('[hidden]');
        return new Error(message);
      };

      const wsOpts = {};
      let clientTlsInfo = 'tls=off (unsecure)';

      // TLS options
      if (wsTls) {
        const { agentOptions, tlsInfo } = buildHttpsAgentOptions({
          tlsCaPath: wsTlsCaPath,
          tlsCertPath: wsTlsCertPath,
          tlsKeyPath: wsTlsKeyPath,
          allowUnverifiedTls: wsAllowUnverifiedTls === true,
        });
        clientTlsInfo = tlsInfo;
        // ws package accepts TLS options (ca, cert, key, rejectUnauthorized) directly
        if (agentOptions) Object.assign(wsOpts, agentOptions);
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

      // Add auth header if configured
      if (authToken) {
        wsOpts.headers = { ...(wsOpts.headers || {}), Authorization: `Bearer ${authToken}` };
      } else if (authBasic) {
        const encoded = Buffer.from(`${authBasic.username}:${authBasic.password}`).toString('base64');
        wsOpts.headers = { ...(wsOpts.headers || {}), Authorization: `Basic ${encoded}` };
      }

      return new Promise((resolve, reject) => {
        try {
          ws = new WebSocket(connectionUrl, wsOpts);
        } catch (err) {
          return reject(safeError(err));
        }

        const onOpen = () => {
          connected = true;
          if (onStateChange) onStateChange('connected', { url });
          firstMsgSkipped = false;
          cleanup();
          ws.on('error', (error) => {
            connected = false;
            const safe = safeError(error);
            if (onStateChange) onStateChange('error', { message: safe.message, error: safe });
          });

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
                remote: formatNetworkAuthority(ip, port),
              });
            });
          }

          const tlsInfo = clientTlsInfo;

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
          const safe = safeError(err);
          if (onStateChange) onStateChange('error', { message: safe.message, error: safe });
          cleanup();
          // Enrich HTTP-upgrade errors with status code, URL, and actionable hints
          const res = err && err.response;
          if (res) {
            const status = res.statusCode || '?';
            const statusText = res.statusMessage || '';
            let hint = '';
            if (status === 400) {
              hint = ' — the server rejected the WebSocket upgrade. Common causes: the path does not match the server (e.g. server expects "/" but client used a different path), or the request was not a valid WebSocket handshake.';
            } else if (status === 404) {
              hint = ' — no endpoint found at the requested path. Verify the WebSocket path matches the server configuration.';
            } else if (status === 401 || status === 403) {
              hint = ' — the server denied access. Check authentication headers or credentials.';
            }
            const enriched = new Error(
              `WebSocket upgrade failed: HTTP ${status}${statusText ? ' ' + statusText : ''} for ${url}${hint}`
            );
            const safeEnriched = safeError(enriched);
            safeEnriched.response = authQueryToken ? { statusCode: res.statusCode } : res;
            return reject(safeEnriched);
          }
          reject(safe);
        };

        const cleanup = () => {
          ws.removeListener('open', onOpen);
          ws.removeListener('error', onError);
        };

        ws.on('open', onOpen);
        ws.on('error', onError);
        ws.on('close', () => {
          connected = false;
          if (onStateChange) onStateChange('closed', { message: `WebSocket connection to ${url} closed.` });
        });
      });
    },

    send(data) {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket client is not connected');
      }
      return new Promise((resolve, reject) => {
        ws.send(data, (error) => {
          if (error) reject(error);
          else resolve({ delivered: true, recipients: 1 });
        });
      });
    },

    async disconnect() {
      connected = false;
      if (!ws) return;
      const activeWs = ws;
      ws = null;
      await closeWebSocket(activeWs);
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
    onClientDisconnected,
    onStateChange,
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
        const { serverOptions } = buildHttpsServerOptions({ ip, tlsCaPath: wsTlsCaPath, tlsCertPath: wsTlsCertPath, tlsKeyPath: wsTlsKeyPath });
        httpServer = https.createServer(serverOptions);
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
          if (clients.delete(clientWs) && clients.size === 0 && onClientDisconnected) {
            onClientDisconnected();
          }
        });

        clientWs.on('error', () => {
          if (clients.delete(clientWs) && clients.size === 0 && onClientDisconnected) {
            onClientDisconnected();
          }
        });
      });

      return new Promise((resolve, reject) => {
        let settled = false;
        // The ws server forwards the underlying HTTP server's error events, so
        // both emitters need a listener. Without the wss listener a bind
        // failure such as EADDRINUSE becomes an unhandled 'error' event and
        // takes the process down instead of rejecting connect().
        const handleServerError = (err) => {
          if (settled) {
            if (onStateChange) onStateChange('error', { message: err.message, error: err });
            return;
          }
          settled = true;
          reject(new Error(`WebSocket server failed to bind on ${ip}:${port}: ${err.message}`));
        };
        wss.on('error', handleServerError);
        httpServer.on('error', handleServerError);
        httpServer.listen(port, ip, () => {
          if (settled) return;
          settled = true;
          connected = true;
          const addr = httpServer.address();
          if (onStateChange) onStateChange('connected', { address: addr });
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
            url: `${scheme}://${formatNetworkAuthority(addr.address, addr.port)}${pathNorm}`,
            contentType: FORMAT_CONTENT_TYPES[wsFormat] || 'text/plain',
            tlsInfo,
          });
        });
      });
    },

    async send(data) {
      const openClients = [...clients].filter((client) => client.readyState === WebSocket.OPEN);
      if (openClients.length === 0) {
        return { delivered: false, recipients: 0, reason: 'no-clients' };
      }
      await Promise.all(openClients.map((client) => new Promise((resolve, reject) => {
        client.send(data, (error) => error ? reject(error) : resolve());
      })));
      return { delivered: true, recipients: openClients.length };
    },

    async disconnect() {
      connected = false;
      const activeWss = wss;
      const activeHttpServer = httpServer;
      wss = null;
      httpServer = null;
      // Every wait is bounded, so an unresponsive client cannot keep the
      // listening socket alive and block an immediate rebind on the same port.
      await Promise.all([...clients].map((client) => closeWebSocket(client)));
      clients.clear();
      if (activeWss) {
        await closeWithTimeout((done) => activeWss.close(done));
      }
      if (activeHttpServer && activeHttpServer.listening) {
        await closeWithTimeout((done) => {
          activeHttpServer.close(done);
          // Any socket left over from a non-upgrade request would otherwise
          // hold the close callback until it times out on its own.
          if (typeof activeHttpServer.closeAllConnections === 'function') {
            activeHttpServer.closeAllConnections();
          }
        });
      }
      if (onStateChange) onStateChange('closed', { message: 'WebSocket server closed.' });
    },

    isConnected() {
      return connected;
    },

    getClientCount() {
      return clients.size;
    },

    hasRecipients() {
      return clients.size > 0;
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
