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
 * @file xmpp-accounts.js
 * @description
 * Minimal in-memory account store for the built-in XMPP server.
 *
 * Exactly two identities are supported and nothing else — no registration, no
 * roster, no persistence:
 *
 *   1. **Automatic application identity** — the account the ArcGIS Velocity
 *      Simulator itself publishes as. Its password is generated with
 *      `crypto.randomBytes` when not supplied and is never written to a log.
 *   2. **One configurable external account** — the single third-party account
 *      an integrator points at the server, for example an ArcGIS Velocity
 *      feed or an ArcGIS GeoEvent Server connector. Configurable through the
 *      XMPP options, the command line, or environment variables.
 *
 * Passwords are held in memory in cleartext because SCRAM-SHA-1 needs the
 * original password to derive the salted key. Accounts live only for the
 * lifetime of the running server and are never written to disk.
 */

const crypto = require('crypto');
const {
  normalizeAccountUsername,
  normalizeDomain,
  redactSecret,
  timingSafeEqualString,
} = require('./xmpp-utils');

/** Username of the automatic simulator application identity. */
const INTERNAL_APP_USERNAME = 'velocity-simulator';

/** Environment variables that configure the single external account. */
const EXTERNAL_ACCOUNT_ENV = Object.freeze({
  USERNAME: 'XMPP_EXTERNAL_USERNAME',
  PASSWORD: 'XMPP_EXTERNAL_PASSWORD',
});

/**
 * Reads the external account from the environment.
 *
 * @param {object} [env=process.env]
 * @returns {{username: string, password: string}|null}
 */
function readExternalAccountFromEnv(env = process.env) {
  const username = env[EXTERNAL_ACCOUNT_ENV.USERNAME];
  const password = env[EXTERNAL_ACCOUNT_ENV.PASSWORD];
  if (!username || !password) return null;
  return { username: String(username), password: String(password) };
}

/**
 * Creates the account store.
 *
 * @param {object} opts
 * @param {string} opts.domain - Served XMPP domain, e.g. `localhost`.
 * @param {string} [opts.internalAppUsername=INTERNAL_APP_USERNAME]
 * @param {string} [opts.internalAppPassword] - Generated when omitted.
 * @param {{username: string, password: string}|null} [opts.externalAccount]
 *        The single configurable external account. Falls back to the
 *        environment variables when omitted.
 * @param {object} [opts.env=process.env]
 */
function createAccountStore({
  domain,
  internalAppUsername = INTERNAL_APP_USERNAME,
  internalAppPassword,
  externalAccount,
  env = process.env,
} = {}) {
  if (!domain) throw new Error('createAccountStore requires a domain');

  const canonicalDomain = normalizeDomain(domain);
  const canonicalInternalUsername = normalizeAccountUsername(
    internalAppUsername,
    'Internal XMPP account username',
  );
  const accounts = new Map();

  const internalPassword = internalAppPassword || crypto.randomBytes(24).toString('base64url');
  accounts.set(canonicalInternalUsername, {
    username: canonicalInternalUsername,
    password: internalPassword,
    kind: 'internal',
  });

  const resolvedExternal =
    externalAccount === null ? null : externalAccount || readExternalAccountFromEnv(env);

  if (resolvedExternal) {
    if (!resolvedExternal.username || !resolvedExternal.password) {
      throw new Error('External XMPP account requires both a username and a password');
    }
    const externalUsername = normalizeAccountUsername(
      String(resolvedExternal.username).split('@')[0],
      'External XMPP account username',
    );
    if (externalUsername === canonicalInternalUsername) {
      throw new Error('External XMPP account username must differ from the internal app identity');
    }
    accounts.set(externalUsername, {
      username: externalUsername,
      password: String(resolvedExternal.password),
      kind: 'external',
    });
    resolvedExternal.username = externalUsername;
  }

  return {
    domain: canonicalDomain,

    /** @returns {boolean} whether the username is known to the store */
    has(username) {
      try {
        return accounts.has(normalizeAccountUsername(username));
      } catch (_) {
        return false;
      }
    },

    /**
     * Returns the cleartext password for a username, or null. Only the SASL
     * layer may call this; the value must never be logged.
     *
     * @param {string} username
     * @returns {string|null}
     */
    getPassword(username) {
      try {
        const account = accounts.get(normalizeAccountUsername(username));
        return account ? account.password : null;
      } catch (_) {
        return null;
      }
    },

    /**
     * Verifies a username/password pair in constant time. Unknown usernames are
     * compared against a dummy value so the response time does not disclose
     * account existence.
     *
     * @param {string} username
     * @param {string} password
     * @returns {boolean}
     */
    verifyPassword(username, password) {
      let canonicalUsername;
      try {
        canonicalUsername = normalizeAccountUsername(username);
      } catch (_) {
        timingSafeEqualString(String(password ?? ''), 'invalid-account-placeholder');
        return false;
      }
      const account = accounts.get(canonicalUsername);
      if (!account) {
        timingSafeEqualString(String(password ?? ''), 'invalid-account-placeholder');
        return false;
      }
      return timingSafeEqualString(account.password, String(password ?? ''));
    },

    /** @returns {{username: string, password: string, jid: string}} */
    getInternalCredentials() {
      const account = accounts.get(canonicalInternalUsername);
      return {
        username: account.username,
        password: account.password,
        jid: `${account.username}@${canonicalDomain}`,
      };
    },

    /** @returns {{username: string, password: string, jid: string}|null} */
    getExternalCredentials() {
      if (!resolvedExternal) return null;
      const account = accounts.get(resolvedExternal.username);
      return {
        username: account.username,
        password: account.password,
        jid: `${account.username}@${canonicalDomain}`,
      };
    },

    /** @returns {string[]} usernames, for diagnostics */
    listUsernames() {
      return [...accounts.keys()];
    },

    /**
     * Log-safe description of the store. Passwords are redacted to a length
     * marker and never emitted verbatim.
     *
     * @returns {object}
     */
    describe() {
      return {
        domain: canonicalDomain,
        internal: {
          username: canonicalInternalUsername,
          password: redactSecret(internalPassword),
        },
        external: resolvedExternal
          ? { username: resolvedExternal.username, password: redactSecret(resolvedExternal.password) }
          : null,
        accountCount: accounts.size,
      };
    },
  };
}

module.exports = {
  INTERNAL_APP_USERNAME,
  EXTERNAL_ACCOUNT_ENV,
  readExternalAccountFromEnv,
  createAccountStore,
};
