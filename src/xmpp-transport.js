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
 * @file xmpp-transport.js
 * @description
 * XMPP (RFC 6120/6121) transport for the ArcGIS Velocity Simulator.
 *
 * Two roles are supported and both publish the same replayed CSV lines:
 *
 *   - **Client** — signs in to an XMPP server (the Simulator's own server, an
 *     ArcGIS Velocity XMPP feed, an ArcGIS GeoEvent Server XMPP connector, or
 *     any standards-compliant server) and publishes each line either as a
 *     one-to-one `chat` message to up to 20 destination JIDs, or as a
 *     `groupchat` message in a Multi-User Chat room.
 *   - **Server** — hosts a loopback-safe client-to-server endpoint that a
 *     receiver signs in to, then publishes each line from the automatic
 *     simulator application identity to every signed-in stream, or into a
 *     room the application identity occupies.
 *
 * This module is the single integration point used by the Electron main
 * process (UI mode) and by `transport-manager.js` (headless mode). It matches
 * the shape of the other transports in this repository — `connect()`,
 * `send()`, `disconnect()`, `isConnected()` — so the simulation engine needs
 * no protocol-specific branches.
 *
 * Structured `[XMPP]` log lines are emitted through the injected `onLog`
 * callback. Passwords, room passwords and tokens are never logged.
 */

const fs = require('fs');
const {
  XMPP_CONVERSATIONS,
  XMPP_DEFAULT_C2S_PORT,
  XMPP_DEFAULT_DOMAIN,
  XMPP_DEFAULT_MUC_SUBDOMAIN,
  XMPP_DEFAULT_NICKNAME,
  XMPP_DEFAULT_RESOURCE,
  XMPP_DEFAULT_TLS_POLICY,
  XMPP_MAX_BODY_BYTES,
  XMPP_MAX_DESTINATIONS,
  XMPP_MIN_TIMING_MS,
  XMPP_ROLES,
  XMPP_TIMING_OPTIONS,
  STARTTLS_POLICIES,
  STREAM_MANAGEMENT_SUPPORT,
  VALID_STARTTLS_POLICIES,
  VALID_XMPP_CONVERSATIONS,
} = require('./xmpp-constants');
const { INTERNAL_APP_USERNAME } = require('./xmpp-accounts');
const {
  assertBodyWithinLimit,
  isLoopbackHost,
  normalizeAccountUsername,
  normalizeDomain,
  parseDestinationList,
  requireBareJid,
  requireNickname,
} = require('./xmpp-utils');
const { formatTlsCertSummary, getSystemRootCertificates } = require('./tls-utils');

/** Only these transports are surfaced in the UI and CLI as `protocol=xmpp`. */
const XMPP_PROTOCOL = 'xmpp';

/**
 * Canonical option name of the client account password. Referenced by name so
 * the copied client-settings block stays in step with the CLI, the launch
 * configuration files, and the documentation.
 */
const XMPP_PASSWORD_OPTION = 'xmppPassword';

/**
 * Normalizes a room JID. A bare room name is qualified with the conversation
 * sub-domain of the served/target domain so an operator can type `traffic`
 * instead of `traffic@conference.example.com`.
 *
 * @param {string} value
 * @param {string} domain
 * @returns {string}
 */
function resolveRoomJid(value, domain) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) throw new Error('Room JID is required when Conversation is set to Room (MUC).');
  const bare = raw.split('/')[0];
  const qualified = bare.includes('@')
    ? bare
    : `${bare}@${XMPP_DEFAULT_MUC_SUBDOMAIN}.${domain}`;
  return requireBareJid(qualified, 'Room JID');
}

/**
 * Validates and normalizes the options shared by both roles.
 * Throws a single, actionable error for the first problem it finds.
 */
