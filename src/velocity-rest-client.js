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

const http = require('http');
const https = require('https');
const { EventEmitter } = require('events');
const { normalizePortalUrl, endpointError } = require('./velocity-endpoints');
const tlsUtils = require('./tls-utils');

const DEFAULT_PORTAL_URL = 'https://velocitydemo.maps.arcgis.com';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_TOKEN_EXPIRY_MINUTES = 60;
const MAX_TIMER_MS = 2147483647;
const CERTIFICATE_ERRORS = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED',
  'INVALID_CA', 'CERT_REVOKED',
]);
const NETWORK_ERRORS = new Set([
  ...CERTIFICATE_ERRORS,
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EACCES', 'EADDRNOTAVAIL',
  'EPROTO', 'ERR_TLS_HANDSHAKE_TIMEOUT', 'ERR_TLS_INVALID_PROTOCOL_VERSION',
]);

function log(onLog, level, message) {
  if (typeof onLog === 'function') {
    try { onLog(level, message); } catch { /* Logging must not change request state. */ }
  }
}

function requestError(code, status, arcgisCode, networkCode) {
  let message;
  if ([401, 403, 498, 499].includes(arcgisCode) || [401, 403, 498, 499].includes(status)) {
    message = 'ArcGIS authorization failed. Sign in again or verify your account permissions.';
  } else {
    const messages = {
      HTTP_ERROR: 'ArcGIS request failed',
      ARCGIS_ERROR: 'ArcGIS returned an API error',
      REDIRECT: 'ArcGIS returned a redirect; use the final public HTTPS URL. Redirects are not followed',
      INVALID_JSON: 'ArcGIS returned a non-JSON response',
      RESPONSE_TOO_LARGE: 'ArcGIS response exceeded the size limit',
      TIMEOUT: 'ArcGIS request timed out',
      NETWORK_ERROR: 'ArcGIS connection failed. Check network access and certificate trust',
      INVALID_REQUEST: 'Invalid ArcGIS request',
      INVALID_TOKEN: 'ArcGIS returned an invalid or expired token',
    };
    message = messages[code] || 'ArcGIS request failed';
  }
  const safeNetworkCode = NETWORK_ERRORS.has(networkCode) ? networkCode : undefined;
  if (code === 'NETWORK_ERROR') {
    if (safeNetworkCode === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      message = 'ArcGIS TLS certificate does not match the hostname. Check the Portal URL and server certificate';
    } else if (safeNetworkCode === 'CERT_HAS_EXPIRED' || safeNetworkCode === 'CERT_NOT_YET_VALID') {
      message = 'ArcGIS TLS certificate is outside its validity period. Check the certificate and system clock';
    } else if (CERTIFICATE_ERRORS.has(safeNetworkCode)) {
      message = 'ArcGIS TLS certificate verification failed. Check the server certificate chain and trusted certificate authorities';
    } else if (safeNetworkCode === 'ENOTFOUND' || safeNetworkCode === 'EAI_AGAIN') {
      message = 'ArcGIS hostname could not be resolved. Check the Portal hostname, DNS, and network access';
    } else if (safeNetworkCode === 'ECONNREFUSED') {
      message = 'ArcGIS connection was refused. Check the host, port, and service availability';
    }
  }
  const suffix = [
    Number.isInteger(status) ? `HTTP ${status}` : '',
    Number.isInteger(arcgisCode) ? `ArcGIS ${arcgisCode}` : '',
    safeNetworkCode || '',
  ].filter(Boolean).join(', ');
  const error = endpointError(`${message}${suffix ? ` (${suffix})` : ''}.`, code);
  if (Number.isInteger(status)) error.httpStatus = status;
  if (Number.isInteger(arcgisCode)) error.arcgisCode = arcgisCode;
  if (safeNetworkCode) error.networkCode = safeNetworkCode;
  return error;
}

function assertArcGISResponse(value, status) {
  if (value && typeof value === 'object' && !Array.isArray(value) && value.error !== undefined) {
    const number = Number(value.error && value.error.code);
    const error = requestError('ARCGIS_ERROR', status, Number.isInteger(number) && number > 0 ? number : undefined);
    const message = value.error && value.error.message;
    if (number === 400 && typeof message === 'string' && /(?:operation|resource|subscription(?:\s*info)?)\s+(?:is\s+)?(?:not supported|unsupported|not available)/i.test(message)) {
      error.apiReason = 'UNSUPPORTED_OPERATION';
    }
    throw error;
  }
  return value;
}

function jsonRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { reject(requestError('INVALID_REQUEST')); return; }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
      reject(requestError('INVALID_REQUEST'));
      return;
    }
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      reject(requestError('INVALID_REQUEST'));
      return;
    }
    const headers = { Accept: 'application/json', Referer: 'http://localhost:8888', ...(options.headers || {}) };
    if (options.token) {
      for (const name of Object.keys(headers)) {
        if (/^authorization$/i.test(name)) delete headers[name];
      }
      headers.Authorization = `Bearer ${options.token}`;
    }
    const onLog = options.onLog || options.logger;
    const transport = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    let req;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      log(onLog, error ? 'warn' : 'debug', error ? `[API] ${error.message}` : '[API] JSON request completed.');
      if (error) reject(error);
      else resolve(result);
    };
    log(onLog, 'debug', '[API] Sending JSON request.');
    try {
      req = transport.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname.replace(/^\[|\]$/g, ''),
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers,
        ...(parsed.protocol === 'https:' ? {
          ca: tlsUtils.getSystemRootCertificates().pemBuffer,
          rejectUnauthorized: true,
        } : {}),
      }, res => {
        const status = res.statusCode;
        if (status >= 300 && status < 400) {
          finish(requestError('REDIRECT', status));
          res.destroy();
          req.destroy();
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', chunk => {
          if (settled) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            finish(requestError('RESPONSE_TOO_LARGE', status));
            res.destroy();
            req.destroy();
          } else chunks.push(buffer);
        });
        const failedResponse = error => {
          finish(requestError('NETWORK_ERROR', status, undefined, error && error.code));
          req.destroy();
        };
        res.on('aborted', () => failedResponse({ code: 'ECONNRESET' }));
        res.on('error', failedResponse);
        res.on('end', () => {
          if (settled) return;
          let result;
          try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
            finish(requestError('INVALID_JSON', status));
            return;
          }
          try { assertArcGISResponse(result, status); } catch (error) { finish(error); return; }
          if (!(status >= 200 && status < 300)) {
            finish(requestError('HTTP_ERROR', status));
            return;
          }
          finish(null, result);
        });
      });
      req.on('error', error => finish(requestError('NETWORK_ERROR', undefined, undefined, error && error.code)));
      timer = setTimeout(() => {
        finish(requestError('TIMEOUT'));
        req.destroy();
      }, timeoutMs);
      if (options.body !== undefined && options.body !== null) {
        if (!(typeof options.body === 'string' || Buffer.isBuffer(options.body))
            || Buffer.byteLength(options.body) > MAX_RESPONSE_BYTES) {
          finish(requestError('INVALID_REQUEST'));
          req.destroy();
          return;
        }
        req.write(options.body);
      }
      req.end();
    } catch {
      finish(requestError('INVALID_REQUEST'));
      if (req) req.destroy();
    }
  });
}

function tokenResult(token, expires, now = Date.now()) {
  const expiry = Number(expires);
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)
      || !Number.isSafeInteger(expiry) || expiry <= now || expiry > 8640000000000000) {
    throw requestError('INVALID_TOKEN');
  }
  return { token, expires: expiry };
}

async function generateToken(portalUrl, username, password, expiryMinutes = DEFAULT_TOKEN_EXPIRY_MINUTES, options = {}) {
  const portal = normalizePortalUrl(portalUrl);
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string'
      || !Number.isInteger(expiryMinutes) || expiryMinutes <= 0 || expiryMinutes > 20160) {
    throw endpointError('Enter a username, password, and valid token lifetime.', 'INVALID_CREDENTIALS');
  }
  const body = new URLSearchParams({
    username, password, client: 'referer', referer: 'http://localhost:8888',
    f: 'json', expiration: String(expiryMinutes),
  }).toString();
  log(options.onLog, 'info', '[Auth] Requesting a Portal password token.');
  const result = assertArcGISResponse(await (options.request || jsonRequest)(`${portal}/sharing/rest/generateToken`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, onLog: options.onLog,
  }));
  const value = tokenResult(result && result.token, result && result.expires, options.now ? options.now() : Date.now());
  log(options.onLog, 'info', '[Auth] Portal authentication succeeded.');
  return value;
}

