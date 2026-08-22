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
 * @file xmpp-utils.js
 * @description
 * Shared helpers for secret handling, loopback detection, identifiers, input
 * validation, and authentication rate limiting used by the XMPP transport.
 *
 * Kept in one place so the server, the client wrapper, the transport facade
 * and the MUC service never duplicate the same logic (see the DRY guidance in
 * AGENTS.md).
 */

const crypto = require('crypto');
const { XMPP_MAX_BODY_BYTES, XMPP_MAX_DESTINATIONS } = require('./xmpp-constants');

function normalizeDomain(value, label = 'XMPP domain') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) throw new Error(`${label} is required.`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F/@<>'"&:]/.test(raw) || raw.startsWith('.') || raw.endsWith('.')) {
    throw new Error(`${label} is not a valid domain: '${raw}'.`);
  }
  return raw;
}

function normalizeAccountUsername(value, label = 'XMPP username') {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!raw) throw new Error(`${label} is required.`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F/@<>'"&:]/.test(raw)) {
    throw new Error(`${label} contains characters that are not allowed: '${raw}'.`);
  }
  return raw;
}

/**
 * Replaces a secret with a non-reversible marker so it can be mentioned in logs
 * without ever disclosing its value. Only the byte length is revealed.
 *
 * @param {string|Buffer|null|undefined} secret
 * @returns {string}
 */
function redactSecret(secret) {
  if (secret === null || secret === undefined || secret === '') return '<empty>';
  const length = Buffer.byteLength(String(secret), 'utf8');
  return `<redacted:${length}B>`;
}

/**
 * True when the host is a loopback address or `localhost`. Used to keep the
 * built-in server loopback-only by default and to gate the local-testing TLS
 * verification bypass.
 *
 * @param {string} host
 * @returns {boolean}
 */
function isLoopbackHost(host) {
  if (!host) return false;
  const normalized = String(host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost') return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;
  if (normalized === '::ffff:127.0.0.1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}

/**
 * Validates a bare JID of the form `local@domain`. A resource part is
 * rejected rather than stripped so an operator is told when a setting that
 * must be bare was given a full JID.
 *
 * @param {string} value
 * @param {string} label - Human-readable field name used in the error message.
 * @returns {string} the normalized bare JID
 * @throws {Error} when the value is missing, malformed, or carries a resource
 */
function requireBareJid(value, label) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error(`${label} is required.`);
  if (raw.includes('/')) {
    throw new Error(`${label} must be a bare JID without a resource (user@domain), got '${raw}'.`);
  }
  const at = raw.indexOf('@');
  if (at <= 0 || at !== raw.lastIndexOf('@') || at === raw.length - 1) {
    throw new Error(`${label} must be a bare JID of the form user@domain, got '${raw}'.`);
  }
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001F\u007F<>'"&:]/.test(raw)) {
    throw new Error(`${label} contains characters that are not allowed in a JID: '${raw}'.`);
  }
  const local = normalizeAccountUsername(raw.slice(0, at), label);
  const domain = normalizeDomain(raw.slice(at + 1), label);
  return `${local}@${domain}`;
}

/**
 * Parses a comma-separated destination list into unique bare JIDs.
 *
 * @param {string} value
 * @param {object} [opts]
 * @param {number} [opts.max=XMPP_MAX_DESTINATIONS]
 * @param {string} [opts.label='Destination JID']
 * @returns {string[]}
 * @throws {Error} when the list is empty, over the cap, or contains a bad JID
 */
function parseDestinationList(value, { max = XMPP_MAX_DESTINATIONS, label = 'Destination JID' } = {}) {
  const entries = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error(`${label} is required.`);
  const seen = new Set();
  for (const entry of entries) seen.add(requireBareJid(entry, label));
  if (seen.size > max) {
    throw new Error(`At most ${max} unique comma-separated destinations are allowed, got ${seen.size}.`);
  }
  return [...seen];
}

/**
 * Enforces the published message-body byte cap. Bodies are rejected rather
 * than truncated so a replay never silently loses data.
 *
 * @param {string} body
 * @param {number} [max=XMPP_MAX_BODY_BYTES]
 * @returns {string} the body, unchanged
 * @throws {Error} when the UTF-8 encoding exceeds the cap
 */
function assertBodyWithinLimit(body, max = XMPP_MAX_BODY_BYTES) {
  const bytes = Buffer.byteLength(String(body ?? ''), 'utf8');
  if (bytes > max) {
    throw new Error(`Message body is ${bytes} UTF-8 bytes, which exceeds the ${max}-byte XMPP limit.`);
  }
  return body;
}

/**
 * Validates a MUC room nickname. `/` and `@` would break the occupant JID and
 * control characters are not transportable, so both are rejected.
 *
 * @param {string} value
 * @param {string} [label='Room nickname']
 * @returns {string}
 */
function requireNickname(value, label = 'Room nickname') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error(`${label} is required.`);
  // eslint-disable-next-line no-control-regex
  if (/[/@\u0000-\u001F\u007F]/.test(raw)) {
    throw new Error(`${label} must not contain '/', '@' or control characters, got '${raw}'.`);
  }
  if (raw.length > 128) throw new Error(`${label} must be 128 characters or fewer.`);
  return raw;
}

