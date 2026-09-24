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
 * @file xmpp-server-core.js
 * @description
 * The built-in XMPP client-to-server (C2S) server used when the ArcGIS
 * Velocity Simulator runs in the XMPP Server role.
 *
 * Implemented: stream negotiation, STARTTLS (required/preferred/disabled),
 * SASL PLAIN and SCRAM-SHA-1, resource binding with a configurable conflict
 * policy, direct `chat` routing, XEP-0045 Multi-User Chat, XEP-0199 ping,
 * partial XEP-0198 stream management (no resumption), and the documented
 * size/rate bounds.
 *
 * Not implemented: server-to-server federation, rosters, presence
 * subscriptions, offline storage, message archiving, and room administration.
 * Those are out of scope for a simulator endpoint and are never advertised.
 *
 * XML is parsed and produced exclusively with `@xmpp/xml` (ltx) and JIDs with
 * `@xmpp/jid`; no XML is ever parsed with regular expressions.
 */

const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { StringDecoder } = require('string_decoder');
const { EventEmitter } = require('events');
const { Parser, escapeXML, xml } = require('@xmpp/xml');
const { jid } = require('@xmpp/jid');
const { buildHttpsServerOptions } = require('./tls-utils');
const {
  XMPP_NS: NS,
  XMPP_DEFAULT_BIND_HOST,
  XMPP_DEFAULT_DOMAIN,
  XMPP_DEFAULT_MUC_SUBDOMAIN,
  STARTTLS_POLICIES: TLS_POLICIES,
  VALID_STARTTLS_POLICIES,
  RESOURCE_CONFLICT_POLICIES,
  VALID_RESOURCE_CONFLICT_POLICIES,
  SASL_MECHANISMS,
  DEFAULT_MAX_STANZA_BYTES,
  DEFAULT_MAX_AUTH_ATTEMPTS_PER_CONNECTION,
  DEFAULT_AUTH_RATE_LIMIT,
} = require('./xmpp-constants');
const { createAccountStore, INTERNAL_APP_USERNAME } = require('./xmpp-accounts');
const { createServerMechanism, SASL_CONDITIONS } = require('./xmpp-sasl-server');
const { createMucService } = require('./xmpp-muc');
const {
  isLoopbackHost,
  normalizeAccountUsername,
  normalizeDomain,
  randomStanzaId,
  sanitizeResource,
  decodeSaslPayload,
  createRateLimiter,
} = require('./xmpp-utils');

/**
 * Session identifier used for the automatic simulator application identity so
 * it can occupy rooms and publish without holding a socket.
 */
const SERVICE_SESSION_ID = 'velocity-service-session';

