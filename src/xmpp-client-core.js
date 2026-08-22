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
 * @file xmpp-client-core.js
 * @description
 * Thin wrapper around the maintained `@xmpp/client` (xmpp.js) providing the
 * exact client-side surface the ArcGIS Velocity Simulator needs: connect,
 * direct chat, Multi-User Chat join/send/leave, XEP-0199 ping, XEP-0198 ack
 * requests, and a clean close.
 *
 * The wrapper adds three things xmpp.js does not offer directly:
 *   - per-client STARTTLS options (custom CA, explicit loopback-only
 *     verification bypass) without touching global `node:tls` behavior
 *   - cancellable stanza/nonza waiters so a failed send never leaves a
 *     dangling timer or listener behind
 *   - a canonical, configurable automatic-reconnect delay instead of xmpp.js's
 *     fixed one-second retry
 */

const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const { EventEmitter } = require('events');
const { client, xml } = require('@xmpp/client');
const {
  DEFAULT_CLIENT_TIMEOUT_MS,
  XMPP_DEFAULT_RECONNECT_DELAY_MS,
  XMPP_DEFAULT_RESOURCE,
  XMPP_MIN_TIMING_MS,
  XMPP_NS,
  STARTTLS_POLICIES,
  VALID_STARTTLS_POLICIES,
} = require('./xmpp-constants');
const {
  isLoopbackHost,
  normalizeAccountUsername,
  normalizeDomain,
} = require('./xmpp-utils');

const tlsOptionsContext = new AsyncLocalStorage();
let tlsSocketOverridePromise;

/**
 * `@xmpp/starttls` does not expose TLS options, so this module narrowly
 * augments `@xmpp/tls`'s Socket class. Unlike replacing `node:tls.connect`,
 * this cannot affect unrelated TLS traffic. AsyncLocalStorage keeps
 * simultaneous XMPP clients' CA and verification options isolated. This
 * relies on the `@xmpp/tls/lib/Socket.js` entry point and must be revalidated
 * on dependency upgrades until xmpp.js exposes per-client STARTTLS options.
 */
function installXmppTlsSocketOverride() {
  if (tlsSocketOverridePromise) return tlsSocketOverridePromise;
  tlsSocketOverridePromise = import('@xmpp/tls/lib/Socket.js').then(({ default: XmppTlsSocket }) => {
    if (XmppTlsSocket.prototype.connect.__velocityTlsOverride) return;
    const originalConnect = XmppTlsSocket.prototype.connect;
    function scopedXmppTlsConnect(...args) {
      const override = tlsOptionsContext.getStore();
      if (override && args[0]?.socket) args[0] = { ...args[0], ...override };
      return originalConnect.apply(this, args);
    }
    Object.defineProperty(scopedXmppTlsConnect, '__velocityTlsOverride', { value: true });
    XmppTlsSocket.prototype.connect = scopedXmppTlsConnect;
  });
  return tlsSocketOverridePromise;
}

function loadPem(value, filePath, label) {
  if (value && filePath) throw new Error(`Specify either ${label} or ${label}Path, not both`);
  return filePath ? fs.readFileSync(filePath) : value;
}

function createCancellableWaiter({ subscribe, timeout, timeoutMessage, onCleanup = () => {} }) {
  let active = true;
  let timer;
  let unsubscribe = () => {};
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const cleanup = () => {
    clearTimeout(timer);
    unsubscribe();
    onCleanup();
  };
  const settle = (callback) => (value) => {
    if (!active) return;
    active = false;
    cleanup();
    callback(value);
  };
  const resolve = settle(resolvePromise);
  const reject = settle(rejectPromise);
  unsubscribe = subscribe(resolve);
  if (active && timeout > 0) timer = setTimeout(() => reject(new Error(timeoutMessage)), timeout);
  return {
    promise,
    cancel(error) {
      if (!active) return;
      if (error) reject(error);
      else {
        active = false;
        cleanup();
      }
    },
  };
}

function destroySocket(socket) {
  const underlying = socket?.socket || socket;
  if (underlying && typeof underlying.destroy === 'function' && !underlying.destroyed) {
    underlying.destroy();
  }
}

