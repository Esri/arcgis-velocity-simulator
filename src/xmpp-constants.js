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
 * @file xmpp-constants.js
 * @description
 * Shared constants for the ArcGIS Velocity Simulator XMPP transport.
 * Namespaces, default ports, policy enumerations and the documented bounds
 * used by the built-in client-to-server server, the `@xmpp/client` wrapper,
 * and the transport facade that wires both into the app.
 *
 * Everything the UI, the CLI and the documentation need to agree on lives
 * here so the three can never drift apart.
 */

/**
 * XML namespaces used by the transport. Only the namespaces actually
 * implemented are listed — no broader XEP claims are made.
 */
const XMPP_NS = Object.freeze({
  STREAM: 'http://etherx.jabber.org/streams',
  CLIENT: 'jabber:client',
  STREAM_ERROR: 'urn:ietf:params:xml:ns:xmpp-streams',
  STANZA_ERROR: 'urn:ietf:params:xml:ns:xmpp-stanzas',
  TLS: 'urn:ietf:params:xml:ns:xmpp-tls',
  SASL: 'urn:ietf:params:xml:ns:xmpp-sasl',
  BIND: 'urn:ietf:params:xml:ns:xmpp-bind',
  SM: 'urn:xmpp:sm:3',
  PING: 'urn:xmpp:ping',
  DISCO_INFO: 'http://jabber.org/protocol/disco#info',
  MUC: 'http://jabber.org/protocol/muc',
  MUC_USER: 'http://jabber.org/protocol/muc#user',
});

/** Default client-to-server port (RFC 6120). */
const XMPP_DEFAULT_C2S_PORT = 5222;

/**
 * Loopback-safe default bind address. The server refuses to bind a
 * non-loopback interface unless the caller explicitly opts in.
 */
const XMPP_DEFAULT_BIND_HOST = '127.0.0.1';

/** Default served domain and MUC sub-domain. */
const XMPP_DEFAULT_DOMAIN = 'localhost';
const XMPP_DEFAULT_MUC_SUBDOMAIN = 'conference';

/** Simulator role inside the XMPP options. The app-wide default stays TCP Server. */
const XMPP_ROLES = Object.freeze({ CLIENT: 'client', SERVER: 'server' });
const VALID_XMPP_ROLES = Object.freeze(new Set(Object.values(XMPP_ROLES)));
const XMPP_DEFAULT_ROLE = XMPP_ROLES.CLIENT;

/** Conversation shape used when publishing simulated data. */
const XMPP_CONVERSATIONS = Object.freeze({ DIRECT: 'direct', MUC: 'muc' });
const VALID_XMPP_CONVERSATIONS = Object.freeze(new Set(Object.values(XMPP_CONVERSATIONS)));
const XMPP_DEFAULT_CONVERSATION = XMPP_CONVERSATIONS.DIRECT;

/** STARTTLS negotiation policies advertised by the server and demanded by the client. */
const STARTTLS_POLICIES = Object.freeze({
  REQUIRED: 'required',
  PREFERRED: 'preferred',
  DISABLED: 'disabled',
});
const VALID_STARTTLS_POLICIES = Object.freeze(new Set(Object.values(STARTTLS_POLICIES)));
const XMPP_DEFAULT_TLS_POLICY = STARTTLS_POLICIES.REQUIRED;

/** Behavior when a resource binds over an already-bound identical full JID. */
const RESOURCE_CONFLICT_POLICIES = Object.freeze({
  /** Close the older stream with a `<conflict/>` stream error (RFC 6120 default). */
  REPLACE: 'replace',
  /** Reject the new bind request with a `<conflict/>` stanza error. */
  REJECT: 'reject',
});
const VALID_RESOURCE_CONFLICT_POLICIES = Object.freeze(
  new Set(Object.values(RESOURCE_CONFLICT_POLICIES)),
);

/** SASL mechanisms implemented server-side. */
const SASL_MECHANISMS = Object.freeze({
  PLAIN: 'PLAIN',
  SCRAM_SHA_1: 'SCRAM-SHA-1',
});
const VALID_SASL_MECHANISMS = Object.freeze(new Set(Object.values(SASL_MECHANISMS)));
const DEFAULT_SASL_MECHANISMS = Object.freeze([
  SASL_MECHANISMS.SCRAM_SHA_1,
  SASL_MECHANISMS.PLAIN,
]);

/** SCRAM-SHA-1 salting parameters (RFC 5802). */
const SCRAM_SHA_1_ITERATIONS = 4096;
const SCRAM_SHA_1_SALT_BYTES = 16;

/**
 * Largest message body the transport will publish, measured in UTF-8 bytes.
 * Longer lines are rejected before they reach the wire rather than being
 * truncated, so a replay never silently loses data.
 */
const XMPP_MAX_BODY_BYTES = 65_536;

/**
 * Largest number of comma-separated destination JIDs accepted in Direct mode.
 * Each line is delivered once per destination, so the cap keeps a single
 * replay tick bounded.
 */
const XMPP_MAX_DESTINATIONS = 20;

/**
 * Bounds and rate limits. The stanza cap is evaluated after every socket chunk
 * against the number of bytes received since the last complete top-level
 * element, so an oversized stanza may exceed the cap by at most one socket
 * chunk before the stream is terminated.
 *
 * The cap is deliberately larger than `XMPP_MAX_BODY_BYTES` because a maximal
 * body still has to fit inside its stanza envelope after XML escaping.
 */
const DEFAULT_MAX_STANZA_BYTES = 512 * 1024;
const DEFAULT_MAX_AUTH_ATTEMPTS_PER_CONNECTION = 3;
const DEFAULT_AUTH_RATE_LIMIT = Object.freeze({
  windowMs: 60_000,
  maxFailures: 10,
});