function normalizeCommonOptions(opts, role) {
  const conversation = String(opts.xmppConversation || XMPP_CONVERSATIONS.DIRECT).toLowerCase();
  if (!VALID_XMPP_CONVERSATIONS.has(conversation)) {
    throw new Error(`Invalid XMPP conversation '${opts.xmppConversation}'. Use direct or muc.`);
  }
  const tlsPolicy = String(opts.xmppTlsPolicy || XMPP_DEFAULT_TLS_POLICY).toLowerCase();
  if (!VALID_STARTTLS_POLICIES.has(tlsPolicy)) {
    throw new Error(`Invalid XMPP STARTTLS policy '${opts.xmppTlsPolicy}'. Use required, preferred, or disabled.`);
  }
  const domain = normalizeDomain(String(opts.xmppDomain || '').trim() || XMPP_DEFAULT_DOMAIN);

  // Every timing is a positive integer. Zero is not a disable switch and not a
  // wait-forever switch: a stalled connect has to fail at a deadline, and an
  // idle client stream always keeps itself alive and always retries on a drop.
  const timings = {};
  for (const { key, defaultValue } of XMPP_TIMING_OPTIONS) {
    const value = Number(opts[key] ?? defaultValue);
    if (!Number.isInteger(value) || value < XMPP_MIN_TIMING_MS) {
      throw new Error(
        `'${key}' must be an integer of ${XMPP_MIN_TIMING_MS} millisecond or more; ` +
        'it cannot be zero, negative, or fractional.',
      );
    }
    timings[key] = value;
  }

  const normalized = {
    role,
    conversation,
    tlsPolicy,
    domain,
    connectTimeoutMs: timings.xmppConnectTimeoutMs,
    replyTimeoutMs: timings.xmppReplyTimeoutMs,
    pingIntervalMs: timings.xmppPingIntervalMs,
    reconnectDelayMs: timings.xmppReconnectDelayMs,
    nickname: XMPP_DEFAULT_NICKNAME,
    roomJid: null,
    roomPassword: opts.xmppRoomPassword || '',
  };

  if (conversation === XMPP_CONVERSATIONS.MUC) {
    normalized.roomJid = resolveRoomJid(opts.xmppRoom, domain);
    normalized.nickname = requireNickname(opts.xmppNickname || XMPP_DEFAULT_NICKNAME);
  }

  return normalized;
}

/**
 * Builds the log-safe TLS summary used by the status bar and the TLS badge.
 * The wording matches the other transports so the badge classifier keeps
 * working without protocol-specific rules.
 */
function describeClientTls({ secure, tlsPolicy, caPath, allowUnverified }) {
  if (!secure) {
    return tlsPolicy === STARTTLS_POLICIES.PREFERRED
      ? 'tls=off (unsecure; STARTTLS preferred but unavailable)'
      : 'tls=off (unsecure)';
  }
  if (caPath) return `tls=on, custom certs: ca=${caPath}`;
  if (allowUnverified) {
    return 'tls=on (cert verification skipped — explicit loopback-only bypass)';
  }
  const certResult = getSystemRootCertificates();
  return `tls=on, ${formatTlsCertSummary(certResult)}`;
}

/**
 * Emits a structured `[XMPP]` log entry through the caller's logger.
 */
function createLogger(onLog) {
  return (level, message) => {
    if (typeof onLog === 'function') onLog(level, `[XMPP] ${message}`);
  };
}

/**
 * The canonical timing block reported in lifecycle metadata, connect results,
 * descriptors and the copied client settings. Built from one place so the four
 * timings can never be reported under different names in different surfaces.
 *
 * @param {object} common - the result of `normalizeCommonOptions`
 * @param {string} [role] - restricts the block to the timings that role uses
 */
function describeTimings(common, role = common.role) {
  const values = {
    xmppConnectTimeoutMs: common.connectTimeoutMs,
    xmppReplyTimeoutMs: common.replyTimeoutMs,
    xmppPingIntervalMs: common.pingIntervalMs,
    xmppReconnectDelayMs: common.reconnectDelayMs,
  };
  const block = {};
  for (const option of XMPP_TIMING_OPTIONS) {
    if (role && !option.roles.includes(role)) continue;
    block[option.key] = values[option.key];
  }
  return block;
}

/**
 * Races a promise against a deadline without leaving a timer behind.
 * Every caller passes a validated positive millisecond count, so there is no
 * wait-forever path through this helper.
 */
async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// =============================================================================
// Client Transport
// =============================================================================

/**
 * Creates an XMPP client transport.
 *
 * @param {object} opts
 * @param {string} opts.ip - Target host. Used verbatim in the service URL.
 * @param {number} opts.port - Target port (5222 by default).
 * @param {string} [opts.xmppDomain] - Served XMPP domain, when it differs from the host.
 * @param {string} opts.xmppUsername - Account local part or bare JID.
 * @param {string} opts.xmppPassword - Account password. Never logged.
 * @param {string} [opts.xmppResource] - Requested resource part.
 * @param {string} [opts.xmppTlsPolicy='required'] - required | preferred | disabled
 * @param {string} [opts.xmppTlsCaPath] - Custom CA (PEM). Omit to use the OS trust store.
 * @param {boolean} [opts.xmppAllowUnverifiedTls=false] - Loopback-only verification bypass.
 * @param {string} [opts.xmppConversation='direct'] - direct | muc
 * @param {string} [opts.xmppDestination] - Comma-separated bare destination JIDs (direct).
 * @param {string} [opts.xmppRoom] - Room name or room JID (muc).
 * @param {string} [opts.xmppNickname] - Room nickname (muc).
 * @param {string} [opts.xmppRoomPassword] - Room password (muc). Never logged.
 * @param {number} [opts.xmppConnectTimeoutMs=30000] - Positive milliseconds.
 * @param {number} [opts.xmppReplyTimeoutMs=15000] - Positive milliseconds.
 * @param {number} [opts.xmppPingIntervalMs=60000] - XEP-0199 keepalive interval. Always on.
 * @param {number} [opts.xmppReconnectDelayMs=60000] - Delay before an automatic reconnect.
 * @param {function} [opts.onData] - Inbound message callback: (body, metadata) => {}
 * @param {function} [opts.onLog] - Structured log callback: (level, message) => {}
 * @param {function} [opts.onStateChange] - Lifecycle callback: (state, detail) => {}
 */