class XmppServerCore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      host: XMPP_DEFAULT_BIND_HOST,
      port: 0,
      domain: XMPP_DEFAULT_DOMAIN,
      tlsPolicy: TLS_POLICIES.REQUIRED,
      maxXmlBytes: DEFAULT_MAX_STANZA_BYTES,
      maxAuthAttemptsPerConnection: DEFAULT_MAX_AUTH_ATTEMPTS_PER_CONNECTION,
      authAttempts: DEFAULT_AUTH_RATE_LIMIT.maxFailures,
      authWindowMs: DEFAULT_AUTH_RATE_LIMIT.windowMs,
      resourceConflict: RESOURCE_CONFLICT_POLICIES.REPLACE,
      allowRemote: false,
      ...options,
    };
    this.options.domain = normalizeDomain(this.options.domain);
    if (!VALID_STARTTLS_POLICIES.has(this.options.tlsPolicy)) {
      throw new Error(`Invalid TLS policy: ${this.options.tlsPolicy}`);
    }
    if (!VALID_RESOURCE_CONFLICT_POLICIES.has(this.options.resourceConflict)) {
      throw new Error(`Invalid resource conflict policy: ${this.options.resourceConflict}`);
    }
    if (!this.options.allowRemote && !isLoopbackHost(this.options.host)) {
      throw new Error('Non-loopback XMPP binding requires allowRemote: true');
    }

    this.accountStore = createAccountStore({
      domain: this.options.domain,
      internalAppUsername: options.internalAccount?.username || INTERNAL_APP_USERNAME,
      internalAppPassword: options.internalAccount?.password,
      externalAccount: options.externalAccount,
    });
    this.internalAccount = this.accountStore.getInternalCredentials();
    this.muc = createMucService({
      mucDomain: `${XMPP_DEFAULT_MUC_SUBDOMAIN}.${this.options.domain}`,
      rooms: Object.entries(options.roomPasswords || {}).map(([room, password]) => ({
        jid: room,
        password,
      })),
    });
    this.connections = new Set();
    this.bound = new Map();
    this.serviceRooms = new Map();
    this.authRateLimiter = createRateLimiter({
      windowMs: this.options.authWindowMs,
      maxFailures: this.options.authAttempts,
    });
    this.server = null;
    this.tlsInfo = 'tls=off (unsecure)';
    this.selfSignedCertificate = null;
  }

  async listen() {
    if (this.server) throw new Error('XMPP server is already listening');
    if (Boolean(this.options.tlsCert) !== Boolean(this.options.tlsKey)) {
      throw new Error('Both tlsCert and tlsKey PEM values are required');
    }
    if (Boolean(this.options.tlsCertPath) !== Boolean(this.options.tlsKeyPath)) {
      throw new Error('Both tlsCertPath and tlsKeyPath values are required');
    }
    if ((this.options.tlsCert || this.options.tlsKey) &&
        (this.options.tlsCertPath || this.options.tlsKeyPath)) {
      throw new Error('Specify inline TLS certificate/key values or path values, not both');
    }
    if (this.options.tlsPolicy !== TLS_POLICIES.DISABLED) {
      const built = this.options.tlsCert
        ? {
          serverOptions: { cert: this.options.tlsCert, key: this.options.tlsKey },
          tlsInfo: 'tls=on, cert=supplied PEM, key=supplied PEM',
          selfSigned: null,
        }
        : buildHttpsServerOptions({
          useTls: true,
          tlsCaPath: this.options.tlsCaPath,
          tlsCertPath: this.options.tlsCertPath,
          tlsKeyPath: this.options.tlsKeyPath,
          ip: this.options.host,
          hostname: this.options.domain,
        });
      this.secureContext = tls.createSecureContext(built.serverOptions);
      this.tlsInfo = built.tlsInfo;
      this.selfSignedCertificate = built.selfSigned;
    }
    this.server = net.createServer((socket) => this._accept(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, this.options.host, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    this.emit('listening', address);
    return {
      address,
      domain: this.options.domain,
      tlsPolicy: this.options.tlsPolicy,
      tlsInfo: this.tlsInfo,
      selfSignedCertificate: this.selfSignedCertificate,
    };
  }

  async close() {
    if (!this.server) return;
    this.leaveRoomsAsService();
    for (const connection of [...this.connections]) this._closeConnection(connection);
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }

  getConnectionCount() {
    return this.connections.size;
  }

  getBoundJids() {
    return [...this.bound.keys()];
  }

  /** Bare JID of the automatic simulator application identity. */
  getServiceJid() {
    return this.internalAccount.jid;
  }

  /** Bare JID of the single configured external account, or null. */
  getExternalJid() {
    const external = this.accountStore.getExternalCredentials();
    return external ? external.jid : null;
  }

  /** MUC service domain served by this instance, e.g. `conference.localhost`. */
  getMucDomain() {
    return this.muc.mucDomain;
  }

  // ---------------------------------------------------------------------------
  // Service-side publishing
  //
  // The Simulator's own application identity never opens a socket against its
  // own server, so these methods let the transport publish as that identity
  // while reusing the same routing and MUC bookkeeping as a real stream.
  // ---------------------------------------------------------------------------

  /**
   * Delivers a `chat` body from the application identity to every bound stream.
   *
   * @param {string} body
   * @param {string[]} [destinations] - Bare or full JIDs; defaults to all bound streams.
   * @returns {{delivered: boolean, recipients: number, reason?: string}}
   */
  sendServiceMessage(body, destinations) {
    const targets = new Set();
    if (Array.isArray(destinations) && destinations.length > 0) {
      for (const destination of destinations) {
        const recipient = this._findRecipient(jid(destination));
        if (recipient) targets.add(recipient);
      }
    } else {
      for (const connection of this.bound.values()) targets.add(connection);
    }
    if (targets.size === 0) return { delivered: false, recipients: 0, reason: 'no-clients' };
    for (const recipient of targets) {
      this._sendTracked(recipient, xml('message', {
        type: 'chat',
        from: this.internalAccount.jid,
        to: recipient.fullJid,
        id: randomStanzaId('msg'),
      }, xml('body', {}, body)));
    }
    this.emit('servicePublish', {
      from: this.internalAccount.jid,
      recipients: targets.size,
      conversation: 'direct',
    });
    return { delivered: true, recipients: targets.size };
  }

  /**
   * Seats the application identity in a room so occupants see it in the
   * participant list and receive its broadcasts.
   *
   * @returns {{ok: true, occupantJid: string}|{ok: false, condition: string}}
   */
  joinRoomAsService({ roomJid, nickname, password }) {
    const normalized = this.muc.normalizeRoomJid(roomJid);
    if (!normalized) return { ok: false, condition: 'jid-malformed' };
    const result = this.muc.join({
      roomJid: normalized,
      nick: nickname,
      password,
      sessionId: SERVICE_SESSION_ID,
      fullJid: this.internalAccount.jid,
    });
    if (!result.ok) return { ok: false, condition: result.error.condition };
    this.serviceRooms.set(normalized, nickname);
    for (const occupant of this.muc.getOccupants(normalized)) {
      const member = this._connectionById(occupant.sessionId);
      if (member) this._sendMucPresence(member, normalized, nickname, result.self, false, false);
    }
    // The application identity occupies the room in-process, so no socket and
    // therefore no per-connection TLS state exists for it. `secure` is
    // reported as null rather than borrowing the server's TLS capability.
    this.emit('mucJoin', {
      room: normalized,
      nickname,
      jid: this.internalAccount.jid,
      secure: null,
    });
    return { ok: true, occupantJid: `${normalized}/${nickname}` };
  }

  /**
   * Broadcasts a `groupchat` body into a room the application identity occupies.
   *
   * @returns {{delivered: boolean, recipients: number, reason?: string}}
   */
  broadcastToRoomAsService(roomJid, body) {
    const normalized = this.muc.normalizeRoomJid(roomJid);
    const room = normalized
      ? this.muc.resolveBroadcast({ roomJid: normalized, sessionId: SERVICE_SESSION_ID })
      : { ok: false, error: { condition: 'jid-malformed' } };
    if (!room.ok) return { delivered: false, recipients: 0, reason: room.error.condition };
    let recipients = 0;
    for (const occupant of room.recipients) {
      const recipient = this._connectionById(occupant.sessionId);
      if (!recipient) continue;
      recipients += 1;
      this._sendTracked(recipient, xml('message', {
        type: 'groupchat',
        from: `${normalized}/${room.sender.nick}`,
        to: recipient.fullJid,
      }, xml('body', {}, body)));
    }
    if (recipients === 0) return { delivered: false, recipients: 0, reason: 'no-clients' };
    this.emit('servicePublish', {
      from: `${normalized}/${room.sender.nick}`,
      recipients,
      conversation: 'muc',
      room: normalized,
    });
    return { delivered: true, recipients };
  }

  /** Removes the application identity from every room it occupies. */
  leaveRoomsAsService() {
    for (const departure of this.muc.removeSession(SERVICE_SESSION_ID)) {
      for (const occupant of departure.remaining) {
        const recipient = this._connectionById(occupant.sessionId);
        if (!recipient) continue;
        this._sendTracked(recipient, xml('presence', {
          from: `${departure.roomJid}/${departure.nick}`,
          to: recipient.fullJid,
          type: 'unavailable',
        }));
      }
      this.emit('mucLeave', {
        room: departure.roomJid,
        nickname: departure.nick,
        jid: this.internalAccount.jid,
      });
    }
    this.serviceRooms.clear();
  }

  /** Number of occupants of a room excluding the application identity. */
  getRoomOccupantCount(roomJid) {
    const normalized = this.muc.normalizeRoomJid(roomJid);
    if (!normalized) return 0;
    return this.muc.getOccupants(normalized)
      .filter((occupant) => occupant.sessionId !== SERVICE_SESSION_ID).length;
  }

  _accept(socket) {
    const connection = {
      id: randomStanzaId('session'),
      socket,
      parser: null,
      decoder: new StringDecoder('utf8'),
      secure: false,
      authenticated: false,
      authInitiations: 0,
      authRateCharge: null,
      username: null,
      fullJid: null,
      rooms: new Map(),
      pendingBytes: 0,
      sm: { enabled: false, inbound: 0, outbound: 0, lastAck: 0 },
      remoteAddress: socket.remoteAddress,
      closed: false,
    };
    this.connections.add(connection);
    socket.setNoDelay(true);
    this._attachSocket(connection, socket);
    this._resetParser(connection);
    this.emit('connection', { remoteAddress: connection.remoteAddress });
  }

  _attachSocket(connection, socket) {
    if (connection.socket) {
      connection.socket.removeAllListeners('data');
      connection.socket.removeAllListeners('error');
      connection.socket.removeAllListeners('close');
    }
    connection.socket = socket;
    socket.on('data', (data) => this._onData(connection, data));
    socket.on('error', (error) => {
      this.emit('clientError', { message: error.message, jid: connection.fullJid });
    });
    socket.on('close', () => this._cleanup(connection));
  }

  _resetParser(connection) {
    const parser = new Parser();
    connection.parser = parser;
    connection.decoder = new StringDecoder('utf8');
    connection.pendingBytes = 0;
    parser.on('start', (root) => this._onStreamStart(connection, root));
    parser.on('element', (element) => this._onElement(connection, element));
    parser.on('end', () => this._gracefulClose(connection));
    parser.on('error', () => this._streamError(connection, 'not-well-formed'));
  }

  _onData(connection, data) {
    if (connection.closed) return;
    if (data.includes('<!DOCTYPE') || data.includes('<!ENTITY')) {
      this._streamError(connection, 'restricted-xml');
      return;
    }
    connection.pendingBytes += data.length;
    if (connection.pendingBytes > this.options.maxXmlBytes) {
      this._streamError(connection, 'policy-violation', 'XML size limit exceeded');
      return;
    }
    try {
      connection.parser.write(connection.decoder.write(data));
    } catch (_) {
      this._streamError(connection, 'not-well-formed');
    }
  }

  _onStreamStart(connection, root) {
    if (root.name !== 'stream:stream' ||
        String(root.attrs.to || '').trim().toLowerCase() !== this.options.domain) {
      this._streamError(connection, 'host-unknown');
      return;
    }
    connection.pendingBytes = 0;
    const id = randomStanzaId('stream');
    this._write(connection,
      `<?xml version="1.0"?><stream:stream from="${escapeXML(this.options.domain)}" id="${id}" ` +
      `xmlns="${NS.CLIENT}" xmlns:stream="${NS.STREAM}" version="1.0">`);
    this._sendFeatures(connection);
  }

  _sendFeatures(connection) {
    const features = [];
    if (!connection.authenticated) {
      if (!connection.secure && this.options.tlsPolicy !== TLS_POLICIES.DISABLED) {
        const children = this.options.tlsPolicy === TLS_POLICIES.REQUIRED ? [xml('required')] : [];
        features.push(xml('starttls', { xmlns: NS.TLS }, children));
      }
      if (connection.secure || this.options.tlsPolicy !== TLS_POLICIES.REQUIRED) {
        const mechanisms = [xml('mechanism', {}, 'SCRAM-SHA-1')];
        // PLAIN sends the password in the clear, so it is offered on a secure
        // stream, or on an unsecure stream only when TLS is deliberately
        // Disabled for local testing.
        if (connection.secure || this.options.tlsPolicy === TLS_POLICIES.DISABLED) {
          mechanisms.push(xml('mechanism', {}, 'PLAIN'));
        }
        features.push(xml('mechanisms', { xmlns: NS.SASL }, mechanisms));
      }
    } else {
      features.push(xml('bind', { xmlns: NS.BIND }));
      features.push(xml('sm', { xmlns: NS.SM }));
    }
    this._send(connection, xml('stream:features', {}, features));
  }

  async _onElement(connection, element) {
    connection.pendingBytes = 0;
    if (Buffer.byteLength(element.toString()) > this.options.maxXmlBytes) {
      this._streamError(connection, 'policy-violation', 'Stanza size limit exceeded');
      return;
    }
    try {
      if (element.is('starttls', NS.TLS)) return this._startTls(connection);
      if (!connection.secure && this.options.tlsPolicy === TLS_POLICIES.REQUIRED &&
          (element.is('auth', NS.SASL) || element.is('response', NS.SASL) ||
           element.is('abort', NS.SASL))) {
        this._saslFailure(connection, 'encryption-required');
        return this._streamError(connection, 'policy-violation', 'STARTTLS is required before SASL');
      }
      if (element.is('auth', NS.SASL)) return this._authenticate(connection, element);
      if (element.is('response', NS.SASL)) return this._scramResponse(connection, element);
      if (!connection.authenticated) return this._streamError(connection, 'not-authorized');
      if (element.is('resume', NS.SM)) {
        return this._send(connection, xml('failed', { xmlns: NS.SM },
          xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })));
      }
      if (element.is('enable', NS.SM)) return this._enableSm(connection);
      if (element.is('r', NS.SM)) return this._send(connection, xml('a', { xmlns: NS.SM, h: connection.sm.inbound }));
      if (element.is('a', NS.SM)) {
        connection.sm.lastAck = Number(element.attrs.h) || 0;
        return;
      }
      if (connection.sm.enabled && ['iq', 'message', 'presence'].includes(element.name)) {
        connection.sm.inbound += 1;
      }
      if (element.name === 'iq') return this._handleIq(connection, element);
      if (!connection.fullJid) return this._streamError(connection, 'not-authorized');
      if (element.name === 'message') return this._handleMessage(connection, element);
      if (element.name === 'presence') return this._handlePresence(connection, element);
    } catch (error) {
      this.emit('clientError', { message: error.message, jid: connection.fullJid });
      this._streamError(connection, 'internal-server-error');
    }
  }

  _startTls(connection) {
    if (connection.secure || this.options.tlsPolicy === TLS_POLICIES.DISABLED) {
      this._send(connection, xml('failure', { xmlns: NS.TLS }));
      return this._closeConnection(connection);
    }
    this._write(connection, xml('proceed', { xmlns: NS.TLS }).toString(), () => {
      const rawSocket = connection.socket;
      rawSocket.removeAllListeners('data');
      rawSocket.removeAllListeners('error');
      rawSocket.removeAllListeners('close');
      const tlsSocket = new tls.TLSSocket(rawSocket, {
        isServer: true,
        secureContext: this.secureContext,
      });
      connection.secure = true;
      this._attachSocket(connection, tlsSocket);
      this._resetParser(connection);
      tlsSocket.on('secure', () => this.emit('secure', { remoteAddress: tlsSocket.remoteAddress }));
    });
  }

  _authenticate(connection, element) {
    if (connection.sasl) {
      connection.sasl = null;
      connection.saslMechanism = null;
      return this._recordAuthFailure(connection, SASL_CONDITIONS.MALFORMED_REQUEST);
    }
    if (connection.authInitiations >= this.options.maxAuthAttemptsPerConnection) {
      this._saslFailure(connection, 'temporary-auth-failure');
      return;
    }
    connection.authInitiations += 1;
    const charge = this.authRateLimiter.charge(connection.remoteAddress);
    if (!charge) {
      this._saslFailure(connection, 'temporary-auth-failure');
      return;
    }
    connection.authRateCharge = charge;
    const mechanism = element.attrs.mechanism;
    if (mechanism === SASL_MECHANISMS.PLAIN && !connection.secure &&
        this.options.tlsPolicy !== TLS_POLICIES.DISABLED) {
      return this._recordAuthFailure(connection, 'encryption-required');
    }
    const sasl = createServerMechanism(mechanism, {
      verifyPassword: (username, password) => this.accountStore.verifyPassword(username, password),
      lookupPassword: (username) => this.accountStore.getPassword(username),
    });
    if (!sasl) {
      this._saslFailure(connection, SASL_CONDITIONS.INVALID_MECHANISM);
      return;
    }
    connection.sasl = sasl;
    connection.saslMechanism = mechanism;
    let initial;
    try {
      initial = decodeSaslPayload(element.text());
    } catch (_) {
      return this._recordAuthFailure(connection, SASL_CONDITIONS.INCORRECT_ENCODING);
    }
    this._applySaslResult(connection, sasl.start(initial));
  }

  _scramResponse(connection, element) {
    if (!connection.sasl) {
      return this._recordAuthFailure(connection, SASL_CONDITIONS.MALFORMED_REQUEST);
    }
    let response;
    try {
      response = decodeSaslPayload(element.text());
    } catch (_) {
      return this._recordAuthFailure(connection, SASL_CONDITIONS.INCORRECT_ENCODING);
    }
    this._applySaslResult(connection, connection.sasl.next(response));
  }

  _applySaslResult(connection, result) {
    if (result.status === 'challenge') {
      this._send(connection, xml('challenge', { xmlns: NS.SASL },
        Buffer.from(result.payload, 'utf8').toString('base64')));
      return;
    }
    if (result.status === 'success') {
      return this._authSuccess(connection, result.username, result.payload || '');
    }
    connection.sasl = null;
    connection.saslMechanism = null;
    return this._recordAuthFailure(connection, result.condition);
  }

  _authSuccess(connection, username, additionalData = '') {
    const mechanism = connection.saslMechanism;
    connection.authenticated = true;
    connection.username = normalizeAccountUsername(username);
    connection.sasl = null;
    connection.saslMechanism = null;
    this.authRateLimiter.refund(connection.remoteAddress, connection.authRateCharge);
    connection.authRateCharge = null;
    this._send(connection, xml('success', { xmlns: NS.SASL },
      additionalData ? Buffer.from(additionalData).toString('base64') : ''));
    this._resetParser(connection);
    this.emit('authenticated', { username: connection.username, mechanism, secure: connection.secure });
  }

  _recordAuthFailure(connection, condition) {
    if (connection.authRateCharge) connection.authRateCharge = null;
    else this.authRateLimiter.recordFailure(connection.remoteAddress);
    this._saslFailure(connection, condition);
  }

  _saslFailure(connection, condition) {
    this._send(connection, xml('failure', { xmlns: NS.SASL }, xml(condition)));
  }

  _handleIq(connection, stanza) {
    const type = stanza.attrs.type;
    // RFC 6120 §8.3.1: an error must never be generated in response to an
    // `iq` of type `result` or `error`, or the two peers can loop forever.
    if (type === 'result' || type === 'error') return;
    if (type !== 'get' && type !== 'set') {
      this._iqError(connection, stanza, 'bad-request', 'modify');
      return;
    }
    const bind = stanza.getChild('bind', NS.BIND);
    if (type === 'set' && bind) return this._bind(connection, stanza, bind);
    const discoInfo = stanza.getChild('query', NS.DISCO_INFO);
    if (type === 'get' && discoInfo && stanza.attrs.to === this.muc.mucDomain) {
      this._sendTracked(connection, xml('iq', {
        type: 'result',
        id: stanza.attrs.id,
        from: this.muc.mucDomain,
        to: connection.fullJid,
      }, xml('query', { xmlns: NS.DISCO_INFO },
        xml('identity', {
          category: 'conference',
          type: 'text',
          name: 'ArcGIS Velocity Simulator',
        }),
        xml('feature', { var: NS.MUC }))));
      return;
    }
    const ping = stanza.getChild('ping', NS.PING);
    if (type === 'get' && ping) {
      this._sendTracked(connection, xml('iq', {
        type: 'result',
        id: stanza.attrs.id,
        from: stanza.attrs.to || this.options.domain,
        to: connection.fullJid,
      }));
      return;
    }
    this._iqError(connection, stanza, 'service-unavailable');
  }

  _bind(connection, stanza, bind) {
    // RFC 6120 §7: exactly one resource may be bound per stream. Re-binding
    // would silently orphan the MUC occupant records and roster entries that
    // still carry the previous full JID, so the request is refused instead.
    if (connection.fullJid) {
      this._iqError(connection, stanza, 'not-allowed');
      return;
    }
    const requested = sanitizeResource(bind.getChildText('resource'));
    const resource = requested || crypto.randomBytes(6).toString('base64url');
    const fullJid = jid(connection.username, this.options.domain, resource).toString();
    const existing = this.bound.get(fullJid);
    if (existing && existing !== connection) {
      if (this.options.resourceConflict === RESOURCE_CONFLICT_POLICIES.REJECT) {
        this._iqError(connection, stanza, 'conflict');
        return;
      }
      this._streamError(existing, 'conflict', 'Resource replaced by a new connection');
    }
    connection.fullJid = fullJid;
    this.bound.set(fullJid, connection);
    this._sendTracked(connection, xml('iq', { type: 'result', id: stanza.attrs.id },
      xml('bind', { xmlns: NS.BIND }, xml('jid', {}, fullJid))));
    this.emit('bound', { jid: fullJid, secure: connection.secure });
  }

  _handleMessage(connection, stanza) {
    const to = stanza.attrs.to;
    const body = stanza.getChildText('body');
    if (!to || body === undefined || body === null) return;
    let target;
    try {
      target = jid(to);
    } catch (_) {
      this._messageError(connection, stanza, 'jid-malformed', 'modify');
      return;
    }
    if (this.muc.isMucJid(to)) {
      if (stanza.attrs.type === 'groupchat' && !target.resource) {
        this._sendMucMessage(connection, target.bare().toString(), body, stanza);
      } else {
        // Private messages between room occupants are deliberately not
        // implemented; the sender is told instead of being silently ignored.
        this._messageError(connection, stanza, 'feature-not-implemented', 'cancel');
      }
      return;
    }
    if (stanza.attrs.type !== 'chat') {
      this._messageError(connection, stanza, 'bad-request', 'modify');
      return;
    }
    const recipient = this._findRecipient(target);
    if (recipient) {
      this._sendTracked(recipient, xml('message', {
        type: stanza.attrs.type || 'chat',
        from: connection.fullJid,
        to: recipient.fullJid,
        id: stanza.attrs.id,
      }, xml('body', {}, body)));
      this.emit('message', {
        from: connection.fullJid,
        to: recipient.fullJid,
        body,
        secure: connection.secure,
      });
      return;
    }
    // The application identity usually has no socket of its own, so traffic
    // addressed to it is handed straight to the transport as inbound data.
    // A real stream signed in as that account still wins, above.
    if (!target.resource &&
        target.bare().toString().toLowerCase() === this.internalAccount.jid.toLowerCase()) {
      this.emit('message', {
        from: connection.fullJid,
        to: this.internalAccount.jid,
        body,
        secure: connection.secure,
      });
      return;
    }
    // RFC 6121 §8.5.2.2.1 / §8.5.3.2.1 — no available resource and no
    // offline storage, so the sender is told rather than silently dropped.
    this._messageError(connection, stanza, 'service-unavailable');
  }

  _findRecipient(target) {
    if (target.resource) {
      const canonicalFull = jid(
        target.local.toLowerCase(),
        target.domain.toLowerCase(),
        target.resource,
      ).toString();
      return this.bound.get(canonicalFull);
    }
    const bare = target.bare().toString().toLowerCase();
    return [...this.bound.entries()].reverse()
      .find(([full]) => jid(full).bare().toString().toLowerCase() === bare)?.[1];
  }

  _handlePresence(connection, stanza) {
    if (!stanza.attrs.to) return;
    const target = jid(stanza.attrs.to);
    if (!this.muc.isMucJid(stanza.attrs.to)) return;
    const roomJid = target.bare().toString();
    if (stanza.attrs.type === 'unavailable') {
      this._leaveRoom(connection, roomJid);
      return;
    }
    if (!target.resource || !stanza.getChild('x', NS.MUC)) return;
    const supplied = stanza.getChild('x', NS.MUC).getChildText('password') || '';
    this._joinRoom(connection, roomJid, target.resource, supplied);
  }

  /**
   * Joins a room, or changes nickname inside a room the stream already
   * occupies. The room registry validates everything before it mutates, so a
   * rejected password, nickname conflict or malformed room JID leaves the
   * stream's current occupancy — and `connection.rooms` — exactly as it was.
   */
  _joinRoom(connection, roomJid, nickname, password) {
    const result = this.muc.join({
      roomJid,
      nick: nickname,
      password,
      sessionId: connection.id,
      fullJid: connection.fullJid,
    });
    if (!result.ok) {
      this._sendTracked(connection, xml('presence', {
        from: `${roomJid}/${nickname}`,
        to: connection.fullJid,
        type: 'error',
      }, xml('error', { type: result.error.type }, xml(result.error.condition, {
        xmlns: NS.STANZA_ERROR,
      }))));
      this.emit('mucJoinRejected', {
        room: roomJid,
        nickname,
        jid: connection.fullJid,
        condition: result.error.condition,
      });
      return;
    }
    // XEP-0045 §7.6: a nickname change is announced to every occupant as an
    // `unavailable` presence for the old nickname carrying status code 303.
    if (result.previousNick) {
      this._broadcastNicknameChange(connection, roomJid, result.previousNick, result.self);
    } else {
      for (const occupant of result.existingOccupants) {
        this._sendMucPresence(connection, roomJid, occupant.nick, occupant, false, false);
      }
    }
    connection.rooms.set(roomJid, nickname);
    for (const occupant of this.muc.getOccupants(roomJid)) {
      const member = this._connectionById(occupant.sessionId);
      if (member) {
        this._sendMucPresence(
          member,
          roomJid,
          nickname,
          result.self,
          member === connection,
          result.created && member === connection,
        );
      }
    }
    this.emit('mucJoin', {
      room: roomJid,
      nickname,
      previousNickname: result.previousNick || null,
      jid: connection.fullJid,
      secure: connection.secure,
    });
  }

  _broadcastNicknameChange(connection, roomJid, previousNick, self) {
    for (const occupant of this.muc.getOccupants(roomJid)) {
      const member = this._connectionById(occupant.sessionId);
      if (!member) continue;
      const statuses = [xml('status', { code: '303' })];
      if (member === connection) statuses.push(xml('status', { code: '110' }));
      this._sendTracked(member, xml('presence', {
        from: `${roomJid}/${previousNick}`,
        to: member.fullJid,
        type: 'unavailable',
      }, xml('x', { xmlns: NS.MUC_USER },
        xml('item', {
          affiliation: self.affiliation,
          role: self.role,
          jid: self.fullJid,
          nick: self.nick,
        }),
        statuses)));
    }
  }

  _sendMucPresence(recipient, roomJid, nickname, occupant, self, created = false) {
    const statuses = [
      ...(created ? [xml('status', { code: '201' })] : []),
      ...(self ? [xml('status', { code: '110' })] : []),
    ];
    this._sendTracked(recipient, xml('presence', {
      from: `${roomJid}/${nickname}`,
      to: recipient.fullJid,
    }, xml('x', { xmlns: NS.MUC_USER },
      xml('item', {
        affiliation: occupant.affiliation,
        role: occupant.role,
        jid: occupant.fullJid,
      }),
      statuses)));
  }

  /**
   * Broadcasts a `groupchat` body to every occupant of a room, including the
   * sender so a client can identify its own message by the self echo.
   *
   * A stream that is not an occupant of the room receives an addressed stanza
   * error (XEP-0045 §7.2.2 `<not-acceptable/>`, or `<item-not-found/>` for a
   * room that does not exist) instead of having the message silently dropped.
   */
  _sendMucMessage(connection, roomJid, body, request) {
    const room = this.muc.resolveBroadcast({ roomJid, sessionId: connection.id });
    if (!room.ok) {
      this._messageError(connection, request, room.error.condition, room.error.type, 'groupchat');
      return;
    }
    const nickname = room.sender.nick;
    for (const occupant of room.recipients) {
      const recipient = this._connectionById(occupant.sessionId);
      if (!recipient) continue;
      this._sendTracked(recipient, xml('message', {
        type: 'groupchat',
        from: `${roomJid}/${nickname}`,
        to: recipient.fullJid,
      }, xml('body', {}, body)));
    }
    this.emit('mucMessage', {
      room: roomJid,
      nickname,
      body,
      secure: connection.secure,
    });
  }

  _messageError(connection, request, condition, errorType = 'cancel', messageType) {
    if (!request) return;
    const attrs = { type: 'error', id: request.attrs.id };
    if (connection.fullJid) attrs.to = connection.fullJid;
    if (request.attrs.to) attrs.from = request.attrs.to;
    const children = [xml('error', { type: errorType }, xml(condition, { xmlns: NS.STANZA_ERROR }))];
    this._sendTracked(connection, xml('message', attrs, children));
    this.emit('messageRejected', {
      from: connection.fullJid,
      to: request.attrs.to || null,
      type: messageType || request.attrs.type || 'chat',
      condition,
    });
  }

  _leaveRoom(connection, roomJid) {
    const nickname = connection.rooms.get(roomJid);
    if (!nickname) return;
    const result = this.muc.leave({ roomJid, sessionId: connection.id, nick: nickname });
    if (!result.ok) return;
    connection.rooms.delete(roomJid);
    for (const occupant of result.remaining) {
      const recipient = this._connectionById(occupant.sessionId);
      if (!recipient) continue;
      this._sendTracked(recipient, xml('presence', {
        from: `${roomJid}/${nickname}`,
        to: recipient.fullJid,
        type: 'unavailable',
      }));
    }
    this.emit('mucLeave', { room: roomJid, nickname, jid: connection.fullJid });
  }

  _connectionById(id) {
    return [...this.connections].find((connection) => connection.id === id);
  }

  _enableSm(connection) {
    connection.sm = { enabled: true, inbound: 0, outbound: 0, lastAck: 0 };
    this._send(connection, xml('enabled', {
      xmlns: NS.SM,
      id: crypto.randomBytes(12).toString('base64url'),
      resume: 'false',
    }));
  }

  _sendTracked(connection, stanza) {
    if (connection.sm.enabled && ['iq', 'message', 'presence'].includes(stanza.name)) {
      connection.sm.outbound += 1;
    }
    this._send(connection, stanza);
  }

  _iqError(connection, request, condition, errorType = 'cancel') {
    const attrs = { type: 'error', id: request.attrs.id, from: request.attrs.to || this.options.domain };
    if (connection.fullJid) attrs.to = connection.fullJid;
    this._sendTracked(connection, xml('iq', attrs,
      xml('error', { type: errorType }, xml(condition, {
        xmlns: NS.STANZA_ERROR,
      }))));
  }

  _send(connection, element) {
    this._write(connection, element.toString());
  }

  _write(connection, value, callback) {
    if (!connection.closed && connection.socket.writable) connection.socket.write(value, callback);
  }

  _streamError(connection, condition, text) {
    if (connection.closed) return;
    const children = [xml(condition, { xmlns: NS.STREAM_ERROR })];
    if (text) children.push(xml('text', { xmlns: NS.STREAM_ERROR, 'xml:lang': 'en' }, text));
    this._send(connection, xml('stream:error', {}, children));
    this._write(connection, '</stream:stream>', () => this._closeConnection(connection));
  }

  _gracefulClose(connection) {
    if (connection.closed) return;
    this._write(connection, '</stream:stream>', () => this._closeConnection(connection));
  }

  _closeConnection(connection) {
    if (connection.closed) return;
    connection.closed = true;
    connection.socket.end();
    setTimeout(() => {
      if (!connection.socket.destroyed) connection.socket.destroy();
    }, 1000).unref();
    this._cleanup(connection);
  }

  _cleanup(connection) {
    if (!this.connections.has(connection)) return;
    for (const roomJid of [...connection.rooms.keys()]) this._leaveRoom(connection, roomJid);
    if (connection.fullJid && this.bound.get(connection.fullJid) === connection) {
      this.bound.delete(connection.fullJid);
    }
    this.connections.delete(connection);
    this.emit('disconnect', { jid: connection.fullJid });
  }
}

module.exports = {
  NS,
  TLS_POLICIES,
  RESOURCE_CONFLICT_POLICIES,
  SERVICE_SESSION_ID,
  XmppServerCore,
};