/** Default stream/IQ timeout used by the client wrapper (milliseconds). */
const DEFAULT_CLIENT_TIMEOUT_MS = 5_000;

/**
 * User-facing timing defaults surfaced in the XMPP options, the CLI and the
 * launch configuration files.
 *
 * Every one of these is a **positive** integer count of milliseconds. There is
 * no zero-disables or zero-waits-forever behavior: a run that cannot make
 * progress must fail at a deadline rather than hang, and an idle client stream
 * always keeps itself alive.
 */
const XMPP_DEFAULT_CONNECT_TIMEOUT_MS = 30_000;
const XMPP_DEFAULT_REPLY_TIMEOUT_MS = 15_000;
const XMPP_DEFAULT_PING_INTERVAL_MS = 60_000;
const XMPP_DEFAULT_RECONNECT_DELAY_MS = 60_000;

/**
 * The canonical option name and default of every user-facing XMPP timing, in
 * the order they are presented. The UI, the CLI, the transport, the copied
 * client settings and the documentation tests all read this one map so a new
 * timing can never be added to some of them and forgotten in the rest.
 */
const XMPP_TIMING_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'xmppConnectTimeoutMs',
    defaultValue: XMPP_DEFAULT_CONNECT_TIMEOUT_MS,
    roles: Object.freeze(['client', 'server']),
  }),
  Object.freeze({
    key: 'xmppReplyTimeoutMs',
    defaultValue: XMPP_DEFAULT_REPLY_TIMEOUT_MS,
    roles: Object.freeze(['client', 'server']),
  }),
  Object.freeze({
    key: 'xmppPingIntervalMs',
    defaultValue: XMPP_DEFAULT_PING_INTERVAL_MS,
    roles: Object.freeze(['client']),
  }),
  Object.freeze({
    key: 'xmppReconnectDelayMs',
    defaultValue: XMPP_DEFAULT_RECONNECT_DELAY_MS,
    roles: Object.freeze(['client']),
  }),
]);

/** Smallest accepted value for every XMPP timing option, in milliseconds. */
const XMPP_MIN_TIMING_MS = 1;

/** Default resource part requested at bind time. */
const XMPP_DEFAULT_RESOURCE = 'velocity-simulator';

/** Default room nickname used by both roles. */
const XMPP_DEFAULT_NICKNAME = 'velocity-simulator';

/**
 * Exactly what XEP-0198 support is implemented and verified.
 * Kept as data so tests and docs cannot drift from the implementation, and so
 * the transport never overstates its support.
 */
const STREAM_MANAGEMENT_SUPPORT = Object.freeze({
  namespace: XMPP_NS.SM,
  /** `<sm/>` is advertised after SASL, alongside `<bind/>`. */
  advertised: true,
  /** `<enable/>` → `<enabled resume='false'/>` is implemented. */
  enable: true,
  /** `<r/>` → `<a h='N'/>` in both directions is implemented. */
  ackRequests: true,
  /** Inbound/outbound stanza counters are maintained per stream. */
  counters: true,
  /** Stream resumption (`<resume/>` / `<resumed/>`) is NOT implemented. */
  resumption: false,
  /** Unacked outbound stanzas are NOT queued or replayed by the server. */
  outboundReplay: false,
  limitations: Object.freeze([
    'Resumption is not implemented; the server always answers <enabled resume="false"/>.',
    'The server does not queue or replay unacknowledged outbound stanzas after a disconnect.',
    'Acks are advisory only — they are counted and reported but never used to retransmit.',
    'A dropped stream therefore reconnects as a brand new session: the resource is re-bound and rooms are re-joined.',
  ]),
});

module.exports = {
  XMPP_NS,
  XMPP_DEFAULT_C2S_PORT,
  XMPP_DEFAULT_BIND_HOST,
  XMPP_DEFAULT_DOMAIN,
  XMPP_DEFAULT_MUC_SUBDOMAIN,
  XMPP_ROLES,
  VALID_XMPP_ROLES,
  XMPP_DEFAULT_ROLE,
  XMPP_CONVERSATIONS,
  VALID_XMPP_CONVERSATIONS,
  XMPP_DEFAULT_CONVERSATION,
  STARTTLS_POLICIES,
  VALID_STARTTLS_POLICIES,
  XMPP_DEFAULT_TLS_POLICY,
  RESOURCE_CONFLICT_POLICIES,
  VALID_RESOURCE_CONFLICT_POLICIES,
  SASL_MECHANISMS,
  VALID_SASL_MECHANISMS,
  DEFAULT_SASL_MECHANISMS,
  SCRAM_SHA_1_ITERATIONS,
  SCRAM_SHA_1_SALT_BYTES,
  XMPP_MAX_BODY_BYTES,
  XMPP_MAX_DESTINATIONS,
  DEFAULT_MAX_STANZA_BYTES,
  DEFAULT_MAX_AUTH_ATTEMPTS_PER_CONNECTION,
  DEFAULT_AUTH_RATE_LIMIT,
  DEFAULT_CLIENT_TIMEOUT_MS,
  XMPP_DEFAULT_CONNECT_TIMEOUT_MS,
  XMPP_DEFAULT_REPLY_TIMEOUT_MS,
  XMPP_DEFAULT_PING_INTERVAL_MS,
  XMPP_DEFAULT_RECONNECT_DELAY_MS,
  XMPP_TIMING_OPTIONS,
  XMPP_MIN_TIMING_MS,
  XMPP_DEFAULT_RESOURCE,
  XMPP_DEFAULT_NICKNAME,
  STREAM_MANAGEMENT_SUPPORT,
};
