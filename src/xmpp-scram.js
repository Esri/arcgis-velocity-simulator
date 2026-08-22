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
 * @file xmpp-scram.js
 * @description
 * Shared SCRAM-SHA-1 (RFC 5802) primitives and the client-side mechanism used
 * by the XMPP client core.
 *
 * Both the in-process server mechanism (`xmpp-sasl-server.js`) and the client
 * mechanism defined here derive their keys through these helpers so the two
 * sides of a local Simulator/Logger test always agree.
 *
 * The client mechanism replaces the bundled `sasl-scram-sha-1` implementation,
 * which derives keys through WebCrypto and therefore rejects a zero-length
 * HMAC key. Node's `crypto` accepts an empty key, so an account configured
 * with a present-but-empty password authenticates normally.
 */

const crypto = require('crypto');

const SCRAM_DIGEST = 'sha1';
const SCRAM_KEY_LENGTH = 20;
const SCRAM_MECHANISM_NAME = 'SCRAM-SHA-1';

function hmac(key, data) {
  return crypto.createHmac(SCRAM_DIGEST, key).update(data).digest();
}

function hash(data) {
  return crypto.createHash(SCRAM_DIGEST).update(data).digest();
}

function xorBuffers(a, b) {
  const out = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] ^ b[i];
  return out;
}

/**
 * Parses a comma-separated SCRAM attribute list (`a=1,b=2`) into a map.
 * Values may themselves contain `=` (base64 padding), so only the first `=`
 * splits the pair.
 *
 * @param {string} text
 * @returns {Map<string, string>}
 */
function parseScramAttributes(text) {
  const map = new Map();
  for (const token of String(text || '').split(',')) {
    if (!token) continue;
    const idx = token.indexOf('=');
    if (idx <= 0) continue;
    map.set(token.slice(0, idx), token.slice(idx + 1));
  }
  return map;
}

/** Reverses the SCRAM `saslname` escaping of `,` and `=`. */
function unescapeSaslName(name) {
  return String(name).replace(/=2C/g, ',').replace(/=3D/g, '=');
}

/** Applies the SCRAM `saslname` escaping of `,` and `=`. */
function escapeSaslName(name) {
  return String(name === null || name === undefined ? '' : name)
    .replace(/=/g, '=3D')
    .replace(/,/g, '=2C');
}

/**
 * Derives the SCRAM keys for a cleartext password. An empty password is a
 * valid input and produces a stable key set.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 * @returns {{saltedPassword: Buffer, clientKey: Buffer, storedKey: Buffer, serverKey: Buffer}}
 */
function deriveScramKeys(password, salt, iterations) {
  const saltedPassword = crypto.pbkdf2Sync(
    Buffer.from(password === null || password === undefined ? '' : String(password), 'utf8'),
    salt,
    iterations,
    SCRAM_KEY_LENGTH,
    SCRAM_DIGEST,
  );
  const clientKey = hmac(saltedPassword, 'Client Key');
  const serverKey = hmac(saltedPassword, 'Server Key');
  return { saltedPassword, clientKey, storedKey: hash(clientKey), serverKey };
}

/**
 * Client-side SCRAM-SHA-1 mechanism compatible with the `saslmechanisms`
 * factory used by `@xmpp/client`: a constructor whose prototype exposes
 * `name`, `clientFirst`, `response(credentials)`, and `challenge(text)`.
 *
 * Channel binding is not used; the mechanism sends the `n,,` gs2 header.
 */
function ScramSha1ClientMechanism(options = {}) {
  this._genNonce = options.genNonce || (() => crypto.randomBytes(16).toString('hex'));
  this._stage = 'initial';
}

ScramSha1ClientMechanism.Mechanism = ScramSha1ClientMechanism;
ScramSha1ClientMechanism.prototype.name = SCRAM_MECHANISM_NAME;
ScramSha1ClientMechanism.prototype.clientFirst = true;

ScramSha1ClientMechanism.prototype.challenge = function challenge(text) {
  const attrs = parseScramAttributes(text);
  this._salt = Buffer.from(attrs.get('s') || '', 'base64');
  this._iterationCount = parseInt(attrs.get('i'), 10);
  this._nonce = attrs.get('r');
  this._verifier = attrs.get('v');
  this._error = attrs.get('e');
  this._challenge = String(text || '');
  return this;
};

ScramSha1ClientMechanism.prototype.response = function response(credentials = {}) {
  if (this._stage === 'initial') {
    this._cnonce = this._genNonce();
    const authzid = credentials.authzid ? `a=${escapeSaslName(credentials.authzid)}` : '';
    this._gs2Header = `n,${authzid},`;
    this._clientFirstMessageBare = `n=${escapeSaslName(credentials.username || '')},r=${this._cnonce}`;
    this._stage = 'challenge';
    return this._gs2Header + this._clientFirstMessageBare;
  }

  if (this._stage === 'challenge') {
    if (this._error) throw new Error(`SCRAM-SHA-1 server error: ${this._error}`);
    if (!this._nonce || !this._nonce.startsWith(this._cnonce)) {
      throw new Error('SCRAM-SHA-1 server nonce does not extend the client nonce');
    }
    if (!Number.isInteger(this._iterationCount) || this._iterationCount <= 0) {
      throw new Error('SCRAM-SHA-1 iteration count must be a positive integer');
    }
    // An empty password is valid here: Node's HMAC accepts a zero-length key.
    const keys = deriveScramKeys(credentials.password || '', this._salt, this._iterationCount);
    const clientFinalWithoutProof = `c=${Buffer.from(this._gs2Header, 'utf8').toString('base64')},r=${this._nonce}`;
    const authMessage = `${this._clientFirstMessageBare},${this._challenge},${clientFinalWithoutProof}`;
    const clientSignature = hmac(keys.storedKey, authMessage);
    const clientProof = xorBuffers(keys.clientKey, clientSignature);
    this._serverSignature = hmac(keys.serverKey, authMessage).toString('base64');
    this._stage = 'final';
    return `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`;
  }

  // Final step: the server signature is verified when the server provides one.
  if (this._verifier && this._verifier !== this._serverSignature) {
    throw new Error('SCRAM-SHA-1 server signature verification failed');
  }
  return '';
};

/**
 * Registers the Node-crypto SCRAM-SHA-1 mechanism on an `@xmpp/client` SASL
 * factory, replacing the bundled WebCrypto implementation so an empty password
 * is supported. Safe to call more than once.
 *
 * @param {{_mechs: Array<{name: string, mech: Function}>, use: Function}} saslFactory
 * @returns {boolean} true when the factory was updated
 */
function useScramSha1ClientMechanism(saslFactory) {
  if (!saslFactory || !Array.isArray(saslFactory._mechs)) return false;
  const entry = { name: SCRAM_MECHANISM_NAME, mech: ScramSha1ClientMechanism };
  const index = saslFactory._mechs.findIndex((candidate) => candidate.name === SCRAM_MECHANISM_NAME);
  if (index >= 0) saslFactory._mechs[index] = entry;
  else saslFactory._mechs.unshift(entry);
  return true;
}

module.exports = {
  SCRAM_DIGEST,
  SCRAM_KEY_LENGTH,
  SCRAM_MECHANISM_NAME,
  hmac,
  hash,
  xorBuffers,
  parseScramAttributes,
  escapeSaslName,
  unescapeSaslName,
  deriveScramKeys,
  ScramSha1ClientMechanism,
  useScramSha1ClientMechanism,
};