/**
 * Generates a short, collision-resistant stanza/stream identifier.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
function randomStanzaId(prefix = 'x') {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Constant-time comparison of two UTF-8 strings. Used for password and SCRAM
 * proof comparisons so authentication does not leak timing information.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualString(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Constant-time comparison of two buffers of possibly different lengths.
 *
 * @param {Buffer} a
 * @param {Buffer} b
 * @returns {boolean}
 */
function timingSafeEqualBuffer(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Sanitizes a requested XMPP resource part: control characters, `/` and `@`
 * are removed and the result is length capped. Returns null when nothing
 * usable remains, in which case the server assigns a resource.
 *
 * @param {string} value
 * @returns {string|null}
 */
function sanitizeResource(value) {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001F\u007F/@]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 128);
}

/**
 * Decodes the text content of a SASL `<auth/>`, `<challenge/>`, `<response/>`
 * or `<success/>` element. Per RFC 6120 a lone `=` denotes an empty payload.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeSaslPayload(text) {
  const raw = (text || '').trim();
  if (raw === '' || raw === '=') return '';
  if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
    throw new Error('Invalid base64 SASL payload');
  }
  return Buffer.from(raw, 'base64').toString('utf8');
}

/**
 * Sliding-window attempt counter keyed by an arbitrary string (the remote
 * address, in practice). Provisional charges can be refunded after success.
 *
 * @param {object} opts
 * @param {number} opts.windowMs
 * @param {number} opts.maxFailures
 */
function createRateLimiter({ windowMs, maxFailures }) {
  const buckets = new Map();

  function prune(key, now) {
    const entries = buckets.get(key);
    if (!entries) return [];
    const kept = entries.filter((entry) => now - entry.timestamp < windowMs);
    if (kept.length === 0) buckets.delete(key);
    else buckets.set(key, kept);
    return kept;
  }

  return {
    /** @returns {boolean} true when the key has exceeded its failure budget */
    isLimited(key, now = Date.now()) {
      return prune(key, now).length >= maxFailures;
    },
    /** Records one failure and returns the current failure count in-window. */
    recordFailure(key, now = Date.now()) {
      const kept = prune(key, now);
      kept.push({ timestamp: now, token: null });
      buckets.set(key, kept);
      return kept.length;
    },
    /**
     * Atomically reserves one attempt before expensive authentication work.
     * Returns an opaque token, or null when the budget is already exhausted.
     */
    charge(key, now = Date.now()) {
      const kept = prune(key, now);
      if (kept.length >= maxFailures) return null;
      const token = Symbol('rate-limit-charge');
      kept.push({ timestamp: now, token });
      buckets.set(key, kept);
      return token;
    },
    /** Removes exactly one successful attempt's provisional charge. */
    refund(key, token, now = Date.now()) {
      if (!token) return false;
      const kept = prune(key, now);
      const index = kept.findIndex((entry) => entry.token === token);
      if (index < 0) return false;
      kept.splice(index, 1);
      if (kept.length === 0) buckets.delete(key);
      else buckets.set(key, kept);
      return true;
    },
    /** Administratively clears the history for a key. */
    reset(key) {
      buckets.delete(key);
    },
    /** Clears all history — used for deterministic tests. */
    clear() {
      buckets.clear();
    },
    get size() {
      return buckets.size;
    },
  };
}

module.exports = {
  normalizeDomain,
  normalizeAccountUsername,
  redactSecret,
  isLoopbackHost,
  requireBareJid,
  parseDestinationList,
  assertBodyWithinLimit,
  requireNickname,
  randomStanzaId,
  timingSafeEqualString,
  timingSafeEqualBuffer,
  sanitizeResource,
  decodeSaslPayload,
  createRateLimiter,
};
