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
 * @file http-transport.js
 * @description
 * HTTP/HTTPS transport for the ArcGIS Velocity Simulator.
 *
 * Supports the following data formats (matching Velocity HTTP Receiver feed):
 *   - json        (application/json)
 *   - delimited   (text/plain)
 *   - esri-json   (application/json)
 *   - geo-json    (application/geo+json)
 *   - xml         (application/xml)
 *
 * Client mode: POSTs data to an HTTP(S) endpoint.
 * Server mode: hosts an HTTP(S) server that accepts POST requests and
 *              streams data to connected Watch clients via Server-Sent Events.
 */
const http = require('http');
const https = require('https');
const { buildHttpsAgentOptions, buildHttpsServerOptions, formatTlsCertSummary, getSystemRootCertificates } = require('./tls-utils');
const { DATA_FORMATS, VALID_DATA_FORMATS, FORMAT_CONTENT_TYPES, DEFAULT_FORMAT } = require('./format-utils');

// Re-export format constants under HTTP-specific names for backward compatibility
const HTTP_FORMATS = DATA_FORMATS;
const VALID_HTTP_FORMATS = VALID_DATA_FORMATS;

/**
 * Default ports for HTTP and HTTPS modes.
 */
const HTTP_DEFAULT_PORT = 8080;
const HTTPS_DEFAULT_PORT = 8443;


// =============================================================================
// HTTP CLIENT TRANSPORT
// =============================================================================

class HttpClientTransport {
  /**
   * @param {object} opts
   * @param {string} opts.ip - Target host
   * @param {number} opts.port - Target port
   * @param {string} [opts.httpFormat='json'] - Data format
   * @param {string} [opts.httpPath='/'] - URL path
   * @param {boolean} [opts.httpTls=true] - Use HTTPS
   * @param {string} [opts.httpTlsCaPath] - CA cert path
   * @param {string} [opts.httpTlsCertPath] - Client cert path
   * @param {string} [opts.httpTlsKeyPath] - Client key path
   * @param {boolean} [opts.httpAllowUnverifiedTls=false] - Explicitly skip
   *   certificate verification (any host). Off by default.
   */
  constructor({ ip, port, httpFormat = 'json', httpPath = '/', httpTls = true, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, httpAllowUnverifiedTls = false, onData = null, onLog = null, authToken, authBasic }) {
    this.ip = ip;
    this.port = port;
    this.httpFormat = httpFormat;
    this.httpPath = httpPath.startsWith('/') ? httpPath : `/${httpPath}`;
    this.httpTls = httpTls;
    this.httpTlsCaPath = httpTlsCaPath;
    this.httpTlsCertPath = httpTlsCertPath;
    this.httpTlsKeyPath = httpTlsKeyPath;
    this.httpAllowUnverifiedTls = httpAllowUnverifiedTls === true;
    this.onData = onData;
    this.onLog = typeof onLog === 'function' ? onLog : null;
    this.authToken = authToken || null;
    this.authBasic = authBasic || null; // { username, password }
    this._connected = false;
    this._agent = null;
    this._tlsInfo = '';
    this._sseReq = null;
    // A subscription that has proven the endpoint is not an event stream stops
    // for good. Retrying it would poll the endpoint forever and resend the
    // Authorization header on every attempt.
    this._sseSupported = true;
    this._sseEstablished = false;
    this._sseRetryTimer = null;
    // Backoff for an established stream that dropped, and for a connection-level
    // failure. These are internal pacing constants, not user-facing options.
    this._sseReconnectDelayMs = 1000;
    this._sseErrorRetryDelayMs = 2000;
  }

  async connect() {
    if (this.httpTls) {
      const { agentOptions, tlsInfo } = buildHttpsAgentOptions({
        useTls: true,
        tlsCaPath: this.httpTlsCaPath,
        tlsCertPath: this.httpTlsCertPath,
        tlsKeyPath: this.httpTlsKeyPath,
        allowUnverifiedTls: this.httpAllowUnverifiedTls,
      });
      this._tlsInfo = tlsInfo;
      this._agent = new https.Agent({ ...agentOptions, keepAlive: true });
    } else {
      this._tlsInfo = 'tls=off (unsecure)';
      this._agent = new http.Agent({ keepAlive: true });
    }
    this._connected = true;
    const scheme = this.httpTls ? 'https' : 'http';
    // If onData is provided, subscribe to the server's SSE stream
    if (this.onData) {
      this._sseSupported = true;
      this._startSseSubscription();
    }
    return {
      protocol: 'http',
      mode: 'client',
      httpFormat: this.httpFormat,
      address: `${scheme}://${this.ip}:${this.port}${this.httpPath}`,
      contentType: FORMAT_CONTENT_TYPES[this.httpFormat] || 'text/plain',
      tlsInfo: this._tlsInfo,
    };
  }

