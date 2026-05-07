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
 * @file velocity-api.js
 * @description ArcGIS Velocity REST API utilities — token generation, feed/output
 * listing, and proactive token refresh with exponential backoff.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { EventEmitter } = require('events');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_PORTAL_URL = 'https://velocitydemo.maps.arcgis.com';
const DEFAULT_TOKEN_EXPIRY_MINUTES = 60;
const TOKEN_REFRESH_RATIO = 0.8; // Refresh at 80% of lifetime
const MAX_RETRY_ATTEMPTS = 5;
const INITIAL_RETRY_DELAY_MS = 1000;

// Feed definition names that map to simulator connection modes
const SUPPORTED_FEED_TYPES = new Set([
  'grpc',
  'http-receiver',
  'websocket'
]);

// ─── HTTP Helpers ────────────────────────────────────────────────────────────

/**
 * Perform an HTTP(S) request and return the parsed JSON body.
 * @param {string} url - Full request URL
 * @param {object} [options] - Optional overrides (method, headers, body)
 * @returns {Promise<object>}
 */
function jsonRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const reqOptions = {
      method: options.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Accept': 'application/json',
        'Referer': 'http://localhost:8888',
        ...(options.headers || {})
      }
    };

    const req = transport.request(reqOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        // Attach status and raw body to resolved result so callers can inspect it
        try {
          const parsed = JSON.parse(body);
          parsed.__httpStatus = res.statusCode;
          parsed.__rawBody = body;
          resolve(parsed);
        } catch (e) {
          const err = new Error(`HTTP ${res.statusCode}: non-JSON response from ${url} — ${body.slice(0, 300)}`);
          err.httpStatus = res.statusCode;
          err.rawBody = body;
          reject(err);
        }
      });
    });
    req.on('error', (networkErr) => {
      const err = new Error(`Network error connecting to ${url}: ${networkErr.message}`);
      err.cause = networkErr;
      reject(err);
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ─── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a token using ArcGIS username + password via the generateToken endpoint.
 * @param {string} portalUrl - Portal base URL (e.g. https://velocitydemo.maps.arcgis.com)
 * @param {string} username
 * @param {string} password
 * @param {number} [expiryMinutes=60]
 * @returns {Promise<{token: string, expires: number}>}
 */
async function generateToken(portalUrl, username, password, expiryMinutes = DEFAULT_TOKEN_EXPIRY_MINUTES) {
  const url = `${portalUrl.replace(/\/+$/, '')}/sharing/rest/generateToken`;
  const params = new URLSearchParams({
    username,
    password,
    client: 'referer',
    referer: 'http://localhost:8888',
    f: 'json',
    expiration: String(expiryMinutes)
  });

  const result = await jsonRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (result.error) {
    const e = result.error;
    const code = e.code ? ` (code ${e.code})` : '';
    const details = Array.isArray(e.details) && e.details.length ? `\nDetails: ${e.details.join('; ')}` : '';
    const status = result.__httpStatus ? ` [HTTP ${result.__httpStatus}]` : '';
    throw new Error(`Token generation failed for ${portalUrl}${status}${code}: ${e.message || JSON.stringify(e)}${details}`);
  }
  if (!result.token) {
    const status = result.__httpStatus ? ` [HTTP ${result.__httpStatus}]` : '';
    throw new Error(`No token returned from ${url}${status} — server response: ${(result.__rawBody || '').slice(0, 300)}`);
  }
  return { token: result.token, expires: result.expires };
}

/**
 * Generate a token using OAuth 2.0 client credentials flow.
 * @param {string} portalUrl
 * @param {string} clientId
 * @param {string} clientSecret
 * @returns {Promise<{token: string, expires: number}>}
 */
async function generateOAuthToken(portalUrl, clientId, clientSecret) {
  const url = `${portalUrl.replace(/\/+$/, '')}/sharing/rest/oauth2/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    f: 'json'
  });

  const result = await jsonRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (result.error) {
    const e = result.error;
    const code = e.code ? ` (code ${e.code})` : '';
    const status = result.__httpStatus ? ` [HTTP ${result.__httpStatus}]` : '';
    throw new Error(`OAuth token generation failed for ${portalUrl}${status}${code}: ${e.message || JSON.stringify(e)}`);
  }
  if (!result.access_token) {
    const status = result.__httpStatus ? ` [HTTP ${result.__httpStatus}]` : '';
    throw new Error(`No access_token returned from OAuth endpoint ${portalUrl}${status} — server response: ${(result.__rawBody || '').slice(0, 300)}`);
  }
  // OAuth response uses expires_in (seconds), convert to absolute epoch ms
  const expiresMs = Date.now() + (result.expires_in * 1000);
  return { token: result.access_token, expires: expiresMs };
}

// ─── Velocity API Discovery ──────────────────────────────────────────────────

/**
 * Retrieve the Velocity API URL from the portal's subscription info.
 * @param {string} portalUrl
 * @param {string} token
 * @returns {Promise<string>} velocityUrl (e.g. https://us-iot.arcgis.com/orgid/abc123)
 */
async function getVelocityApiUrl(portalUrl, token) {
  const url = `${portalUrl.replace(/\/+$/, '')}/sharing/rest/portals/self/subscriptionInfo?f=json&token=${encodeURIComponent(token)}&client=referer&referer=http://localhost:8888`;
  const result = await jsonRequest(url);

  if (result.error) {
    throw new Error(result.error.message || JSON.stringify(result.error));
  }

  const orgCapabilities = result.orgCapabilities || [];
  for (const cap of orgCapabilities) {
    if (cap.id === 'velocity') {
      return cap.velocityUrl;
    }
  }
  throw new Error('Organization is not licensed for ArcGIS Velocity (no velocity capability found).');
}

// ─── Feed & Output Listing ───────────────────────────────────────────────────

/**
 * List all feeds from the Velocity API.
 * @param {string} velocityUrl
 * @param {string} token
 * @returns {Promise<Array>} Array of feed objects with parsed properties
 */
async function listFeeds(velocityUrl, token, adminScope = false) {
  const base = `${velocityUrl.replace(/\/+$/, '')}/iot/feeds?f=json&token=${encodeURIComponent(token)}&num=1000`;
  const url = adminScope ? `${base}&view=admin` : base;
  const feeds = await jsonRequest(url, {
    headers: { 'Authorization': `token=${token}` }
  });

  // Debug: log raw response shape so callers can diagnose unexpected server responses
  if (process.env.NODE_ENV !== 'test') {
    const shape = Array.isArray(feeds)
      ? `array(${feeds.length})`
      : (feeds && typeof feeds === 'object' ? `object{${Object.keys(feeds).filter(k => !k.startsWith('__')).join(',')}}` : typeof feeds);
    console.log(`[API][listFeeds] raw response shape: ${shape}`);
    if (!Array.isArray(feeds)) {
      console.log(`[API][listFeeds] raw body (first 500): ${(feeds.__rawBody || '').slice(0, 500)}`);
    }
  }

  if (!Array.isArray(feeds)) {
    if (feeds && feeds.error) throw new Error(feeds.error.message || JSON.stringify(feeds.error));
    throw new Error(`Unexpected response from /iot/feeds — got: ${JSON.stringify(feeds).slice(0, 300)}`);
  }

  return feeds.map(item => parseFeedItem(item));
}

/**
 * List all outputs from the Velocity API.
 * @param {string} velocityUrl
 * @param {string} token
 * @returns {Promise<Array>} Array of output objects with parsed properties
 */
async function listOutputs(velocityUrl, token) {
  const url = `${velocityUrl.replace(/\/+$/, '')}/iot/outputs?f=json&token=${encodeURIComponent(token)}&num=1000&view=admin`;
  const outputs = await jsonRequest(url, {
    headers: { 'Authorization': `token=${token}` }
  });

  if (!Array.isArray(outputs)) {
    if (outputs && outputs.error) throw new Error(outputs.error.message || JSON.stringify(outputs.error));
    throw new Error('Unexpected response from /iot/outputs');
  }

  return outputs.map(item => parseOutputItem(item));
}

/**
 * Get details for a single feed by ID.
 * @param {string} velocityUrl
 * @param {string} feedId
 * @param {string} token
 * @returns {Promise<object>}
 */
async function getFeedDetails(velocityUrl, feedId, token) {
  const url = `${velocityUrl.replace(/\/+$/, '')}/iot/feed/${feedId}?f=json&token=${encodeURIComponent(token)}`;
  const result = await jsonRequest(url);
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return parseFeedItem(result);
}

/**
 * Get details for a single output by ID.
 * @param {string} velocityUrl
 * @param {string} outputId
 * @param {string} token
 * @returns {Promise<object>}
 */
async function getOutputDetails(velocityUrl, outputId, token) {
  const url = `${velocityUrl.replace(/\/+$/, '')}/iot/output/${outputId}?f=json&token=${encodeURIComponent(token)}`;
  const result = await jsonRequest(url);
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return parseOutputItem(result);
}

// ─── Item Parsing ────────────────────────────────────────────────────────────

function parseFeedItem(item) {
  const feed = item.feed || item;
  const feedDefName = feed.name || '';
  const label = item.label || '';
  const id = item.id || '';
  const propBag = feed.properties || {};
  const schema = (feed.schemaTransformation && feed.schemaTransformation.inputSchema && feed.schemaTransformation.inputSchema.attributes) || [];
  const format = feed.formatName || '';

  const parsed = { label, id, feedType: feedDefName, format, schema, supported: SUPPORTED_FEED_TYPES.has(feedDefName) };

  if (feedDefName === 'grpc') {
    parsed.url = propBag['grpc.url'] || '';
    parsed.headerPath = propBag['grpc.headerPath'] || '';
    parsed.authType = propBag['grpc.authenticationType'] || '';
  } else if (feedDefName === 'http-receiver') {
    parsed.url = propBag['http-receiver.url'] || '';
    parsed.authType = propBag['http-receiver.httpAuthenticationType'] || '';
  } else if (feedDefName === 'websocket') {
    parsed.url = propBag['websocket.url'] || '';
    parsed.authType = propBag['websocket.authenticationType'] || '';
  } else if (feedDefName === 'mqtt' || feedDefName === 'kinetic') {
    parsed.host = propBag[`${feedDefName}.host`] || '';
    parsed.port = propBag[`${feedDefName}.port`] || '';
    parsed.topic = propBag[`${feedDefName}.topic`] || '';
    parsed.username = propBag[`${feedDefName}.username`] || '';
    parsed.clientId = propBag[`${feedDefName}.clientid`] || '';
    parsed.qos = propBag[`${feedDefName}.qos`] || '';
  } else if (feedDefName === 'azure-event-hub' || feedDefName === 'azure-service-bus') {
    parsed.endpoint = propBag[`${feedDefName}.endpoint`] || '';
    const entityKey = feedDefName === 'azure-event-hub' ? 'entityPath' : 'topicName';
    parsed.entityPath = propBag[`${feedDefName}.${entityKey}`] || '';
    parsed.sharedAccessKeyName = propBag[`${feedDefName}.sharedAccessKeyName`] || '';
  } else if (feedDefName === 'tcp') {
    parsed.host = propBag['tcp.host'] || '';
    parsed.port = propBag['tcp.port'] || '';
  } else if (feedDefName === 'udp') {
    parsed.host = propBag['udp.host'] || '';
    parsed.port = propBag['udp.port'] || '';
  }

  return parsed;
}

function parseOutputItem(item) {
  const output = item.output || item;
  const outputDefName = output.name || '';
  const label = item.label || '';
  const id = item.id || '';
  const propBag = output.properties || {};
  const schema = (output.schemaTransformation && output.schemaTransformation.outputSchema && output.schemaTransformation.outputSchema.attributes) || [];
  const format = output.formatName || '';

  // Logger supports: grpc, http, websocket, tcp
  const supportedOutputTypes = new Set(['grpc', 'http', 'websocket', 'tcp']);
  const parsed = { label, id, outputType: outputDefName, format, schema, supported: supportedOutputTypes.has(outputDefName) };

  if (outputDefName === 'grpc') {
    parsed.url = propBag['grpc.url'] || '';
    parsed.headerPath = propBag['grpc.headerPath'] || '';
    parsed.authType = propBag['grpc.authenticationType'] || '';
  } else if (outputDefName === 'http') {
    parsed.url = propBag['http.url'] || '';
    parsed.authType = propBag['http.authenticationType'] || '';
  } else if (outputDefName === 'websocket') {
    parsed.url = propBag['websocket.url'] || '';
    parsed.authType = propBag['websocket.authenticationType'] || '';
  } else if (outputDefName === 'tcp') {
    parsed.host = propBag['tcp.host'] || '';
    parsed.port = propBag['tcp.port'] || '';
  }

  return parsed;
}

// ─── Token Manager ───────────────────────────────────────────────────────────

/**
 * Manages token lifecycle — proactive refresh at 80% of lifetime with
 * exponential backoff on failure.
 *
 * Events:
 *   'refreshed' — (token: string) emitted when a new token is obtained
 *   'error'     — (err: Error) emitted when refresh fails after all retries
 */
class TokenManager extends EventEmitter {
  constructor() {
    super();
    this._token = null;
    this._expires = 0;
    this._refreshTimer = null;
    this._credentials = null;
    this._portalUrl = null;
    this._authMode = null; // 'password' | 'oauth'
  }

  /** Current token value (may be null if not yet authenticated). */
  get token() { return this._token; }

  /** Absolute epoch ms when the token expires. */
  get expires() { return this._expires; }

  /** Whether currently authenticated. */
  get isAuthenticated() { return !!this._token && Date.now() < this._expires; }

  /**
   * Authenticate with username/password and start refresh cycle.
   */
  async loginWithPassword(portalUrl, username, password, expiryMinutes = DEFAULT_TOKEN_EXPIRY_MINUTES) {
    this._portalUrl = portalUrl;
    this._authMode = 'password';
    this._credentials = { username, password, expiryMinutes };
    const result = await generateToken(portalUrl, username, password, expiryMinutes);
    this._setToken(result.token, result.expires);
    return result;
  }

  /**
   * Authenticate with OAuth client credentials and start refresh cycle.
   */
  async loginWithOAuth(portalUrl, clientId, clientSecret) {
    this._portalUrl = portalUrl;
    this._authMode = 'oauth';
    this._credentials = { clientId, clientSecret };
    const result = await generateOAuthToken(portalUrl, clientId, clientSecret);
    this._setToken(result.token, result.expires);
    return result;
  }

  /**
   * Stop refresh cycle and clear token.
   */
  logout() {
    this._clearTimer();
    this._token = null;
    this._expires = 0;
    this._credentials = null;
    this._authMode = null;
  }

  /** @private */
  _setToken(token, expires) {
    this._token = token;
    this._expires = expires;
    this.emit('refreshed', token);
    this._scheduleRefresh();
  }

  /** @private */
  _scheduleRefresh() {
    this._clearTimer();
    const remainingMs = this._expires - Date.now();
    if (remainingMs <= 0) return;
    const delay = Math.max(remainingMs * TOKEN_REFRESH_RATIO, 5000);
    this._refreshTimer = setTimeout(() => this._doRefresh(0), delay);
  }

  /** @private */
  async _doRefresh(attempt) {
    try {
      let result;
      if (this._authMode === 'password') {
        const { username, password, expiryMinutes } = this._credentials;
        result = await generateToken(this._portalUrl, username, password, expiryMinutes);
      } else {
        const { clientId, clientSecret } = this._credentials;
        result = await generateOAuthToken(this._portalUrl, clientId, clientSecret);
      }
      this._setToken(result.token, result.expires);
    } catch (err) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        this._refreshTimer = setTimeout(() => this._doRefresh(attempt + 1), delay);
      } else {
        this.emit('error', err);
      }
    }
  }

  /** @private */
  _clearTimer() {
    if (this._refreshTimer) {
      clearTimeout(this._refreshTimer);
      this._refreshTimer = null;
    }
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  DEFAULT_PORTAL_URL,
  SUPPORTED_FEED_TYPES,
  generateToken,
  generateOAuthToken,
  getVelocityApiUrl,
  listFeeds,
  listOutputs,
  getFeedDetails,
  getOutputDetails,
  parseFeedItem,
  parseOutputItem,
  TokenManager
};

