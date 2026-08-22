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
 * @file xmpp-sasl-server.js
 * @description
 * Server-side SASL mechanisms for the built-in XMPP server: PLAIN (RFC 4616)
 * and SCRAM-SHA-1 (RFC 5802).
 *
 * The mechanisms are pure state machines with no I/O — they consume the decoded
 * payload of `<auth/>` / `<response/>` and return the next step. The stream
 * layer in `xmpp-server-core.js` performs all base64 and XML handling. This keeps
 * the crypto independently unit-testable and free of transport concerns.
 *
 * Every step returns one of:
 *   `{ status: 'challenge', payload: <string> }`
 *   `{ status: 'success', username: <string>, payload: <string|null> }`
 *   `{ status: 'failure', condition: <SASL error condition>, reason: <string> }`
 */

const crypto = require('crypto');
const {
  SASL_MECHANISMS,
  SCRAM_SHA_1_ITERATIONS,
  SCRAM_SHA_1_SALT_BYTES,
} = require('./xmpp-constants');
const { timingSafeEqualBuffer } = require('./xmpp-utils');

/** SASL failure conditions used by the server (RFC 6120 §6.5). */
const SASL_CONDITIONS = Object.freeze({
  ABORTED: 'aborted',
  INCORRECT_ENCODING: 'incorrect-encoding',
  INVALID_AUTHZID: 'invalid-authzid',
  INVALID_MECHANISM: 'invalid-mechanism',
  MALFORMED_REQUEST: 'malformed-request',
  NOT_AUTHORIZED: 'not-authorized',
  TEMPORARY_AUTH_FAILURE: 'temporary-auth-failure',
});

function failure(condition, reason) {
  return { status: 'failure', condition, reason };
}

// =============================================================================
// PLAIN — RFC 4616
// =============================================================================

/**
 * Creates a PLAIN mechanism instance.
 *
 * @param {object} deps
 * @param {(username: string, password: string) => boolean} deps.verifyPassword
 * @returns {{name: string, start: Function, next: Function}}
 */
function createPlainMechanism({ verifyPassword }) {
  let done = false;

  return {
    name: SASL_MECHANISMS.PLAIN,

    /**
     * @param {string} initial - Decoded `authzid \0 authcid \0 passwd`
     */
    start(initial) {
      if (done) return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'PLAIN already completed');
      done = true;

      if (typeof initial !== 'string' || initial.length === 0) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'PLAIN requires an initial response');
      }
      const parts = initial.split('\u0000');
      if (parts.length !== 3) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'PLAIN payload must have three NUL-separated fields');
      }
      const [authzid, authcid, password] = parts;
      if (!authcid) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'PLAIN authcid is empty');
      }
      // A supplied authzid may only be the bare/nodeprepped form of the authcid.
      if (authzid && authzid !== authcid && authzid.split('@')[0] !== authcid) {
        return failure(SASL_CONDITIONS.INVALID_AUTHZID, 'PLAIN authzid does not match authcid');
      }
      if (!verifyPassword(authcid, password)) {
        return failure(SASL_CONDITIONS.NOT_AUTHORIZED, 'Invalid username or password');
      }
      return { status: 'success', username: authcid, payload: null };
    },

    next() {
      return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'PLAIN does not accept a response step');
    },
  };
}

// =============================================================================
// SCRAM-SHA-1 — RFC 5802
// =============================================================================