function createXmppClientTransport(opts) {
  const { ip, port = XMPP_DEFAULT_C2S_PORT, onData, onLog, onStateChange } = opts;
  const log = createLogger(onLog);
  const common = normalizeCommonOptions(opts, XMPP_ROLES.CLIENT);

  if (!ip || !String(ip).trim()) throw new Error('XMPP client mode requires a host.');

  const rawUsername = String(opts.xmppUsername || '').trim();
  if (!rawUsername) throw new Error('XMPP username is required in client mode.');
  // A full `user@domain` username wins over the separate domain override so a
  // copied JID can be pasted straight into the username field.
  const username = rawUsername.includes('@')
    ? requireBareJid(rawUsername, 'XMPP username').split('@')[0]
    : normalizeAccountUsername(rawUsername);
  const domain = rawUsername.includes('@')
    ? requireBareJid(rawUsername, 'XMPP username').split('@')[1]
    : common.domain;
  const password = String(opts.xmppPassword || '');
  if (!password) throw new Error('XMPP password is required in client mode.');
  const resource = String(opts.xmppResource || XMPP_DEFAULT_RESOURCE).trim() || XMPP_DEFAULT_RESOURCE;

  const allowUnverified = opts.xmppAllowUnverifiedTls === true;
  if (allowUnverified && !isLoopbackHost(ip)) {
    throw new Error(
      `TLS verification bypass is restricted to loopback hosts; '${ip}' is not a loopback address.`,
    );
  }
  const caPath = String(opts.xmppTlsCaPath || '').trim() || null;
  if (caPath && !fs.existsSync(caPath)) {
    throw new Error(`XMPP CA certificate file was not found: ${caPath}`);
  }

  const destinations = common.conversation === XMPP_CONVERSATIONS.DIRECT
    ? parseDestinationList(opts.xmppDestination, { label: 'XMPP destination JID' })
    : [];
  const roomJid = common.conversation === XMPP_CONVERSATIONS.MUC
    ? resolveRoomJid(opts.xmppRoom, domain)
    : null;

  const service = `xmpp://${ip}:${port}`;
  let core = null;
  let online = false;
  let hasBeenOnline = false;
  let joined = false;
  let pingTimer = null;

  const setState = (state, detail) => {
    if (typeof onStateChange === 'function') onStateChange(state, detail);
  };

  const stopPing = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const startPing = () => {
    pingTimer = setInterval(() => {
      if (!core || !online) return;
      core.ping(domain).catch((error) => {
        log('warn', `Keepalive ping failed: ${error.message}`);
      });
    }, common.pingIntervalMs);
    if (typeof pingTimer.unref === 'function') pingTimer.unref();
  };

  return {
    async connect() {
      const { XmppClientCore } = require('./xmpp-client-core.js');
      setState('connecting', { service, domain });
      log('info', `Client connecting to ${service} as ${username}@${domain}/${resource} ` +
        `[starttls=${common.tlsPolicy}, conversation=${common.conversation}]`);

      core = new XmppClientCore({
        service,
        domain,
        username,
        password,
        resource,
        tlsPolicy: common.tlsPolicy,
        timeout: common.replyTimeoutMs,
        reconnectDelayMs: common.reconnectDelayMs,
        caPath: caPath || undefined,
        ...(allowUnverified ? { rejectUnauthorized: false } : {}),
      });

      const activeCore = core;
      const handleUnexpectedDisconnect = () => {
        if (core !== activeCore || !online) return;
        online = false;
        joined = false;
        setState('offline', describeTimings(common));
        log('warn', `Stream went offline; an automatic reconnect is scheduled in ${common.reconnectDelayMs}ms.`);
      };
      activeCore.on('error', (error) => log('warn', `Stream error: ${error.message}`));
      activeCore.on('messageError', (event) => {
        log('warn', `${event.from || 'The server'} rejected a message: ${event.condition}.`);
      });
      activeCore.on('status', (status) => {
        if (status === 'disconnect') handleUnexpectedDisconnect();
      });
      activeCore.on('offline', handleUnexpectedDisconnect);
      activeCore.on('online', () => {
        const reconnected = hasBeenOnline;
        online = true;
        hasBeenOnline = true;
        if (reconnected && common.conversation === XMPP_CONVERSATIONS.DIRECT) {
          setState('ready', {
            jid: activeCore.jid,
            reconnected: true,
            tlsInfo: describeClientTls({
              secure: activeCore.isSecure(),
              tlsPolicy: common.tlsPolicy,
              caPath,
              allowUnverified,
            }),
          });
          log('info', 'Direct chat stream reconnected.');
        }
      });
      activeCore.on('roomsRejoined', () => {
        joined = true;
        setState('ready', {
          jid: activeCore.jid,
          reconnected: true,
          tlsInfo: describeClientTls({
            secure: activeCore.isSecure(),
            tlsPolicy: common.tlsPolicy,
            caPath,
            allowUnverified,
          }),
        });
        log('info', `Rejoined room ${roomJid} after reconnect.`);
      });
      activeCore.on('chat', (message) => {
        if (typeof onData !== 'function') return;
        onData(message.body, {
          protocol: 'XMPP',
          mode: 'client',
          conversation: XMPP_CONVERSATIONS.DIRECT,
          from: message.from,
          secure: Boolean(message.secure),
          remote: `${ip}:${port}`,
        });
      });
      core.on('mucMessage', (message) => {
        if (typeof onData !== 'function') return;
        // The room echoes the Simulator's own broadcast back; flag it so the
        // caller can distinguish an echo from genuine inbound traffic.
        onData(message.body, {
          protocol: 'XMPP',
          mode: 'client',
          conversation: XMPP_CONVERSATIONS.MUC,
          room: message.room,
          from: message.nickname,
          selfEcho: Boolean(message.self),
          secure: Boolean(message.secure),
          remote: `${ip}:${port}`,
        });
      });

      try {
        await withTimeout(
          core.connect(),
          common.connectTimeoutMs,
          `Timed out after ${common.connectTimeoutMs}ms while connecting to ${service}.`,
        );
      } catch (error) {
        await this.disconnect();
        throw error;
      }
      online = true;

      const secure = core.isSecure();
      if (common.tlsPolicy === STARTTLS_POLICIES.REQUIRED && !secure) {
        await this.disconnect();
        throw new Error(
          `STARTTLS is set to Required but ${service} did not negotiate an encrypted stream.`,
        );
      }
      log('info', `Authenticated as ${core.jid} (encrypted=${secure ? 'yes' : 'no'}).`);
      setState('authenticated', { jid: core.jid, secure });

      if (common.conversation === XMPP_CONVERSATIONS.MUC) {
        try {
          await withTimeout(
            core.joinMuc(roomJid, common.nickname, common.roomPassword || undefined),
            common.replyTimeoutMs,
            `Timed out after ${common.replyTimeoutMs}ms while joining ${roomJid}.`,
          );
        } catch (error) {
          await this.disconnect();
          throw error;
        }
        joined = true;
        log('info', `Joined room ${roomJid} as '${common.nickname}'.`);
        setState('room', {
          jid: core.jid,
          room: roomJid,
          nickname: common.nickname,
          secure,
        });
      }

      startPing();
      const tlsInfo = describeClientTls({
        secure,
        tlsPolicy: common.tlsPolicy,
        caPath,
        allowUnverified,
      });
      setState('ready', { jid: core.jid, secure, ...describeTimings(common) });

      return {
        success: true,
        protocol: XMPP_PROTOCOL,
        mode: 'client',
        address: service,
        domain,
        jid: core.jid,
        secure,
        tlsPolicy: common.tlsPolicy,
        tlsInfo,
        conversation: common.conversation,
        destinations,
        room: roomJid,
        nickname: common.conversation === XMPP_CONVERSATIONS.MUC ? common.nickname : null,
        ...describeTimings(common),
        streamManagement: STREAM_MANAGEMENT_SUPPORT,
      };
    },

    async send(data) {
      if (!core || !online) {
        return { delivered: false, recipients: 0, reason: 'no-clients' };
      }
      assertBodyWithinLimit(data, XMPP_MAX_BODY_BYTES);
      if (common.conversation === XMPP_CONVERSATIONS.MUC) {
        if (!joined) return { delivered: false, recipients: 0, reason: 'no-clients' };
        await core.sendMuc(roomJid, data);
        return { delivered: true, recipients: 1 };
      }
      for (const destination of destinations) {
        await core.sendChat(destination, data);
      }
      return { delivered: true, recipients: destinations.length };
    },

    async disconnect() {
      stopPing();
      const active = core;
      core = null;
      online = false;
      joined = false;
      if (!active) return;
      try {
        await active.close();
      } catch (error) {
        log('warn', `Ignoring error while closing the stream: ${error.message}`);
      }
      setState('disconnected');
      log('info', 'Client disconnected.');
    },

    isConnected() {
      return Boolean(core) && online;
    },

    /** Client mode always has an implicit destination once the stream is ready. */
    hasRecipients() {
      if (!this.isConnected()) return false;
      return common.conversation === XMPP_CONVERSATIONS.MUC ? joined : destinations.length > 0;
    },

    getClientCount() {
      return this.hasRecipients() ? (common.conversation === XMPP_CONVERSATIONS.MUC ? 1 : destinations.length) : 0;
    },

    /** Log-safe descriptor. Contains no passwords. */
    describe() {
      return {
        protocol: XMPP_PROTOCOL,
        role: XMPP_ROLES.CLIENT,
        service,
        domain,
        username,
        resource,
        tlsPolicy: common.tlsPolicy,
        conversation: common.conversation,
        destinations,
        room: roomJid,
        nickname: common.conversation === XMPP_CONVERSATIONS.MUC ? common.nickname : null,
        ...describeTimings(common),
      };
    },
  };
}

