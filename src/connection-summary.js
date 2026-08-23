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
 * @file connection-summary.js
 * @description
 * Pure, testable helpers that turn the current connection field values into a
 * single human-readable summary. One generator feeds all three summary
 * surfaces: the inline summary card next to the connection row, the status-bar
 * summary button, and the read-only summary shown by the Protocol Settings
 * dialog while a connection is live.
 *
 * The row keys, groups, and kinds are a cross-application contract shared with
 * the ArcGIS Velocity Logger. Only genuinely role-specific rows differ: this
 * repository (the Simulator) sends data, so it reports `xmppDestination` — the
 * bare JIDs each replayed line is delivered to — where the Logger reports the
 * identity it receives on.
 *
 * Secrets are never exposed. A password-like value is reported as
 * `Set (hidden)`, `Empty`, or `Not set` and nothing else.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ConnectionSummary = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Redaction strings. A secret value itself never leaves this module. */
  const SECRET_SET = 'Set (hidden)';
  const SECRET_EMPTY = 'Empty';
  const SECRET_UNSET = 'Not set';

  /** Placeholder used when a required endpoint part is still blank. */
  const NOT_SET = 'Not set';

  /** Row groups, shared with the sister application. */
  const ROW_GROUPS = Object.freeze(['Security', 'Connection', 'Protocol', 'Session']);

  /** Row kinds, shared with the sister application. */
  const ROW_KINDS = Object.freeze([
    'warning', 'state', 'endpoint', 'preset', 'security', 'setting', 'secret',
  ]);

  /** Every connection mode the application supports, in dropdown order. */
  const CONNECTION_TYPES = Object.freeze([
    'tcp-server', 'tcp-client',
    'udp-server', 'udp-client',
    'http-client', 'http-server',
    'ws-client', 'ws-server',
    'grpc-server', 'grpc-client',
    'xmpp-server', 'xmpp-client',
  ]);

  /** Display name for each connection mode. */
  const CONNECTION_TYPE_LABELS = Object.freeze({
    'tcp-server': 'TCP Server',
    'tcp-client': 'TCP Client',
    'udp-server': 'UDP Server',
    'udp-client': 'UDP Client',
    'http-client': 'HTTP Client',
    'http-server': 'HTTP Server',
    'ws-client': 'WebSocket Client',
    'ws-server': 'WebSocket Server',
    'grpc-server': 'gRPC Server',
    'grpc-client': 'gRPC Client',
    'xmpp-server': 'XMPP Server',
    'xmpp-client': 'XMPP Client',
  });

  /** Protocol display names used in titles and chips. */
  const PROTOCOL_LABELS = Object.freeze({
    tcp: 'TCP',
    udp: 'UDP',
    http: 'HTTP',
    ws: 'WebSocket',
    grpc: 'gRPC',
    xmpp: 'XMPP',
  });

  /** Role display names. */
  const MODE_LABELS = Object.freeze({ client: 'Client', server: 'Server' });

  /** Protocols that own a Protocol Settings dialog section. */
  const DIALOG_PROTOCOLS = Object.freeze(['http', 'ws', 'grpc', 'xmpp']);

  /** Data format display names shared by the HTTP and WebSocket transports. */
  const FORMAT_LABELS = Object.freeze({
    delimited: 'Delimited (CSV)',
    json: 'JSON',
    'esri-json': 'Esri JSON',
    'geo-json': 'GeoJSON',
    xml: 'XML',
  });

  const GRPC_SERIALIZATION_LABELS = Object.freeze({
    protobuf: 'Protobuf',
    kryo: 'Kryo',
    text: 'Text',
  });

  const GRPC_RPC_LABELS = Object.freeze({
    stream: 'Client Streaming',
    unary: 'Unary',
  });

  const XMPP_TLS_POLICY_LABELS = Object.freeze({
    required: 'Required STARTTLS',
    preferred: 'Preferred STARTTLS',
    disabled: 'STARTTLS disabled',
  });

  const XMPP_CONVERSATION_LABELS = Object.freeze({
    direct: 'Direct',
    muc: 'Multi-User Chat',
  });

  const CONNECTION_STATE_LABELS = Object.freeze({
    disconnected: 'Disconnected',
    connecting: 'Connecting',
    connected: 'Connected',
    disconnecting: 'Disconnecting',
    error: 'Error',
  });

  /**
   * Protocol settings that the configured-state count covers. A setting counts
   * as configured when it differs from the default listed here, so the count
   * answers "how much of this protocol did I change?" rather than "how many
   * controls exist?".
   */
  const PROTOCOL_SETTING_FIELDS = Object.freeze({
    tcp: Object.freeze([]),
    udp: Object.freeze([]),
    grpc: Object.freeze([
      { field: 'grpcSerialization', defaultValue: 'protobuf' },
      { field: 'grpcSendMethod', defaultValue: 'stream' },
      { field: 'grpcTls', defaultValue: true },
      { field: 'grpcTlsCaPath', defaultValue: '' },
      { field: 'grpcTlsCertPath', defaultValue: '' },
      { field: 'grpcTlsKeyPath', defaultValue: '' },
      { field: 'grpcAllowUnverifiedTls', defaultValue: false, clientOnly: true },
      { field: 'grpcHeaderPathKey', defaultValue: 'grpc-path', clientOnly: true },
      { field: 'grpcHeaderPath', defaultValue: 'replace.with.dedicated.uid', clientOnly: true },
    ]),
    http: Object.freeze([
      { field: 'httpFormat', defaultValue: 'delimited' },
      { field: 'httpTls', defaultValue: true },
      { field: 'httpPath', defaultValue: '/' },
      { field: 'httpTlsCaPath', defaultValue: '' },
      { field: 'httpTlsCertPath', defaultValue: '' },
      { field: 'httpTlsKeyPath', defaultValue: '' },
      { field: 'httpAllowUnverifiedTls', defaultValue: false, clientOnly: true },
    ]),
    ws: Object.freeze([
      { field: 'wsFormat', defaultValue: 'delimited' },
      { field: 'wsTls', defaultValue: true },
      { field: 'wsPath', defaultValue: '/' },
      { field: 'wsTlsCaPath', defaultValue: '' },
      { field: 'wsTlsCertPath', defaultValue: '' },
      { field: 'wsTlsKeyPath', defaultValue: '' },
      { field: 'wsAllowUnverifiedTls', defaultValue: false, clientOnly: true },
      { field: 'wsSubscriptionMsg', defaultValue: '' },
      { field: 'wsIgnoreFirstMsg', defaultValue: false },
      { field: 'wsHeaders', defaultValue: '' },
    ]),
    xmpp: Object.freeze([
      { field: 'xmppDomain', defaultValue: 'localhost' },
      { field: 'xmppTlsPolicy', defaultValue: 'required' },
      { field: 'xmppConversation', defaultValue: 'direct' },
      { field: 'xmppUsername', defaultValue: '', clientOnly: true },
      { field: 'xmppPassword', defaultValue: '', clientOnly: true },
      { field: 'xmppResource', defaultValue: 'velocity-simulator', clientOnly: true },
      { field: 'xmppDestination', defaultValue: '', directOnly: true },
      { field: 'xmppAllowUnverifiedTls', defaultValue: false, clientOnly: true },
      { field: 'xmppExternalUsername', defaultValue: '', serverOnly: true },
      { field: 'xmppExternalPassword', defaultValue: '', serverOnly: true },
      { field: 'xmppAllowRemote', defaultValue: false, serverOnly: true },
      { field: 'xmppTlsCaPath', defaultValue: '' },
      { field: 'xmppTlsCertPath', defaultValue: '', serverOnly: true },
      { field: 'xmppTlsKeyPath', defaultValue: '', serverOnly: true },
      { field: 'xmppRoom', defaultValue: '', mucOnly: true },
      { field: 'xmppNickname', defaultValue: 'velocity-simulator', mucOnly: true },
      { field: 'xmppRoomPassword', defaultValue: '', mucOnly: true },
      { field: 'xmppConnectTimeoutMs', defaultValue: 30000 },
      { field: 'xmppReplyTimeoutMs', defaultValue: 15000 },
      { field: 'xmppPingIntervalMs', defaultValue: 60000, clientOnly: true },
      { field: 'xmppReconnectDelayMs', defaultValue: 60000, clientOnly: true },
    ]),
  });

  /**
   * Splits a connection type into its protocol and mode halves.
   *
   * @param {string} connectionType for example `http-server`
   * @returns {{protocol: string, mode: string}}
   */
  function splitConnectionType(connectionType) {
    const value = String(connectionType || '').toLowerCase();
    const [protocol, mode] = value.split('-');
    return {
      protocol: PROTOCOL_LABELS[protocol] ? protocol : 'tcp',
      mode: mode === 'client' ? 'client' : 'server',
    };
  }

  /**
   * Describes a secret without revealing it.
   *
   * @param {*} value the raw field value
   * @param {{optional?: boolean}} [options] when `optional` is true an empty
   *   value means the secret is simply unused rather than deliberately empty
   * @returns {string} one of `Set (hidden)`, `Empty`, or `Not set`
   */
  function describeSecret(value, options = {}) {
    if (value === undefined || value === null) return SECRET_UNSET;
    const text = String(value);
    if (text.length > 0) return SECRET_SET;
    return options.optional ? SECRET_UNSET : SECRET_EMPTY;
  }

  /** @returns {string} the value, or `Not set` when it is blank */
  function describeValue(value, fallback = NOT_SET) {
    if (value === undefined || value === null) return fallback;
    const text = String(value).trim();
    return text.length ? text : fallback;
  }

  /** @returns {string} `On` or `Off` */
  function describeToggle(value) {
    return value === true || value === 'true' ? 'On' : 'Off';
  }

  function isTruthy(value) {
    return value === true || value === 'true';
  }

  /** Wraps a bare IPv6 literal so it can be used inside a URL authority. */
  function formatHostForUrl(host) {
    const text = String(host || '').trim();
    if (!text) return '';
    if (text.includes(':') && !text.startsWith('[')) return `[${text}]`;
    return text;
  }

  /** @returns {string} `host:port`, using `Not set` for missing parts */
  function formatEndpoint(host, port) {
    const hostText = formatHostForUrl(host) || NOT_SET;
    const portText = describeValue(port);
    return `${hostText}:${portText}`;
  }

  /** Normalizes a URL path so a composed URL always has exactly one slash. */
  function normalizePath(path) {
    const text = String(path === undefined || path === null ? '' : path).trim();
    if (!text) return '/';
    return text.startsWith('/') ? text : `/${text}`;
  }

  /**
   * Composes the endpoint URL for a connection.
   *
   * @param {object} state normalized connection state
   * @returns {string} an absolute URL for HTTP and WebSocket, `host:port`
   *   otherwise
   */
  function buildConnectionUrl(state) {
    const { protocol } = splitConnectionType(state.connectionType);
    const host = formatHostForUrl(state.host) || NOT_SET;
    const port = describeValue(state.port);
    if (protocol === 'http') {
      return `${isTruthy(state.httpTls) ? 'https' : 'http'}://${host}:${port}${normalizePath(state.httpPath)}`;
    }
    if (protocol === 'ws') {
      return `${isTruthy(state.wsTls) ? 'wss' : 'ws'}://${host}:${port}${normalizePath(state.wsPath)}`;
    }
    return `${host}:${port}`;
  }

  /** @returns {boolean} whether TLS or STARTTLS applies to this connection */
  function isTlsCapable(protocol) {
    return protocol !== 'tcp' && protocol !== 'udp';
  }

  /** @returns {boolean} whether encryption is turned on for this connection */
  function isEncryptionEnabled(state, protocol) {
    if (!isTlsCapable(protocol)) return false;
    if (protocol === 'xmpp') return String(state.xmppTlsPolicy || 'required') !== 'disabled';
    if (protocol === 'grpc') return state.grpcTls === undefined ? true : isTruthy(state.grpcTls);
    if (protocol === 'http') return state.httpTls === undefined ? true : isTruthy(state.httpTls);
    return state.wsTls === undefined ? true : isTruthy(state.wsTls);
  }

  /** @returns {boolean} whether the explicit verification bypass is on */
  function isVerificationBypassed(state, protocol) {
    if (!isTlsCapable(protocol)) return false;
    return isTruthy(state[`${protocol}AllowUnverifiedTls`]);
  }

  /**
   * Counts the protocol settings that differ from their defaults.
   *
   * @param {object} state connection state
   * @param {number} [warningCount] warnings the summary raised, so the label
   *   can surface them next to the count instead of replacing it
   * @returns {{protocol: string, protocolLabel: string, count: number,
   *   total: number, hasSettings: boolean, changedLabel: string,
   *   warningCount: number, label: string}}
   */
  function countConfiguredProtocolSettings(state = {}, warningCount = 0) {
    const { protocol, mode } = splitConnectionType(state.connectionType);
    const fields = PROTOCOL_SETTING_FIELDS[protocol] || [];
    const isMuc = String(state.xmppConversation || 'direct') === 'muc';
    const applicable = fields.filter((entry) => {
      if (entry.clientOnly && mode !== 'client') return false;
      if (entry.serverOnly && mode !== 'server') return false;
      if (entry.mucOnly && !isMuc) return false;
      if (entry.directOnly && isMuc) return false;
      return true;
    });
    const count = applicable.filter((entry) => {
      const value = state[entry.field];
      // A value that was never provided is the default, not a change.
      if (value === undefined || value === null) return false;
      if (typeof entry.defaultValue === 'boolean') return isTruthy(value) !== entry.defaultValue;
      if (typeof entry.defaultValue === 'number') {
        const numeric = Number(value === '' ? entry.defaultValue : value);
        return Number.isFinite(numeric) ? numeric !== entry.defaultValue : true;
      }
      return String(value) !== String(entry.defaultValue);
    }).length;
    const warnings = Number.isFinite(warningCount) ? Math.max(0, warningCount) : 0;
    const changedLabel = applicable.length === 0
      ? 'no protocol settings'
      : count === 0 ? 'defaults' : count === 1 ? '1 changed' : `${count} changed`;
    // Warnings are appended, never substituted, so a bypass never hides the
    // fact that other settings were changed too.
    const warningLabel = warnings === 0 ? '' : warnings === 1 ? '1 warning' : `${warnings} warnings`;
    const shortLabel = applicable.length === 0 || count === 0 ? '' : String(count);
    return {
      protocol,
      protocolLabel: PROTOCOL_LABELS[protocol],
      count,
      total: applicable.length,
      hasSettings: applicable.length > 0,
      changedLabel,
      warningCount: warnings,
      shortLabel,
      label: [`${PROTOCOL_LABELS[protocol]} · ${changedLabel}`, warningLabel].filter(Boolean).join(' · '),
    };
  }

  /**
   * Condenses every warning into the single line shown beneath the compact
   * connection toolbar.
   */
  function formatConnectionWarningLine(summary) {
    const warnings = summary && Array.isArray(summary.warnings) ? summary.warnings : [];
    if (warnings.length === 0) return null;
    if (warnings.length === 1) {
      const [only] = warnings;
      return { count: 1, label: only.label, value: only.value, text: `${only.label}: ${only.value}` };
    }
    const label = `${warnings.length} warnings`;
    const [first] = warnings;
    const value = `${first.label}: ${first.value}`;
    return { count: warnings.length, label, value, text: `${label}: ${value}` };
  }

  function row(key, label, value, options = {}) {
    return {
      key,
      label,
      value,
      group: ROW_GROUPS.includes(options.group) ? options.group : 'Protocol',
      kind: ROW_KINDS.includes(options.kind) ? options.kind : 'setting',
      severity: options.severity || 'info',
      secret: options.secret === true,
      isDefault: options.isDefault === undefined ? true : Boolean(options.isDefault),
      detail: options.detail || '',
    };
  }

  function warningRow(key, label, value, detail) {
    return row(key, label, value, {
      group: 'Security', kind: 'warning', severity: 'warning', isDefault: false, detail,
    });
  }

  /**
   * Builds the warning rows, most severe first. An explicit certificate
   * verification bypass always leads, because it silently applies to every
   * host rather than only to loopback.
   */
  function buildWarnings(state, protocol, mode) {
    const warnings = [];
    const isClient = mode === 'client';
    const unverified = isVerificationBypassed(state, protocol);
    const tlsOn = isEncryptionEnabled(state, protocol);

    if (isClient && unverified && tlsOn) {
      warnings.push(warningRow(
        'unverifiedCertificate',
        'Certificate verification',
        'Off for every host — traffic stays encrypted, but the server identity is not checked.',
        'Certificate verification is disabled for every host, not only localhost. Use it only for local self-signed testing.',
      ));
    }
    if (protocol === 'xmpp' && String(state.xmppTlsPolicy || 'required') === 'preferred') {
      warnings.push(warningRow(
        'opportunisticTls',
        'STARTTLS',
        'Preferred — the connection may continue unsecure when STARTTLS is unavailable.',
        'Credentials and data may cross the network without encryption.',
      ));
    }
    if (!tlsOn && isTlsCapable(protocol)) {
      warnings.push(warningRow(
        'unsecureTransport',
        'Encryption',
        `Off — ${PROTOCOL_LABELS[protocol]} data is carried in plaintext.`,
        'Data crosses the network without encryption.',
      ));
    }
    // A server with neither a certificate nor a key uses the automatic
    // self-signed pair, which is a supported local-testing configuration. Only
    // a half-configured pair is a problem.
    if (mode === 'server' && tlsOn) {
      const certPath = describeValue(state[`${protocol}TlsCertPath`], '');
      const keyPath = describeValue(state[`${protocol}TlsKeyPath`], '');
      if (Boolean(certPath) !== Boolean(keyPath)) {
        warnings.push(warningRow(
          'serverCertificateIncomplete',
          'Server certificate',
          'Incomplete — a certificate and its private key must be provided together.',
          'Provide both the certificate and its private key, or leave both empty to use the automatic self-signed certificate.',
        ));
      }
    }
    if (protocol === 'xmpp' && mode === 'server' && isTruthy(state.xmppAllowRemote)) {
      warnings.push(warningRow(
        'remoteBind',
        'Remote binding',
        'Allowed — the XMPP service may bind outside loopback.',
        'Any host that can reach this machine may sign in with the external account.',
      ));
    }
    return warnings;
  }

  function buildTlsRows(state, protocol, mode) {
    const rows = [];
    const isClient = mode === 'client';
    if (!isTlsCapable(protocol)) {
      rows.push(row('tls', 'Encryption', `Not available for ${PROTOCOL_LABELS[protocol]}`, {
        group: 'Security', kind: 'security',
      }));
      return rows;
    }
    const tlsOn = isEncryptionEnabled(state, protocol);
    if (protocol === 'xmpp') {
      const policy = String(state.xmppTlsPolicy || 'required');
      rows.push(row('tls', 'TLS policy', XMPP_TLS_POLICY_LABELS[policy] || XMPP_TLS_POLICY_LABELS.required, {
        group: 'Security',
        kind: 'security',
        severity: policy === 'required' ? 'info' : 'warning',
        isDefault: policy === 'required',
      }));
    } else {
      const secureName = protocol === 'http' ? 'HTTPS' : protocol === 'ws' ? 'WSS' : 'TLS';
      rows.push(row('tls', 'TLS', tlsOn ? `On (${secureName})` : 'Off (plaintext)', {
        group: 'Security',
        kind: 'security',
        severity: tlsOn ? 'info' : 'warning',
        isDefault: tlsOn,
      }));
    }

    const caPath = state[`${protocol}TlsCaPath`];
    const certPath = state[`${protocol}TlsCertPath`];
    const keyPath = state[`${protocol}TlsKeyPath`];
    const unverified = isVerificationBypassed(state, protocol);

    // The verification row is reported whenever encryption applies, so a
    // connection that does verify says so instead of staying silent.
    if (tlsOn) {
      rows.push(row(
        'certificateVerification',
        'Certificate verification',
        isClient
          ? (unverified ? 'Off — any certificate accepted' : (describeValue(caPath, '') ? 'On (custom CA)' : 'On (operating system trust store)'))
          : 'Not performed — this server does not verify client certificates',
        {
          group: 'Security',
          kind: 'security',
          severity: isClient && unverified ? 'warning' : 'info',
          isDefault: !(isClient && unverified),
        },
      ));
    }
    rows.push(row('certificateAuthority', 'CA certificate', describeValue(caPath, isClient ? 'Operating system trust store' : NOT_SET), {
      group: 'Security', kind: 'security', isDefault: !describeValue(caPath, ''),
    }));
    if (mode === 'server') {
      // Both empty is the supported automatic self-signed pair.
      const hasCert = Boolean(describeValue(certPath, ''));
      const hasKey = Boolean(describeValue(keyPath, ''));
      rows.push(row('certificate', 'Server certificate', hasCert ? describeValue(certPath) : 'Automatic self-signed certificate', {
        group: 'Security', kind: 'security', isDefault: !hasCert,
      }));
      rows.push(row('certificateKey', 'Private key', hasKey ? describeValue(keyPath) : 'Automatic self-signed key', {
        group: 'Security', kind: 'security', isDefault: !hasKey,
      }));
    } else {
      rows.push(row('certificate', 'Certificate', describeValue(certPath), {
        group: 'Security', kind: 'security', isDefault: !describeValue(certPath, ''),
      }));
      rows.push(row('certificateKey', 'Private key', describeValue(keyPath), {
        group: 'Security', kind: 'security', isDefault: !describeValue(keyPath, ''),
      }));
    }
    return rows;
  }

  function buildProtocolRows(state, protocol, mode) {
    const rows = [];
    if (protocol === 'grpc') {
      rows.push(row('grpcSerialization', 'Serialization', GRPC_SERIALIZATION_LABELS[state.grpcSerialization] || GRPC_SERIALIZATION_LABELS.protobuf, {
        isDefault: (state.grpcSerialization || 'protobuf') === 'protobuf',
      }));
      rows.push(row('grpcRpcType', 'RPC type', GRPC_RPC_LABELS[state.grpcSendMethod] || GRPC_RPC_LABELS.stream, {
        isDefault: (state.grpcSendMethod || 'stream') === 'stream',
      }));
      if (mode === 'client') {
        const key = describeValue(state.grpcHeaderPathKey, 'grpc-path');
        const path = describeValue(state.grpcHeaderPath, 'replace.with.dedicated.uid');
        rows.push(row('grpcEndpointHeader', 'Endpoint header', `${key}=${path}`, {
          isDefault: key === 'grpc-path' && path === 'replace.with.dedicated.uid',
        }));
      }
      return rows;
    }
    if (protocol === 'http' || protocol === 'ws') {
      const formatValue = protocol === 'http' ? state.httpFormat : state.wsFormat;
      const pathValue = normalizePath(protocol === 'http' ? state.httpPath : state.wsPath);
      rows.push(row('format', 'Format', FORMAT_LABELS[formatValue] || FORMAT_LABELS.delimited, {
        isDefault: (formatValue || 'delimited') === 'delimited',
      }));
      rows.push(row('path', 'Path', pathValue, { isDefault: pathValue === '/' }));
      if (protocol === 'ws') {
        // The subscription message and the upgrade headers are documented
        // carriers of tokens and Authorization values, so only their presence
        // is reported.
        rows.push(row('wsSubscriptionMessage', 'Subscription message', describeSecret(state.wsSubscriptionMsg, { optional: true }), {
          kind: 'secret', secret: true, isDefault: !describeValue(state.wsSubscriptionMsg, ''),
        }));
        rows.push(row('wsSkipFirstMessage', 'Skip first message', describeToggle(state.wsIgnoreFirstMsg), {
          isDefault: !isTruthy(state.wsIgnoreFirstMsg),
        }));
        rows.push(row('wsHeaders', 'Upgrade headers', describeSecret(state.wsHeaders, { optional: true }), {
          kind: 'secret', secret: true, isDefault: !describeValue(state.wsHeaders, ''),
        }));
      }
      return rows;
    }
    if (protocol === 'xmpp') {
      const isMuc = String(state.xmppConversation || 'direct') === 'muc';
      rows.push(row('xmppDomain', 'Domain', describeValue(state.xmppDomain), {
        isDefault: describeValue(state.xmppDomain, 'localhost') === 'localhost',
      }));
      rows.push(row('xmppConversation', 'Conversation', XMPP_CONVERSATION_LABELS[isMuc ? 'muc' : 'direct'], {
        isDefault: !isMuc,
      }));
      if (mode === 'client') {
        rows.push(row('xmppAccount', 'Username', describeValue(state.xmppUsername), {
          isDefault: !describeValue(state.xmppUsername, ''),
        }));
        rows.push(row('xmppPassword', 'Password', describeSecret(state.xmppPassword), {
          kind: 'secret', secret: true, isDefault: !describeValue(state.xmppPassword, ''),
        }));
        rows.push(row('xmppResource', 'Resource', describeValue(state.xmppResource), {
          isDefault: describeValue(state.xmppResource, 'velocity-simulator') === 'velocity-simulator',
        }));
      } else {
        rows.push(row('xmppExternalAccount', 'External user', describeValue(state.xmppExternalUsername), {
          isDefault: !describeValue(state.xmppExternalUsername, ''),
        }));
        rows.push(row('xmppExternalPassword', 'External password', describeSecret(state.xmppExternalPassword), {
          kind: 'secret', secret: true, isDefault: !describeValue(state.xmppExternalPassword, ''),
        }));
        rows.push(row('xmppAllowRemote', 'Allow remote', describeToggle(state.xmppAllowRemote), {
          group: 'Security',
          kind: 'security',
          severity: isTruthy(state.xmppAllowRemote) ? 'warning' : 'info',
          isDefault: !isTruthy(state.xmppAllowRemote),
        }));
      }
      if (isMuc) {
        rows.push(row('xmppRoom', 'Room', describeValue(state.xmppRoom), {
          isDefault: !describeValue(state.xmppRoom, ''),
        }));
        rows.push(row('xmppNickname', 'Nickname', describeValue(state.xmppNickname), {
          isDefault: describeValue(state.xmppNickname, 'velocity-simulator') === 'velocity-simulator',
        }));
        rows.push(row('xmppRoomPassword', 'Room password', describeSecret(state.xmppRoomPassword, { optional: true }), {
          kind: 'secret', secret: true, isDefault: !describeValue(state.xmppRoomPassword, ''),
        }));
      } else {
        // Role-specific row: the Simulator publishes, so it names the bare
        // JIDs each replayed line is delivered to.
        rows.push(row('xmppDestination', 'Destination', describeValue(
          state.xmppDestination,
          mode === 'server' ? 'Every signed-in account' : NOT_SET,
        ), { isDefault: !describeValue(state.xmppDestination, '') }));
      }
      const timing = [
        `connect ${describeValue(state.xmppConnectTimeoutMs, '30000')} ms`,
        `reply ${describeValue(state.xmppReplyTimeoutMs, '15000')} ms`,
        ...(mode === 'client'
          ? [`ping ${describeValue(state.xmppPingIntervalMs, '60000')} ms`, `reconnect ${describeValue(state.xmppReconnectDelayMs, '60000')} ms`]
          : []),
      ];
      rows.push(row('xmppTiming', 'Timing', timing.join(', '), {
        isDefault: describeValue(state.xmppConnectTimeoutMs, '30000') === '30000'
          && describeValue(state.xmppReplyTimeoutMs, '15000') === '15000'
          && (mode !== 'client' || (describeValue(state.xmppPingIntervalMs, '60000') === '60000'
            && describeValue(state.xmppReconnectDelayMs, '60000') === '60000')),
      }));
      return rows;
    }
    return rows;
  }

  /**
   * Describes what the Simulator does with this connection, in send terms.
   *
   * @returns {string} for example `Listening on 127.0.0.1:5565`
   */
  function describeConnectionRole(state, protocol, mode) {
    const target = buildConnectionUrl(state);
    if (mode === 'server') return `Listening on ${target}`;
    return `Publishing to ${target}`;
  }

  /**
   * Builds the complete connection summary.
   *
   * @param {object} [state] connection field values keyed by the shared option
   *   vocabulary, for example `connectionType`, `host`, `port`, `httpFormat`
   * @returns {object} the summary consumed by every read-only surface
   */
  function buildConnectionSummary(state = {}) {
    const connectionType = CONNECTION_TYPE_LABELS[state.connectionType] ? state.connectionType : 'tcp-server';
    const normalized = { ...state, connectionType };
    const { protocol, mode } = splitConnectionType(connectionType);
    const connectionState = CONNECTION_STATE_LABELS[state.connectionState] ? state.connectionState : 'disconnected';
    const preset = normalizePreset(state.preset);
    const url = buildConnectionUrl(normalized);

    const warnings = buildWarnings(normalized, protocol, mode);
    const rows = [
      ...warnings,
      row('connection', 'Connection', CONNECTION_TYPE_LABELS[connectionType], { group: 'Connection', kind: 'state' }),
      row('endpoint', mode === 'server' ? 'Listening on' : 'Publishing to', url, { group: 'Connection', kind: 'endpoint' }),
      row('status', 'Status', CONNECTION_STATE_LABELS[connectionState], { group: 'Session', kind: 'state' }),
      row('preset', 'Preset', preset.label, { group: 'Session', kind: 'preset', isDefault: !preset.modified }),
      ...buildTlsRows(normalized, protocol, mode),
      ...buildProtocolRows(normalized, protocol, mode),
    ];
    const settings = countConfiguredProtocolSettings(normalized, warnings.length);

    return {
      connectionType,
      connectionTypeLabel: CONNECTION_TYPE_LABELS[connectionType],
      protocol,
      protocolLabel: PROTOCOL_LABELS[protocol],
      mode,
      modeLabel: MODE_LABELS[mode],
      title: `${CONNECTION_TYPE_LABELS[connectionType]} settings`,
      headline: describeConnectionRole(normalized, protocol, mode),
      url,
      encrypted: isEncryptionEnabled(normalized, protocol),
      supportsProtocolSettings: DIALOG_PROTOCOLS.includes(protocol),
      connectionState,
      connectionStateLabel: CONNECTION_STATE_LABELS[connectionState],
      preset,
      warnings,
      warningCount: warnings.length,
      rows,
      primaryRows: rows.slice(0, 3),
      settings,
      changedCount: settings.count,
    };
  }

  function normalizePreset(preset) {
    const value = preset || {};
    if (value.modified && value.baseLabel) {
      return { id: 'custom', label: `Custom (modified from ${value.baseLabel})`, modified: true, baseLabel: value.baseLabel };
    }
    if (value.label) return { id: value.id || 'custom', label: value.label, modified: Boolean(value.modified), baseLabel: value.baseLabel || '' };
    return { id: 'custom', label: 'Custom', modified: false, baseLabel: '' };
  }

  /**
   * Renders a summary as plain text for the clipboard. Secrets stay redacted.
   *
   * @param {object} summary the value returned by {@link buildConnectionSummary}
   * @returns {string}
   */
  function formatConnectionSummaryText(summary) {
    if (!summary || !Array.isArray(summary.rows)) return '';
    const lines = [
      'ArcGIS Velocity Simulator — connection summary',
      `${summary.connectionTypeLabel} · ${summary.connectionStateLabel}`,
      '',
      ...summary.rows.map((entry) => `${entry.kind === 'warning' ? '! ' : ''}${entry.label}: ${entry.value}`),
    ];
    return lines.join('\n');
  }

  /**
   * Concise configured state for the Protocol Settings button: how many
   * settings differ from their documented defaults, with any warnings appended
   * rather than substituted.
   *
   * @param {object} summary the value returned by {@link buildConnectionSummary}
   * @returns {string}
   */
  function describeConfiguredState(summary) {
    if (!summary || !summary.settings) return '';
    const warnings = summary.warningCount === 0 ? ''
      : summary.warningCount === 1 ? '1 warning' : `${summary.warningCount} warnings`;
    return [summary.settings.changedLabel, warnings].filter(Boolean).join(' · ');
  }

  return {
    SECRET_SET,
    SECRET_EMPTY,
    SECRET_UNSET,
    ROW_GROUPS,
    ROW_KINDS,
    CONNECTION_TYPES,
    CONNECTION_TYPE_LABELS,
    PROTOCOL_LABELS,
    MODE_LABELS,
    DIALOG_PROTOCOLS,
    PROTOCOL_SETTING_FIELDS,
    splitConnectionType,
    describeSecret,
    describeValue,
    describeToggle,
    normalizePath,
    formatEndpoint,
    buildConnectionUrl,
    countConfiguredProtocolSettings,
    formatConnectionWarningLine,
    buildConnectionSummary,
    formatConnectionSummaryText,
    describeConfiguredState,
  };
}));