const SCRAM_DIGEST = 'sha1';
const SCRAM_KEY_LENGTH = 20;

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
  for (const token of text.split(',')) {
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

/**
 * Derives the SCRAM keys for a cleartext password.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @param {number} iterations
 */
function deriveScramKeys(password, salt, iterations) {
  const saltedPassword = crypto.pbkdf2Sync(
    Buffer.from(password, 'utf8'),
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
 * Creates a SCRAM-SHA-1 mechanism instance.
 *
 * Channel binding is not supported: only the `n` and `y` gs2 flags with an
 * empty channel-binding data field are accepted, which is what `@xmpp/client`
 * sends.
 *
 * @param {object} deps
 * @param {(username: string) => (string|null)} deps.lookupPassword
 * @param {number} [deps.iterations]
 * @param {Buffer} [deps.salt] - Fixed salt, for deterministic tests only.
 * @param {string} [deps.serverNonce] - Fixed nonce, for deterministic tests only.
 */
function createScramSha1Mechanism({
  lookupPassword,
  iterations = SCRAM_SHA_1_ITERATIONS,
  salt: fixedSalt,
  serverNonce: fixedServerNonce,
}) {
  let stage = 'initial';
  const state = {
    username: null,
    clientFirstBare: null,
    serverFirst: null,
    combinedNonce: null,
    gs2Header: null,
    keys: null,
  };

  return {
    name: SASL_MECHANISMS.SCRAM_SHA_1,

    /**
     * @param {string} clientFirst - Decoded `n,,n=user,r=nonce`
     */
    start(clientFirst) {
      if (stage !== 'initial') {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'SCRAM already started');
      }
      if (typeof clientFirst !== 'string' || clientFirst.length === 0) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'SCRAM requires an initial response');
      }

      const gs2Flag = clientFirst[0];
      if (gs2Flag === 'p') {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'SCRAM channel binding is not supported');
      }
      if (gs2Flag !== 'n' && gs2Flag !== 'y') {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'Malformed SCRAM gs2 header');
      }

      const firstComma = clientFirst.indexOf(',');
      const secondComma = clientFirst.indexOf(',', firstComma + 1);
      if (firstComma < 0 || secondComma < 0) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'Malformed SCRAM gs2 header');
      }

      state.gs2Header = clientFirst.slice(0, secondComma + 1);
      state.clientFirstBare = clientFirst.slice(secondComma + 1);

      const attrs = parseScramAttributes(state.clientFirstBare);
      const rawUsername = attrs.get('n');
      const clientNonce = attrs.get('r');
      if (rawUsername === undefined || !clientNonce) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'SCRAM client-first-message is missing n= or r=');
      }

      state.username = unescapeSaslName(rawUsername);
      const password = lookupPassword(state.username);

      // Unknown accounts still receive a well-formed challenge so that the
      // client-first step does not disclose account existence; the proof check
      // in the final step fails for a random password.
      const effectivePassword = password === null || password === undefined
        ? crypto.randomBytes(32).toString('hex')
        : password;

      const salt = fixedSalt || crypto.randomBytes(SCRAM_SHA_1_SALT_BYTES);
      const serverNonce = fixedServerNonce || crypto.randomBytes(18).toString('base64');
      state.combinedNonce = `${clientNonce}${serverNonce}`;
      state.keys = deriveScramKeys(effectivePassword, salt, iterations);
      state.accountExists = password !== null && password !== undefined;

      state.serverFirst = `r=${state.combinedNonce},s=${salt.toString('base64')},i=${iterations}`;
      stage = 'final';
      return { status: 'challenge', payload: state.serverFirst };
    },

    /**
     * @param {string} clientFinal - Decoded `c=biws,r=<nonce>,p=<proof>`
     */
    next(clientFinal) {
      if (stage !== 'final') {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'Unexpected SCRAM response');
      }
      stage = 'done';

      if (typeof clientFinal !== 'string' || clientFinal.length === 0) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'Empty SCRAM client-final-message');
      }

      const proofIndex = clientFinal.lastIndexOf(',p=');
      if (proofIndex < 0) {
        return failure(SASL_CONDITIONS.MALFORMED_REQUEST, 'SCRAM client-final-message is missing p=');
      }
      const withoutProof = clientFinal.slice(0, proofIndex);
      const proofB64 = clientFinal.slice(proofIndex + 3);

      const attrs = parseScramAttributes(clientFinal);
      if (attrs.get('r') !== state.combinedNonce) {
        return failure(SASL_CONDITIONS.NOT_AUTHORIZED, 'SCRAM nonce mismatch');
      }
      const channelBinding = attrs.get('c');
      if (channelBinding !== Buffer.from(state.gs2Header, 'utf8').toString('base64')) {
        return failure(SASL_CONDITIONS.NOT_AUTHORIZED, 'SCRAM channel-binding mismatch');
      }

      let clientProof;
      if (proofB64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(proofB64)) {
        return failure(SASL_CONDITIONS.INCORRECT_ENCODING, 'SCRAM proof is not valid base64');
      }
      try {
        clientProof = Buffer.from(proofB64, 'base64');
      } catch (_) {
        return failure(SASL_CONDITIONS.INCORRECT_ENCODING, 'SCRAM proof is not valid base64');
      }
      if (clientProof.length !== SCRAM_KEY_LENGTH) {
        return failure(SASL_CONDITIONS.INCORRECT_ENCODING, 'SCRAM proof has an unexpected length');
      }

      const authMessage = `${state.clientFirstBare},${state.serverFirst},${withoutProof}`;
      const clientSignature = hmac(state.keys.storedKey, authMessage);
      const candidateClientKey = xorBuffers(clientProof, clientSignature);

      if (!timingSafeEqualBuffer(hash(candidateClientKey), state.keys.storedKey) || !state.accountExists) {
        return failure(SASL_CONDITIONS.NOT_AUTHORIZED, 'Invalid username or password');
      }

      const serverSignature = hmac(state.keys.serverKey, authMessage);
      return {
        status: 'success',
        username: state.username,
        payload: `v=${serverSignature.toString('base64')}`,
      };
    },
  };
}

/**
 * Factory dispatch for the mechanisms the built-in server implements.
 *
 * @param {string} mechanismName
 * @param {object} deps
 * @param {(username: string, password: string) => boolean} deps.verifyPassword
 * @param {(username: string) => (string|null)} deps.lookupPassword
 * @returns {object|null} mechanism instance, or null when unsupported
 */
function createServerMechanism(mechanismName, deps) {
  if (mechanismName === SASL_MECHANISMS.PLAIN) return createPlainMechanism(deps);
  if (mechanismName === SASL_MECHANISMS.SCRAM_SHA_1) return createScramSha1Mechanism(deps);
  return null;
}

module.exports = {
  SASL_CONDITIONS,
  createPlainMechanism,
  createScramSha1Mechanism,
  createServerMechanism,
  deriveScramKeys,
  parseScramAttributes,
  unescapeSaslName,
};