// =============================================================================
// Server Transport
// =============================================================================

/**
 * Creates an XMPP server transport.
 *
 * @param {object} opts
 * @param {string} opts.ip - Bind address. Loopback unless `xmppAllowRemote` is set.
 * @param {number} opts.port - Bind port (5222 by default).
 * @param {string} [opts.xmppDomain='localhost'] - Domain served to clients.
 * @param {string} [opts.xmppTlsPolicy='required'] - required | preferred | disabled
 * @param {string} [opts.xmppTlsCertPath] - Server certificate (PEM). Auto self-signed when omitted.
 * @param {string} [opts.xmppTlsKeyPath] - Server private key (PEM).
 * @param {boolean} [opts.xmppAllowRemote=false] - Required to bind a non-loopback address.
 * @param {string} [opts.xmppExternalUsername] - The single external account's username.
 * @param {string} [opts.xmppExternalPassword] - The single external account's password. Never logged.
 * @param {string} [opts.xmppConversation='direct'] - direct | muc
 * @param {string} [opts.xmppDestination] - Optional bare JIDs to restrict delivery to (direct).
 * @param {string} [opts.xmppRoom] - Room name or room JID (muc).
 * @param {string} [opts.xmppNickname] - Room nickname used by the application identity (muc).
 * @param {string} [opts.xmppRoomPassword] - Room password (muc). Never logged.
 * @param {function} [opts.onData]
 * @param {function} [opts.onClientConnected]
 * @param {function} [opts.onLog]
 * @param {function} [opts.onStateChange]
 */