  _log(level, message) {
    if (this.onLog) this.onLog(level, message);
  }

  /**
   * Schedules one re-subscription, unless the transport has disconnected or the
   * endpoint has already proven it does not serve Server-Sent Events.
   */
  _scheduleSseRetry(delayMs) {
    if (!this._connected || !this._sseSupported) return;
    if (this._sseRetryTimer) clearTimeout(this._sseRetryTimer);
    this._sseRetryTimer = setTimeout(() => {
      this._sseRetryTimer = null;
      if (this._connected && this._sseSupported) this._startSseSubscription();
    }, delayMs);
    if (typeof this._sseRetryTimer.unref === 'function') this._sseRetryTimer.unref();
  }

  /**
   * Subscribes to the server's Server-Sent Events stream.
   *
   * The subscription only survives while the endpoint behaves like an event
   * stream. A definitive non-SSE answer — any status other than 200, or a
   * Content-Type that is not `text/event-stream` — ends the subscription for
   * the life of the connection instead of re-polling the endpoint, so an
   * endpoint that only accepts POST is asked exactly once and never receives
   * the Authorization header repeatedly. An established stream that drops is a
   * different case and still reconnects with a delay.
   */
  _startSseSubscription() {
    if (!this._sseSupported) return;
    const lib = this.httpTls ? https : http;
    const options = {
      hostname: this.ip,
      port: this.port,
      path: this.httpPath,
      method: 'GET',
      agent: this._agent,
      headers: { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
    };
    this._applyAuthHeaders(options.headers);
    const req = lib.request(options, (res) => {
      const contentType = String(res.headers['content-type'] || '');
      if (res.statusCode !== 200 || !contentType.includes('text/event-stream')) {
        // Definitive answer: this endpoint does not stream events.
        this._sseSupported = false;
        this._sseEstablished = false;
        res.resume(); // drain so the socket can be reused or released
        this._log('info', `[Transport] HTTP ${this.ip}:${this.port}${this.httpPath} answered the event-stream subscription with `
          + `HTTP ${res.statusCode} ${contentType || 'no content type'}. Server-to-client streaming is off for this connection; `
          + 'sending continues normally.');
        return;
      }
      this._sseEstablished = true;
      let buffer = '';
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const text = line.slice(6).trim();
            if (text && this.onData) {
              const metadata = {
                method: 'SSE',
                path: this.httpPath,
                contentType: FORMAT_CONTENT_TYPES[this.httpFormat] || 'text/plain',
                contentLength: text.length,
                tls: this.httpTls ? 'on (HTTPS)' : 'off (HTTP)',
                remote: `${this.ip}:${this.port}`,
                httpFormat: this.httpFormat,
              };
              this.onData(text, metadata);
            }
          }
        }
      });
      res.on('end', () => {
        // An established stream that dropped is reconnected; the paired
        // Simulator-server/Logger-client setup depends on this.
        this._sseEstablished = false;
        this._log('debug', `[Transport] HTTP event stream from ${this.ip}:${this.port}${this.httpPath} ended. `
          + `Re-subscribing in ${this._sseReconnectDelayMs}ms.`);
        this._scheduleSseRetry(this._sseReconnectDelayMs);
      });
    });
    req.on('error', (err) => {
      // Connection-level failure, not an answer from the endpoint: the server
      // may simply not be up yet, so this keeps its backoff.
      this._sseEstablished = false;
      this._log('debug', `[Transport] HTTP event-stream subscription to ${this.ip}:${this.port}${this.httpPath} `
        + `failed: ${err.message}. Retrying in ${this._sseErrorRetryDelayMs}ms.`);
      this._scheduleSseRetry(this._sseErrorRetryDelayMs);
    });
    req.end();
    this._sseReq = req;
  }

  isConnected() { return this._connected; }

  _applyAuthHeaders(headers) {
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    } else if (this.authBasic) {
      const encoded = Buffer.from(`${this.authBasic.username}:${this.authBasic.password}`).toString('base64');
      headers.Authorization = `Basic ${encoded}`;
    }
  }

  async send(data) {
    if (!this._connected) throw new Error('HTTP client not connected.');
    const contentType = FORMAT_CONTENT_TYPES[this.httpFormat] || 'text/plain';
    const lib = this.httpTls ? https : http;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.ip,
        port: this.port,
        path: this.httpPath,
        method: 'POST',
        agent: this._agent,
        headers: {
          'Content-Type': contentType,
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      this._applyAuthHeaders(options.headers);

      const req = lib.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ delivered: true, recipients: 1, statusCode: res.statusCode });
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body || res.statusMessage}`));
          }
        });
      });

      req.on('error', (err) => {
        // A failed request is a per-request failure, not a disconnect. Latching
        // the transport to disconnected here would make every later send fail
        // with "HTTP client not connected", even after the peer came back.
        reject(new Error(`HTTP request failed: ${err.message}`));
      });
      req.write(payload);
      req.end();
    });
  }

  async disconnect() {
    this._connected = false;
    this._sseEstablished = false;
    if (this._sseRetryTimer) { clearTimeout(this._sseRetryTimer); this._sseRetryTimer = null; }
    if (this._sseReq) { try { this._sseReq.destroy(); } catch (_) {} this._sseReq = null; }
    if (this._agent) { this._agent.destroy(); this._agent = null; }
  }
}


// =============================================================================
// HTTP SERVER TRANSPORT
// =============================================================================

class HttpServerTransport {
  /**
   * @param {object} opts
   * @param {string} opts.ip - Bind address
   * @param {number} opts.port - Listen port
   * @param {string} [opts.httpFormat='json'] - Expected data format
   * @param {string} [opts.httpPath='/'] - Endpoint path
   * @param {boolean} [opts.httpPolling=false] - Serve the latest replay payload to ordinary GET requests
   * @param {boolean} [opts.httpTls=true] - Use HTTPS
   * @param {string} [opts.httpTlsCaPath]
   * @param {string} [opts.httpTlsCertPath]
   * @param {string} [opts.httpTlsKeyPath]
   * @param {function} [opts.onData] - Callback for received data
   * @param {function} [opts.onClientConnected] - Callback when an SSE watcher connects
   * @param {function} [opts.onClientDisconnected] - Callback when an SSE watcher disconnects
   */
  constructor({ ip, port, httpFormat = 'json', httpPath = '/', httpPolling = false, httpTls = true, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, onData = null, onClientConnected = null, onClientDisconnected = null }) {
    this.ip = ip;
    this.port = port;
    this.httpFormat = httpFormat;
    this.httpPath = httpPath.startsWith('/') ? httpPath : `/${httpPath}`;
    this.httpPolling = httpPolling === true;
    this.httpTls = httpTls;
    this.httpTlsCaPath = httpTlsCaPath;
    this.httpTlsCertPath = httpTlsCertPath;
    this.httpTlsKeyPath = httpTlsKeyPath;
    this.onData = onData;
    this.onClientConnected = onClientConnected;
    this.onClientDisconnected = onClientDisconnected;
    this.server = null;
    this._listening = false;
    this._clientCount = 0;
    this._watcherResponses = new Set();
    this._latestPayload = null;
    this._tlsInfo = '';
  }

  async connect() {
    const requestHandler = (req, res) => {
      // SSE subscription via GET with Accept: text/event-stream
      if (req.method === 'GET' && req.url === this.httpPath && req.headers['accept'] && req.headers['accept'].includes('text/event-stream')) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(':\n\n'); // SSE comment to confirm connection
        this._watcherResponses.add(res);
        if (this.onClientConnected) this.onClientConnected();
        req.on('close', () => {
          if (this._watcherResponses.delete(res) && this.onClientDisconnected) {
            this.onClientDisconnected();
          }
        });
        return;
      }

      if (req.method === 'GET' && req.url === this.httpPath && this.httpPolling) {
        res.setHeader('Cache-Control', 'no-store');
        if (this._latestPayload === null) {
          res.writeHead(204);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': FORMAT_CONTENT_TYPES[this.httpFormat] || 'text/plain',
        });
        res.end(this._latestPayload);
        return;
      }

      // Health check / status via GET
      if (req.method === 'GET' && req.url === this.httpPath) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'listening', format: this.httpFormat, clients: this._clientCount }));
        return;
      }

      // Accept data via POST
      if (req.method === 'POST' && req.url === this.httpPath) {
        this._clientCount++;
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          this._clientCount--;
          if (this.onData) {
            const metadata = {
              method: req.method,
              path: req.url,
              contentType: req.headers['content-type'] || 'unknown',
              contentLength: req.headers['content-length'] || body.length,
              tls: this.httpTls ? 'on (HTTPS)' : 'off (HTTP)',
              remote: `${req.socket.remoteAddress}:${req.socket.remotePort}`,
              httpFormat: this.httpFormat,
            };
            this.onData(body, metadata);
          }
          // Broadcast to watchers (SSE)
          for (const watcher of this._watcherResponses) {
            try { watcher.write(`data: ${body}\n\n`); } catch (_) { this._watcherResponses.delete(watcher); }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
        return;
      }

      // 404 for all other routes
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    };

    if (this.httpTls) {
      const { serverOptions, tlsInfo } = buildHttpsServerOptions({
        useTls: true,
        ip: this.ip,
        tlsCaPath: this.httpTlsCaPath,
        tlsCertPath: this.httpTlsCertPath,
        tlsKeyPath: this.httpTlsKeyPath,
      });
      this._tlsInfo = tlsInfo;
      this.server = https.createServer(serverOptions, requestHandler);
    } else {
      this._tlsInfo = 'tls=off (unsecure)';
      this.server = http.createServer(requestHandler);
    }

    const address = this.ip + ':' + this.port;
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        reject(new Error(`HTTP server failed to bind on ${address}: ${err.message}`));
      });
      this.server.listen(this.port, this.ip, () => {
        this._listening = true;
        const boundAddress = this.server.address();
        resolve({
          protocol: 'http',
          mode: 'server',
          httpFormat: this.httpFormat,
          address: { address: boundAddress.address, port: boundAddress.port },
          contentType: FORMAT_CONTENT_TYPES[this.httpFormat] || 'text/plain',
          httpPolling: this.httpPolling,
          tlsInfo: this._tlsInfo,
        });
      });
    });
  }

  isConnected() { return this._listening; }
  hasRecipients() { return this.httpPolling || this._watcherResponses.size > 0; }

  async send(data) {
    if (this.httpPolling) this._latestPayload = typeof data === 'string' ? data : JSON.stringify(data);
    // In server mode, "send" broadcasts to any SSE watchers
    if (this._watcherResponses.size === 0) {
      if (this.httpPolling) return { delivered: true, recipients: 1 };
      return { delivered: false, recipients: 0, reason: 'no-watchers' };
    }
    const dead = [];
    for (const watcher of this._watcherResponses) {
      try { watcher.write(`data: ${data}\n\n`); } catch (_) { dead.push(watcher); }
    }
    for (const w of dead) { this._watcherResponses.delete(w); }
    return { delivered: this._watcherResponses.size > 0, recipients: this._watcherResponses.size };
  }

  async disconnect() {
    for (const watcher of this._watcherResponses) { try { watcher.end(); } catch (_) {} }
    this._watcherResponses.clear();
    this._latestPayload = null;
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this._listening = false;
          this.server = null;
          resolve();
        });
        // Force-close after timeout
        setTimeout(() => {
          if (this.server) { this.server.closeAllConnections(); }
        }, 2000);
      });
    }
    this._listening = false;
  }
}


// =============================================================================
// FACTORY
// =============================================================================

function createHttpClientTransport(opts) {
  return new HttpClientTransport(opts);
}

function createHttpServerTransport(opts) {
  return new HttpServerTransport(opts);
}

module.exports = {
  createHttpClientTransport,
  createHttpServerTransport,
  HttpClientTransport,
  HttpServerTransport,
  HTTP_FORMATS,
  VALID_HTTP_FORMATS,
  FORMAT_CONTENT_TYPES,
  HTTP_DEFAULT_PORT,
  HTTPS_DEFAULT_PORT,
};