class XmppClientCore extends EventEmitter {
  constructor(options) {
    super();
    if (!options?.service || !options.domain || !options.username || !options.password) {
      throw new Error('service, domain, username, and password are required');
    }
    const serviceUrl = new URL(options.service);
    if (options.rejectUnauthorized === false && !isLoopbackHost(serviceUrl.hostname)) {
      throw new Error('TLS verification bypass is restricted to loopback services');
    }
    this.options = {
      resource: XMPP_DEFAULT_RESOURCE,
      timeout: DEFAULT_CLIENT_TIMEOUT_MS,
      tlsPolicy: STARTTLS_POLICIES.REQUIRED,
      reconnectDelayMs: XMPP_DEFAULT_RECONNECT_DELAY_MS,
      ...options,
      domain: normalizeDomain(options.domain),
      username: normalizeAccountUsername(options.username),
    };
    if (!VALID_STARTTLS_POLICIES.has(this.options.tlsPolicy)) {
      throw new Error(`Invalid XMPP STARTTLS policy: ${this.options.tlsPolicy}`);
    }
    if (!Number.isInteger(this.options.reconnectDelayMs) ||
        this.options.reconnectDelayMs < XMPP_MIN_TIMING_MS) {
      throw new Error(
        `'reconnectDelayMs' must be an integer of ${XMPP_MIN_TIMING_MS} millisecond or more.`,
      );
    }
    const ca = loadPem(options.ca, options.caPath, 'ca');
    this.tlsOptions = {
      ...(ca ? { ca } : {}),
      ...(options.rejectUnauthorized === false ? { rejectUnauthorized: false } : {}),
    };
    let entity;
    const credentials = async (authenticate, mechanisms) => {
      if (this.options.tlsPolicy === STARTTLS_POLICIES.REQUIRED && !entity.isSecure()) {
        throw new Error('STARTTLS is required but the server did not offer an encrypted stream; SASL was not attempted');
      }
      if (options.mechanism) {
        if (!mechanisms.includes(options.mechanism)) {
          throw new Error(`Requested SASL mechanism is unavailable: ${options.mechanism}`);
        }
        await authenticate({
          username: this.options.username,
          password: options.password,
        }, options.mechanism);
        return;
      }
      const mechanism = entity.isSecure()
        ? mechanisms[0]
        : mechanisms.find((candidate) => candidate !== 'PLAIN');
      if (!mechanism) throw new Error('No acceptable SASL mechanism is available');
      await authenticate({
        username: this.options.username,
        password: options.password,
      }, mechanism);
    };
    entity = client({
      service: options.service,
      domain: this.options.domain,
      resource: this.options.resource,
      username: this.options.username,
      password: options.password,
      credentials,
      timeout: this.options.timeout,
    });
    this.entity = entity;
    // xmpp.js schedules its automatic reconnect one second after a drop. The
    // Simulator replaces that with the configured canonical delay so a server
    // that is down is not hammered once per second for the length of a replay.
    this.entity.reconnect.delay = this.options.reconnectDelayMs;
    this.joinedRooms = new Map();
    this.waiters = new Set();
    this.pendingWaiters = new Set();
    this.onlineCount = 0;
    this.entity.on('error', (error) => this.emit('error', error));
    this.entity.on('status', (status) => {
      if (this.entity.socket) this.activeSocket = this.entity.socket;
      this.emit('status', status);
    });
    this.entity.on('stanza', (stanza) => this._onStanza(stanza));
    this.entity.on('online', async (address) => {
      this.address = address;
      this.onlineCount += 1;
      this.emit('online', address);
      if (this.onlineCount > 1) {
        for (const [room, details] of this.joinedRooms) {
          await this._sendJoin(room, details.nickname, details.password);
        }
        this.emit('roomsRejoined', [...this.joinedRooms.keys()]);
      }
    });
    this.entity.on('offline', () => this.emit('offline'));
  }

  async connect() {
    await installXmppTlsSocketOverride();
    const connecting = tlsOptionsContext.run(this.tlsOptions, () => this.entity.start());
    if (this.entity.socket) this.activeSocket = this.entity.socket;
    return connecting;
  }