function createXmppServerTransport(opts) {
  const {
    ip,
    port = XMPP_DEFAULT_C2S_PORT,
    onData,
    onClientConnected,
    onClientDisconnected,
    onLog,
    onStateChange,
  } = opts;
  const log = createLogger(onLog);
  const common = normalizeCommonOptions(opts, XMPP_ROLES.SERVER);

  const host = String(ip || '').trim() || '127.0.0.1';
  const allowRemote = opts.xmppAllowRemote === true;
  if (!allowRemote && !isLoopbackHost(host)) {
    throw new Error(
      `The XMPP server binds a loopback address unless 'Allow remote clients' is enabled; '${host}' is not a loopback address.`,
    );
  }

  const externalUsername = String(opts.xmppExternalUsername || '').trim();
  const externalPassword = String(opts.xmppExternalPassword || '');
  if (externalUsername && !externalPassword) {
    throw new Error('The external XMPP account requires a password.');
  }
  if (!externalUsername && externalPassword) {
    throw new Error('The external XMPP account requires a username.');
  }
  if (!externalUsername && !externalPassword) {
    throw new Error('XMPP server mode requires one external account username and password.');
  }
  const externalAccount = externalUsername
    ? {
      username: normalizeAccountUsername(
        externalUsername.split('@')[0],
        'External XMPP account username',
      ),
      password: externalPassword,
    }
    : null;
  // The comparison is canonical on both sides: the reserved application
  // identity and the configured external account are compared after the same
  // trim/lowercase/local-part normalization, so ' Velocity-Simulator@host '
  // cannot shadow the identity the Simulator itself publishes as.
  if (externalAccount &&
      externalAccount.username ===
        normalizeAccountUsername(INTERNAL_APP_USERNAME, 'Internal XMPP account username')) {
    throw new Error(
      `The external XMPP account username must differ from the reserved '${INTERNAL_APP_USERNAME}' ` +
      'application identity, including case and domain variations.',
    );
  }

  const tlsCertPath = String(opts.xmppTlsCertPath || '').trim() || null;
  const tlsKeyPath = String(opts.xmppTlsKeyPath || '').trim() || null;
  if (Boolean(tlsCertPath) !== Boolean(tlsKeyPath)) {
    throw new Error(
      'Both an XMPP TLS certificate and its private key are required. ' +
      `Only the ${tlsCertPath ? 'certificate' : 'private key'} was supplied; ` +
      'leave both empty to use an automatic self-signed certificate.',
    );
  }
  for (const [label, filePath] of [['certificate', tlsCertPath], ['private key', tlsKeyPath]]) {
    if (filePath && !fs.existsSync(filePath)) {
      throw new Error(`XMPP TLS ${label} file was not found: ${filePath}`);
    }
  }

  const restrictTo = common.conversation === XMPP_CONVERSATIONS.DIRECT && opts.xmppDestination
    ? parseDestinationList(opts.xmppDestination, { label: 'XMPP destination JID' })
    : null;

  let server = null;
  let listening = false;
  let boundAddress = null;
  let tlsInfo = 'tls=off (unsecure)';

  const setState = (state, detail) => {
    if (typeof onStateChange === 'function') onStateChange(state, detail);
  };

  return {
    async connect() {
      const { XmppServerCore } = require('./xmpp-server-core.js');
      setState('connecting', { host, port });
      log('info', `Server starting on ${host}:${port} for domain '${common.domain}' ` +
        `[starttls=${common.tlsPolicy}, conversation=${common.conversation}]`);

      server = new XmppServerCore({
        host,
        port,
        domain: common.domain,
        tlsPolicy: common.tlsPolicy,
        tlsCertPath: tlsCertPath || undefined,
        tlsKeyPath: tlsKeyPath || undefined,
        allowRemote,
        externalAccount,
        // A configured room password protects the room for every occupant,
        // not just the simulator identity that creates it.
        ...(common.conversation === XMPP_CONVERSATIONS.MUC && common.roomPassword
          ? { roomPasswords: { [common.roomJid]: common.roomPassword } }
          : {}),
      });

      server.on('connection', (event) => {
        log('info', `Inbound stream from ${event.remoteAddress}.`);
      });
      server.on('secure', () => log('info', 'Inbound stream upgraded to TLS.'));
      server.on('authenticated', (event) => {
        log('info', `Account '${event.username}' authenticated using ${event.mechanism} ` +
          `(encrypted=${event.secure ? 'yes' : 'no'}).`);
      });
      server.on('bound', (event) => {
        log('info', `Resource bound: ${event.jid} (encrypted=${event.secure ? 'yes' : 'no'}).`);
        // `secure` is this stream's actual negotiated state, not the server's
        // advertised STARTTLS capability. Under Preferred one client may be
        // encrypted while another is not.
        setState('authenticated', { jid: event.jid, secure: Boolean(event.secure), peer: true });
        if (typeof onClientConnected === 'function') onClientConnected();
      });
      server.on('mucJoin', (event) => {
        log('info', `${event.jid} joined ${event.room} as '${event.nickname}'.`);
        setState('room', {
          jid: event.jid,
          room: event.room,
          nickname: event.nickname,
          secure: event.secure === null ? null : Boolean(event.secure),
          peer: true,
        });
        if (typeof onClientConnected === 'function') onClientConnected();
      });
      server.on('mucJoinRejected', (event) => {
        log('warn', `${event.jid || 'a stream'} was refused entry to ${event.room}: ${event.condition}.`);
      });
      server.on('mucLeave', (event) => {
        log('info', `${event.jid} left ${event.room}.`);
      });
      server.on('messageRejected', (event) => {
        log('warn', `Rejected a ${event.type} message to ${event.to}: ${event.condition}.`);
      });
      server.on('servicePublish', (event) => {
        log('debug', `Published to ${event.recipients} recipient(s)` +
          `${event.room ? ` in ${event.room}` : ''} as ${event.from}.`);
      });
      server.on('disconnect', (event) => {
        log('info', `Stream closed${event.jid ? ` for ${event.jid}` : ''}.`);
        if (event.jid && typeof onClientDisconnected === 'function') {
          onClientDisconnected(event.jid);
        }
      });
      server.on('clientError', (event) => {
        log('warn', `Stream error${event.jid ? ` for ${event.jid}` : ''}: ${event.message}`);
      });
      server.on('message', (event) => {
        if (typeof onData !== 'function') return;
        onData(event.body, {
          protocol: 'XMPP',
          mode: 'server',
          conversation: XMPP_CONVERSATIONS.DIRECT,
          from: event.from,
          secure: Boolean(event.secure),
          remote: `${host}:${port}`,
        });
      });
      server.on('mucMessage', (event) => {
        if (typeof onData !== 'function') return;
        onData(event.body, {
          protocol: 'XMPP',
          mode: 'server',
          conversation: XMPP_CONVERSATIONS.MUC,
          room: event.room,
          from: event.nickname,
          secure: Boolean(event.secure),
          remote: `${host}:${port}`,
        });
      });

      let result;
      try {
        result = await server.listen();
      } catch (error) {
        server = null;
        throw error;
      }
      listening = true;
      boundAddress = result.address;
      // Under Preferred the server advertises STARTTLS but cannot force it, so
      // the summary is labelled as an offer. Each stream's own security is
      // reported separately through the lifecycle details and inbound metadata.
      tlsInfo = common.tlsPolicy === STARTTLS_POLICIES.PREFERRED && /^tls=on/.test(result.tlsInfo)
        ? `${result.tlsInfo} (offered; each stream reports its own state)`
        : result.tlsInfo;

      if (common.conversation === XMPP_CONVERSATIONS.MUC) {
        const joinResult = server.joinRoomAsService({
          roomJid: common.roomJid,
          nickname: common.nickname,
          password: common.roomPassword || undefined,
        });
        if (!joinResult.ok) {
          await this.disconnect();
          throw new Error(
            `The simulator identity could not occupy ${common.roomJid}: ${joinResult.condition}.`,
          );
        }
        log('info', `Simulator identity occupies ${joinResult.occupantJid}.`);
      }

      setState('ready', { address: boundAddress, ...describeTimings(common) });
      log('info', `Server listening on ${boundAddress.address}:${boundAddress.port} — ${tlsInfo}`);

      return {
        success: true,
        protocol: XMPP_PROTOCOL,
        mode: 'server',
        address: { address: boundAddress.address, port: boundAddress.port },
        url: `xmpp://${boundAddress.address}:${boundAddress.port}`,
        domain: common.domain,
        tlsPolicy: common.tlsPolicy,
        tlsInfo,
        conversation: common.conversation,
        room: common.roomJid,
        nickname: common.conversation === XMPP_CONVERSATIONS.MUC ? common.nickname : null,
        serviceJid: server.getServiceJid(),
        externalJid: server.getExternalJid(),
        mucDomain: server.getMucDomain(),
        selfSignedCertificate: Boolean(result.selfSignedCertificate),
        ...describeTimings(common),
        streamManagement: STREAM_MANAGEMENT_SUPPORT,
      };
    },

    async send(data) {
      if (!server || !listening) {
        return { delivered: false, recipients: 0, reason: 'no-clients' };
      }
      assertBodyWithinLimit(data, XMPP_MAX_BODY_BYTES);
      if (common.conversation === XMPP_CONVERSATIONS.MUC) {
        return server.broadcastToRoomAsService(common.roomJid, data);
      }
      return server.sendServiceMessage(data, restrictTo || undefined);
    },

    async disconnect() {
      const active = server;
      server = null;
      listening = false;
      if (!active) return;
      try {
        await active.close();
      } catch (error) {
        log('warn', `Ignoring error while stopping the server: ${error.message}`);
      }
      setState('disconnected');
      log('info', 'Server stopped.');
    },

    isConnected() {
      return listening;
    },

    hasRecipients() {
      if (!server || !listening) return false;
      return common.conversation === XMPP_CONVERSATIONS.MUC
        ? server.getRoomOccupantCount(common.roomJid) > 0
        : server.getBoundJids().length > 0;
    },

    getClientCount() {
      if (!server || !listening) return 0;
      return common.conversation === XMPP_CONVERSATIONS.MUC
        ? server.getRoomOccupantCount(common.roomJid)
        : server.getBoundJids().length;
    },

    /**
     * The settings a receiver needs to sign in to this server, expressed with
     * the Simulator's canonical option names so the block can be pasted
     * straight into a command line or a launch-config `connection` section.
     *
     * The network host is the shared top-level `ip` option — there is no
     * separate `xmppHost` key — and `xmppDomain` remains the served XMPP
     * domain, which may legitimately differ from `ip`.
     *
     * The external account password is withheld unless it is explicitly
     * requested, so the "Copy Client Settings" action never puts a credential
     * on the clipboard by accident.
     *
     * @param {object} [options]
     * @param {boolean} [options.includePassword=false]
     */
    getClientSettings({ includePassword = false } = {}) {
      const settings = {
        ip: boundAddress ? boundAddress.address : host,
        port: boundAddress ? boundAddress.port : port,
        protocol: XMPP_PROTOCOL,
        mode: XMPP_ROLES.CLIENT,
        xmppDomain: common.domain,
        xmppTlsPolicy: common.tlsPolicy,
        xmppAllowUnverifiedTls: false,
        xmppUsername: externalAccount ? externalAccount.username : null,
        xmppPassword: includePassword && externalAccount ? externalAccount.password : null,
        passwordIncluded: Boolean(includePassword && externalAccount),
        xmppResource: XMPP_DEFAULT_RESOURCE,
        xmppConversation: common.conversation,
        xmppDestination: server ? server.getServiceJid() : `${INTERNAL_APP_USERNAME}@${common.domain}`,
        xmppRoom: common.roomJid,
        xmppNickname: common.conversation === XMPP_CONVERSATIONS.MUC ? common.nickname : null,
        ...describeTimings(common, XMPP_ROLES.CLIENT),
      };
      if (!settings.passwordIncluded) delete settings.xmppPassword;
      return settings;
    },

    /** Log-safe descriptor. Contains no passwords. */
    describe() {
      return {
        protocol: XMPP_PROTOCOL,
        role: XMPP_ROLES.SERVER,
        host,
        port: boundAddress ? boundAddress.port : port,
        domain: common.domain,
        tlsPolicy: common.tlsPolicy,
        allowRemote,
        conversation: common.conversation,
        room: common.roomJid,
        nickname: common.conversation === XMPP_CONVERSATIONS.MUC ? common.nickname : null,
        externalAccount: externalAccount ? externalAccount.username : null,
        boundJids: server ? server.getBoundJids() : [],
        ...describeTimings(common),
      };
    },
  };
}