async function generateOAuthToken(portalUrl, clientId, clientSecret, options = {}) {
  const portal = normalizePortalUrl(portalUrl);
  if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret) {
    throw endpointError('Enter an OAuth client ID and client secret.', 'INVALID_CREDENTIALS');
  }
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', f: 'json' }).toString();
  log(options.onLog, 'info', '[Auth] Requesting a Portal OAuth token.');
  const result = assertArcGISResponse(await (options.request || jsonRequest)(`${portal}/sharing/rest/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, onLog: options.onLog,
  }));
  const now = options.now ? options.now() : Date.now();
  const lifetime = Number(result && result.expires_in);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw requestError('INVALID_TOKEN');
  const value = tokenResult(result && result.access_token, now + lifetime * 1000, now);
  log(options.onLog, 'info', '[Auth] Portal authentication succeeded.');
  return value;
}

class TokenManager extends EventEmitter {
  constructor({ request = jsonRequest, onLog, now = Date.now } = {}) {
    super();
    this._request = request;
    this._onLog = onLog;
    this._now = now;
    this._generation = 0;
    this._token = null;
    this._expires = 0;
    this._credentials = null;
    this._refreshTimer = null;
    this._refreshPromise = null;
  }

  get token() { return this._token; }
  get expires() { return this._expires; }
  get isAuthenticated() { return !!this._token && this._now() < this._expires; }

  loginWithPassword(portalUrl, username, password, expiryMinutes = DEFAULT_TOKEN_EXPIRY_MINUTES) {
    return this._login({ mode: 'password', portalUrl, username, password, expiryMinutes });
  }

  loginWithOAuth(portalUrl, clientId, clientSecret) {
    return this._login({ mode: 'oauth', portalUrl, clientId, clientSecret });
  }

  async _issue(credentials) {
    const options = { request: this._request, onLog: this._onLog, now: this._now };
    return credentials.mode === 'password'
      ? generateToken(credentials.portalUrl, credentials.username, credentials.password, credentials.expiryMinutes, options)
      : generateOAuthToken(credentials.portalUrl, credentials.clientId, credentials.clientSecret, options);
  }

  async _login(credentials) {
    this.logout();
    const generation = this._generation;
    try {
      const result = await this._issue(credentials);
      this._assertGeneration(generation);
      this._credentials = credentials;
      this._setToken(result);
      this._assertGeneration(generation);
      return result;
    } catch (error) {
      this._assertGeneration(generation);
      log(this._onLog, 'warn', '[Auth] Portal authentication failed.');
      throw error;
    }
  }

  refresh() {
    if (this._refreshPromise) return this._refreshPromise;
    if (!this._credentials) return Promise.reject(endpointError('Sign in before refreshing a token.', 'AUTH_REQUIRED'));
    const generation = this._generation;
    const credentials = this._credentials;
    this._clearTimer();
    let pending;
    pending = this._issue(credentials).then(result => {
      this._assertGeneration(generation);
      this._setToken(result);
      this._assertGeneration(generation);
      return result;
    }).catch(error => {
      this._assertGeneration(generation);
      log(this._onLog, 'warn', '[Token] Token refresh failed.');
      throw error;
    }).finally(() => {
      if (this._refreshPromise === pending) this._refreshPromise = null;
    });
    this._refreshPromise = pending;
    return pending;
  }

  logout() {
    this._generation++;
    this._clearTimer();
    this._token = null;
    this._expires = 0;
    this._credentials = null;
    this._refreshPromise = null;
  }

  _assertGeneration(generation) {
    if (generation !== this._generation) throw endpointError('The authentication session changed. Sign in again.', 'STALE_SESSION');
  }

  _setToken(result) {
    const value = tokenResult(result.token, result.expires, this._now());
    this._token = value.token;
    this._expires = value.expires;
    this._scheduleRefresh();
    this.emit('refreshed', value.token);
  }

  _scheduleRefresh() {
    this._clearTimer();
    const delay = Math.min(MAX_TIMER_MS, Math.max(1, Math.floor((this._expires - this._now()) * 0.8)));
    this._scheduleTimer(() => this._backgroundRefresh(0, this._generation), delay);
  }

  _backgroundRefresh(attempt, generation) {
    if (generation !== this._generation) return;
    this.refresh().catch(error => {
      if (generation !== this._generation) return;
      if (attempt < 5) {
        this._scheduleTimer(() => this._backgroundRefresh(attempt + 1, generation), 1000 * 2 ** attempt);
      } else if (this.listenerCount('error')) this.emit('error', error);
    });
  }

  _scheduleTimer(callback, delay) {
    this._clearTimer();
    this._refreshTimer = setTimeout(callback, delay);
    if (this._refreshTimer.unref) this._refreshTimer.unref();
  }

  _clearTimer() {
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = null;
  }
}

module.exports = {
  DEFAULT_PORTAL_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  jsonRequest,
  generateToken,
  generateOAuthToken,
  TokenManager,
  assertArcGISResponse,
};