  async close() {
    this.entity.reconnect.stop();
    this.joinedRooms.clear();
    for (const waiter of [...this.pendingWaiters]) {
      waiter.cancel(new Error('XMPP client closed while waiting for a response'));
    }
    const activeSocket = this.entity.socket || this.activeSocket;
    if (this.entity.status === 'offline') {
      destroySocket(activeSocket);
      this.activeSocket = null;
      return;
    }
    const stopPromise = this.entity.stop();
    const closeTimeout = Math.max(100, Math.min(this.options.timeout || DEFAULT_CLIENT_TIMEOUT_MS, 1000));
    let timer;
    try {
      await Promise.race([
        stopPromise,
        new Promise((resolve) => {
          timer = setTimeout(() => {
            destroySocket(this.entity.socket);
            resolve();
          }, closeTimeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      destroySocket(activeSocket);
      this.activeSocket = null;
      stopPromise.catch(() => {});
    }
  }

  async disconnectForReconnect() {
    await tlsOptionsContext.run(this.tlsOptions, () => this.entity.disconnect());
  }

  isOnline() {
    return this.entity.status === 'online';
  }

  isSecure() {
    return this.entity.isSecure();
  }

  /** Milliseconds xmpp.js waits before it retries a dropped stream. */
  getReconnectDelayMs() {
    return this.entity.reconnect.delay;
  }

  get jid() {
    return this.address?.toString() || null;
  }

  async sendChat(to, body) {
    await this.entity.send(xml('message', { type: 'chat', to }, xml('body', {}, body)));
  }

  async joinMuc(room, nickname, password) {
    const waiter = this._createStanzaWaiter((stanza) => stanza.name === 'presence' &&
      stanza.attrs.from === `${room}/${nickname}` &&
      (stanza.attrs.type === 'error' ||
       stanza.getChild('x', XMPP_NS.MUC_USER)
         ?.getChildren('status')
         .some((status) => status.attrs.code === '110')));
    try {
      await this._sendJoin(room, nickname, password);
    } catch (error) {
      waiter.cancel();
      throw error;
    }
    const presence = await waiter.promise;
    if (presence.attrs.type === 'error') {
      const stanzaError = presence.getChild('error');
      const condition = stanzaError
        ?.children
        .find((child) => child.attrs?.xmlns === XMPP_NS.STANZA_ERROR && child.name !== 'text')
        ?.name || 'undefined-condition';
      const error = new Error(`MUC join failed for ${room}/${nickname}: ${condition}`);
      error.condition = condition;
      error.stanza = presence;
      throw error;
    }
    this.joinedRooms.set(room, { nickname, password });
    return presence;
  }

  async _sendJoin(room, nickname, password) {
    const children = [xml('history', { maxstanzas: '0' })];
    if (password) children.unshift(xml('password', {}, password));
    await this.entity.send(xml('presence', { to: `${room}/${nickname}` },
      xml('x', { xmlns: XMPP_NS.MUC }, children)));
  }

  async sendMuc(room, body) {
    await this.entity.send(xml('message', { type: 'groupchat', to: room }, xml('body', {}, body)));
  }

  async leaveMuc(room) {
    const details = this.joinedRooms.get(room);
    if (!details) return;
    this.joinedRooms.delete(room);
    await this.entity.send(xml('presence', {
      to: `${room}/${details.nickname}`,
      type: 'unavailable',
    }));
  }

  async ping(to = this.options.domain) {
    return this.entity.iqCaller.request(xml('iq', { type: 'get', to },
      xml('ping', { xmlns: XMPP_NS.PING })), this.options.timeout);
  }

  waitFor(predicate, timeout = this.options.timeout) {
    return this._createStanzaWaiter(predicate, timeout).promise;
  }

  _createStanzaWaiter(predicate, timeout = this.options.timeout) {
    let subscription;
    let handle;
    handle = createCancellableWaiter({
      timeout,
      timeoutMessage: 'Timed out waiting for XMPP stanza',
      onCleanup: () => this.pendingWaiters.delete(handle),
      subscribe: (resolve) => {
        subscription = { predicate, resolve };
        this.waiters.add(subscription);
        return () => this.waiters.delete(subscription);
      },
    });
    this.pendingWaiters.add(handle);
    return handle;
  }

  waitForNonza(predicate, timeout = this.options.timeout) {
    return this._createNonzaWaiter(predicate, timeout).promise;
  }

  _createNonzaWaiter(predicate, timeout = this.options.timeout) {
    let handle;
    handle = createCancellableWaiter({
      timeout,
      timeoutMessage: 'Timed out waiting for XMPP nonza',
      onCleanup: () => this.pendingWaiters.delete(handle),
      subscribe: (resolve) => {
        const onNonza = (element) => {
          if (!predicate(element)) return;
          resolve(element);
        };
        this.entity.on('nonza', onNonza);
        return () => this.entity.removeListener('nonza', onNonza);
      },
    });
    this.pendingWaiters.add(handle);
    return handle;
  }

  async requestServerAck() {
    const waiter = this._createNonzaWaiter((element) => element.is('a', XMPP_NS.SM));
    try {
      await this.entity.send(xml('r', { xmlns: XMPP_NS.SM }));
    } catch (error) {
      waiter.cancel();
      throw error;
    }
    return waiter.promise;
  }

  _onStanza(stanza) {
    for (const waiter of [...this.waiters]) {
      if (!waiter.predicate(stanza)) continue;
      waiter.resolve(stanza);
    }
    this.emit('stanza', stanza);
    if (stanza.name === 'message') {
      const body = stanza.getChildText('body');
      if (stanza.attrs.type === 'error') {
        const stanzaError = stanza.getChild('error');
        const condition = stanzaError
          ?.children
          .find((child) => child.attrs?.xmlns === XMPP_NS.STANZA_ERROR && child.name !== 'text')
          ?.name || 'undefined-condition';
        this.emit('messageError', { from: stanza.attrs.from, condition, stanza });
        return;
      }
      if (stanza.attrs.type === 'groupchat') {
        const slash = stanza.attrs.from?.indexOf('/') ?? -1;
        this.emit('mucMessage', {
          room: slash < 0 ? stanza.attrs.from : stanza.attrs.from.slice(0, slash),
          nickname: slash < 0 ? null : stanza.attrs.from.slice(slash + 1),
          body,
          self: slash >= 0 && this.joinedRooms.get(stanza.attrs.from.slice(0, slash))?.nickname ===
            stanza.attrs.from.slice(slash + 1),
          secure: this.isSecure(),
          stanza,
        });
      } else if (stanza.attrs.type === 'chat') {
        // Direct inbound is chat-only. A `normal`, `headline` or untyped
        // message is deliberately not surfaced as replay data, so unrelated
        // server notices never look like traffic from the receiver.
        this.emit('chat', {
          from: stanza.attrs.from,
          to: stanza.attrs.to,
          body,
          secure: this.isSecure(),
          stanza,
        });
      }
    }
  }
}

module.exports = {
  XmppClientCore,
  isLoopback: isLoopbackHost,
};