/**
 * Formats the settings returned by `getClientSettings()` as the plain text the
 * "Copy Client Settings" button places on the clipboard.
 *
 * Every line is a canonical `option=value` pair, so the copied block can be
 * pasted straight into a command line. The network host is emitted as the
 * shared top-level `ip` option; there is no `xmppHost` key anywhere in the app.
 *
 * @param {object} settings
 * @returns {string}
 */
function formatClientSettings(settings) {
  const lines = [
    '# ArcGIS Velocity Simulator — XMPP client settings',
    `ip=${settings.ip}`,
    `port=${settings.port}`,
    `protocol=${settings.protocol || XMPP_PROTOCOL}`,
    `mode=${settings.mode || XMPP_ROLES.CLIENT}`,
    `xmppDomain=${settings.xmppDomain}`,
    `xmppTlsPolicy=${settings.xmppTlsPolicy}`,
    `xmppAllowUnverifiedTls=${settings.xmppAllowUnverifiedTls === true}`,
  ];
  if (settings.xmppUsername) lines.push(`xmppUsername=${settings.xmppUsername}`);
  lines.push(settings.passwordIncluded
    ? `${XMPP_PASSWORD_OPTION}=${settings[XMPP_PASSWORD_OPTION]}`
    : `# ${XMPP_PASSWORD_OPTION}=<not copied — enable "Include password" to copy it>`);
  lines.push(`xmppResource=${settings.xmppResource}`);
  lines.push(`xmppConversation=${settings.xmppConversation}`);
  if (settings.xmppConversation === XMPP_CONVERSATIONS.MUC) {
    lines.push(`xmppRoom=${settings.xmppRoom}`);
    lines.push(`xmppNickname=${settings.xmppNickname}`);
  } else {
    lines.push(`xmppDestination=${settings.xmppDestination}`);
  }
  for (const { key } of XMPP_TIMING_OPTIONS) {
    if (settings[key] !== undefined) lines.push(`${key}=${settings[key]}`);
  }
  return lines.join('\n');
}

module.exports = {
  createXmppClientTransport,
  createXmppServerTransport,
  formatClientSettings,
  resolveRoomJid,
  normalizeCommonOptions,
  describeClientTls,
  describeTimings,
  XMPP_PROTOCOL,
  XMPP_PASSWORD_OPTION,
  XMPP_DEFAULT_C2S_PORT,
  XMPP_MAX_BODY_BYTES,
  XMPP_MAX_DESTINATIONS,
  XMPP_CONVERSATIONS,
  XMPP_ROLES,
  XMPP_TIMING_OPTIONS,
  STARTTLS_POLICIES,
};
