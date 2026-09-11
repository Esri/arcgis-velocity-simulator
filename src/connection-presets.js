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
 * @file connection-presets.js
 * @description
 * Shared, testable definitions for the local Simulator/Logger connection
 * presets exposed by the Preset dropdown above Mode.
 *
 * A preset is a named bundle of connection field values. Selecting one only
 * pre-fills editable controls: it never connects, never starts playback, never
 * selects a file, never stores a secret, and never changes the application
 * startup defaults.
 *
 * The preset identifiers and labels are a cross-application contract shared
 * with the ArcGIS Velocity Logger. The same twelve ids and labels exist in both
 * apps with the roles inverted, so a tester can pick the matching pair by name.
 * In this repository (the Simulator):
 *
 *   - "Logger Server / Simulator Client" selects the Simulator `*-client`
 *     connection type; the Logger listens and the Simulator connects to it.
 *   - "Simulator Server / Logger Client" selects the Simulator `*-server`
 *     connection type; the Logger connects to it as a client.
 *
 * Every preset writes the full field set returned by
 * {@link buildConnectionPresetValues} so unrelated optional fields are reset to
 * their documented defaults and preset behavior stays deterministic.
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ConnectionPresets = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /** Identifier of the "no preset" entry. Selecting it preserves current values. */
  const CUSTOM_PRESET_ID = 'custom';

  /** Label of the "no preset" entry. */
  const CUSTOM_PRESET_LABEL = 'Custom';

  /** Loopback host shared by every local preset. */
  const CONNECTION_PRESET_HOST = '127.0.0.1';

  /** Default ports used by the local presets, by protocol. */
  const CONNECTION_PRESET_PORTS = Object.freeze({
    tcp: 5565,
    udp: 5565,
    grpc: 5565,
    http: 8080,
    ws: 8080,
    xmpp: 5222,
  });

  /**
   * Every field a preset controls, mapped to the control it fills.
   * `kind` is `value` for text/number/select controls and `checked` for
   * checkboxes.
   */
  const CONNECTION_PRESET_CONTROLS = Object.freeze({
    connectionType: { elementId: 'connection-type', kind: 'value' },
    host: { elementId: 'ip-address', kind: 'value' },
    port: { elementId: 'port', kind: 'value' },

    tcpFormat: { elementId: 'tcp-format', kind: 'value' },
    tcpInputHasHeader: { elementId: 'tcp-input-has-header', kind: 'checked' },
    tcpXField: { elementId: 'tcp-x-field', kind: 'value' },
    tcpYField: { elementId: 'tcp-y-field', kind: 'value' },
    tcpWkid: { elementId: 'tcp-wkid', kind: 'value' },

    udpFormat: { elementId: 'udp-format', kind: 'value' },
    udpInputHasHeader: { elementId: 'udp-input-has-header', kind: 'checked' },
    udpXField: { elementId: 'udp-x-field', kind: 'value' },
    udpYField: { elementId: 'udp-y-field', kind: 'value' },
    udpWkid: { elementId: 'udp-wkid', kind: 'value' },

    grpcSerialization: { elementId: 'grpc-serialization', kind: 'value' },
    grpcSendMethod: { elementId: 'grpc-send-method', kind: 'value' },
    grpcHeaderPathKey: { elementId: 'grpc-header-path-key', kind: 'value' },
    grpcHeaderPath: { elementId: 'grpc-header-path', kind: 'value' },
    grpcTls: { elementId: 'grpc-tls', kind: 'checked' },
    grpcTlsCaPath: { elementId: 'grpc-tls-ca-path', kind: 'value' },
    grpcTlsCertPath: { elementId: 'grpc-tls-cert-path', kind: 'value' },
    grpcTlsKeyPath: { elementId: 'grpc-tls-key-path', kind: 'value' },
    grpcAllowUnverifiedTls: { elementId: 'grpc-allow-unverified', kind: 'checked' },

    httpFormat: { elementId: 'http-format', kind: 'value' },
    httpPolling: { elementId: 'http-polling', kind: 'checked' },
    httpTls: { elementId: 'http-tls', kind: 'checked' },
    httpPath: { elementId: 'http-path', kind: 'value' },
    httpTlsCaPath: { elementId: 'http-tls-ca-path', kind: 'value' },
    httpTlsCertPath: { elementId: 'http-tls-cert-path', kind: 'value' },
    httpTlsKeyPath: { elementId: 'http-tls-key-path', kind: 'value' },
    httpAllowUnverifiedTls: { elementId: 'http-allow-unverified', kind: 'checked' },

    wsFormat: { elementId: 'ws-format', kind: 'value' },
    wsTls: { elementId: 'ws-tls', kind: 'checked' },
    wsPath: { elementId: 'ws-path', kind: 'value' },
    wsTlsCaPath: { elementId: 'ws-tls-ca-path', kind: 'value' },
    wsTlsCertPath: { elementId: 'ws-tls-cert-path', kind: 'value' },
    wsTlsKeyPath: { elementId: 'ws-tls-key-path', kind: 'value' },
    wsSubscriptionMsg: { elementId: 'ws-subscription-msg', kind: 'value' },
    wsIgnoreFirstMsg: { elementId: 'ws-ignore-first-msg', kind: 'checked' },
    wsHeaders: { elementId: 'ws-headers', kind: 'value' },
    wsAllowUnverifiedTls: { elementId: 'ws-allow-unverified', kind: 'checked' },

    xmppDomain: { elementId: 'xmpp-domain', kind: 'value' },
    xmppTlsPolicy: { elementId: 'xmpp-tls-policy', kind: 'value' },
    xmppConversation: { elementId: 'xmpp-conversation', kind: 'value' },
    xmppUsername: { elementId: 'xmpp-username', kind: 'value' },
    xmppPassword: { elementId: 'xmpp-password', kind: 'value' },
    xmppResource: { elementId: 'xmpp-resource', kind: 'value' },
    xmppDestination: { elementId: 'xmpp-destination', kind: 'value' },
    xmppExternalUsername: { elementId: 'xmpp-external-username', kind: 'value' },
    xmppExternalPassword: { elementId: 'xmpp-external-password', kind: 'value' },
    xmppRoom: { elementId: 'xmpp-room', kind: 'value' },
    xmppNickname: { elementId: 'xmpp-nickname', kind: 'value' },
    xmppRoomPassword: { elementId: 'xmpp-room-password', kind: 'value' },
    xmppTlsCaPath: { elementId: 'xmpp-tls-ca-path', kind: 'value' },
    xmppTlsCertPath: { elementId: 'xmpp-tls-cert-path', kind: 'value' },
    xmppTlsKeyPath: { elementId: 'xmpp-tls-key-path', kind: 'value' },
    xmppAllowUnverifiedTls: { elementId: 'xmpp-allow-unverified', kind: 'checked' },
    xmppAllowRemote: { elementId: 'xmpp-allow-remote', kind: 'checked' },
    xmppConnectTimeoutMs: { elementId: 'xmpp-connect-timeout', kind: 'value' },
    xmppReplyTimeoutMs: { elementId: 'xmpp-reply-timeout', kind: 'value' },
    xmppPingIntervalMs: { elementId: 'xmpp-ping-interval', kind: 'value' },
    xmppReconnectDelayMs: { elementId: 'xmpp-reconnect-delay', kind: 'value' },
  });

  /**
   * Documented default for every preset-controlled field. Applying a preset
   * resets each field the preset does not name, so two consecutive preset
   * selections never leave stale values behind.
   */
  const CONNECTION_PRESET_FIELD_DEFAULTS = Object.freeze({
    connectionType: 'tcp-server',
    host: CONNECTION_PRESET_HOST,
    port: 5565,

    tcpFormat: 'delimited',
    tcpInputHasHeader: false,
    tcpXField: '',
    tcpYField: '',
    tcpWkid: 4326,

    udpFormat: 'delimited',
    udpInputHasHeader: false,
    udpXField: '',
    udpYField: '',
    udpWkid: 4326,

    grpcSerialization: 'protobuf',
    grpcSendMethod: 'stream',
    grpcHeaderPathKey: 'grpc-path',
    grpcHeaderPath: 'replace.with.dedicated.uid',
    grpcTls: true,
    grpcTlsCaPath: '',
    grpcTlsCertPath: '',
    grpcTlsKeyPath: '',
    grpcAllowUnverifiedTls: false,

    httpFormat: 'delimited',
    httpPolling: false,
    httpTls: true,
    httpPath: '/',
    httpTlsCaPath: '',
    httpTlsCertPath: '',
    httpTlsKeyPath: '',
    httpAllowUnverifiedTls: false,

    wsFormat: 'delimited',
    wsTls: true,
    wsPath: '/',
    wsTlsCaPath: '',
    wsTlsCertPath: '',
    wsTlsKeyPath: '',
    wsSubscriptionMsg: '',
    wsIgnoreFirstMsg: false,
    wsHeaders: '',
    wsAllowUnverifiedTls: false,

    xmppDomain: 'localhost',
    xmppTlsPolicy: 'required',
    xmppConversation: 'direct',
    xmppUsername: '',
    xmppPassword: '',
    xmppResource: 'velocity-simulator',
    xmppDestination: '',
    xmppExternalUsername: '',
    xmppExternalPassword: '',
    xmppRoom: '',
    xmppNickname: 'velocity-simulator',
    xmppRoomPassword: '',
    xmppTlsCaPath: '',
    xmppTlsCertPath: '',
    xmppTlsKeyPath: '',
    xmppAllowUnverifiedTls: false,
    xmppAllowRemote: false,
    xmppConnectTimeoutMs: 30000,
    xmppReplyTimeoutMs: 15000,
    xmppPingIntervalMs: 60000,
    xmppReconnectDelayMs: 60000,
  });

  /** Local XMPP account names shared by the paired XMPP presets. */
  const XMPP_PRESET_DOMAIN = 'localhost';
  const XMPP_PRESET_SIMULATOR_USERNAME = 'simulator';
  const XMPP_PRESET_LOGGER_USERNAME = 'velocity-logger';
  const XMPP_PRESET_LOGGER_JID = `${XMPP_PRESET_LOGGER_USERNAME}@${XMPP_PRESET_DOMAIN}`;

  /**
   * The twelve paired presets. `id` and `label` are the cross-application
   * contract; `fields` holds only the values this preset sets explicitly.
   */
  const CONNECTION_PRESET_DEFINITIONS = Object.freeze([
    {
      id: 'local-tcp-logger-server',
      label: 'Local TCP — Logger Server / Simulator Client',
      group: 'Local TCP',
      protocol: 'tcp',
      role: 'logger-server',
      summary: 'The Logger listens on TCP 127.0.0.1:5565 and the Simulator connects to it as a TCP client.',
      fields: {
        connectionType: 'tcp-client',
        port: CONNECTION_PRESET_PORTS.tcp,
      },
    },
    {
      id: 'local-tcp-simulator-server',
      label: 'Local TCP — Simulator Server / Logger Client',
      group: 'Local TCP',
      protocol: 'tcp',
      role: 'simulator-server',
      summary: 'The Simulator listens on TCP 127.0.0.1:5565 and the Logger connects to it as a TCP client.',
      fields: {
        connectionType: 'tcp-server',
        port: CONNECTION_PRESET_PORTS.tcp,
      },
    },
    {
      id: 'local-udp-logger-server',
      label: 'Local UDP — Logger Server / Simulator Client',
      group: 'Local UDP',
      protocol: 'udp',
      role: 'logger-server',
      summary: 'The Logger binds UDP 127.0.0.1:5565 and the Simulator sends datagrams to it.',
      fields: {
        connectionType: 'udp-client',
        port: CONNECTION_PRESET_PORTS.udp,
      },
    },
    {
      id: 'local-udp-simulator-server',
      label: 'Local UDP — Simulator Server / Logger Client',
      group: 'Local UDP',
      protocol: 'udp',
      role: 'simulator-server',
      summary: 'The Simulator binds UDP 127.0.0.1:5565 and the Logger receives datagrams as a UDP client.',
      fields: {
        connectionType: 'udp-server',
        port: CONNECTION_PRESET_PORTS.udp,
      },
    },
    {
      id: 'local-grpc-logger-server',
      label: 'Local gRPC — Logger Server / Simulator Client',
      group: 'Local gRPC',
      protocol: 'grpc',
      role: 'logger-server',
      summary: 'The Logger hosts a gRPC server on 127.0.0.1:5565 and the Simulator connects with Text serialization, client streaming, and TLS off.',
      fields: {
        connectionType: 'grpc-client',
        port: CONNECTION_PRESET_PORTS.grpc,
        grpcSerialization: 'text',
        grpcSendMethod: 'stream',
        grpcTls: false,
      },
    },
    {
      id: 'local-grpc-simulator-server',
      label: 'Local gRPC — Simulator Server / Logger Client',
      group: 'Local gRPC',
      protocol: 'grpc',
      role: 'simulator-server',
      summary: 'The Simulator hosts a gRPC server on 127.0.0.1:5565 with Text serialization, client streaming, and TLS off.',
      fields: {
        connectionType: 'grpc-server',
        port: CONNECTION_PRESET_PORTS.grpc,
        grpcSerialization: 'text',
        grpcSendMethod: 'stream',
        grpcTls: false,
      },
    },
    {
      id: 'local-http-logger-server',
      label: 'Local HTTP — Logger Server / Simulator Client',
      group: 'Local HTTP',
      protocol: 'http',
      role: 'logger-server',
      summary: 'The Logger hosts an HTTP server on 127.0.0.1:8080 and the Simulator posts to path / with Delimited (CSV) payloads and TLS off.',
      fields: {
        connectionType: 'http-client',
        port: CONNECTION_PRESET_PORTS.http,
        httpFormat: 'delimited',
        httpPath: '/',
        httpTls: false,
      },
    },
    {
      id: 'local-http-simulator-server',
      label: 'Local HTTP — Simulator Server / Logger Client',
      group: 'Local HTTP',
      protocol: 'http',
      role: 'simulator-server',
      summary: 'The Simulator hosts an HTTP server on 127.0.0.1:8080 at path / with Delimited (CSV) payloads and TLS off.',
      fields: {
        connectionType: 'http-server',
        port: CONNECTION_PRESET_PORTS.http,
        httpFormat: 'delimited',
        httpPath: '/',
        httpTls: false,
      },
    },
    {
      id: 'local-ws-logger-server',
      label: 'Local WebSocket — Logger Server / Simulator Client',
      group: 'Local WebSocket',
      protocol: 'ws',
      role: 'logger-server',
      summary: 'The Logger hosts a WebSocket server and the Simulator connects to ws://127.0.0.1:8080/ with Delimited (CSV) frames, no subscription message, and the first message kept.',
      fields: {
        connectionType: 'ws-client',
        port: CONNECTION_PRESET_PORTS.ws,
        wsFormat: 'delimited',
        wsPath: '/',
        wsTls: false,
        wsSubscriptionMsg: '',
        wsIgnoreFirstMsg: false,
      },
    },
    {
      id: 'local-ws-simulator-server',
      label: 'Local WebSocket — Simulator Server / Logger Client',
      group: 'Local WebSocket',
      protocol: 'ws',
      role: 'simulator-server',
      summary: 'The Simulator hosts a WebSocket server on ws://127.0.0.1:8080/ with Delimited (CSV) frames, no subscription message, and the first message kept.',
      fields: {
        connectionType: 'ws-server',
        port: CONNECTION_PRESET_PORTS.ws,
        wsFormat: 'delimited',
        wsPath: '/',
        wsTls: false,
        wsSubscriptionMsg: '',
        wsIgnoreFirstMsg: false,
      },
    },
    {
      id: 'local-xmpp-logger-server',
      label: 'Local XMPP — Logger Server / Simulator Client',
      group: 'Local XMPP',
      protocol: 'xmpp',
      role: 'logger-server',
      summary: 'The Logger hosts the XMPP service and the Simulator signs in to 127.0.0.1:5222 as simulator on domain localhost with Direct conversation and Required STARTTLS, publishing to velocity-logger@localhost. The password is left intentionally empty and unverified TLS is allowed so the Logger self-signed certificate is accepted.',
      fields: {
        connectionType: 'xmpp-client',
        port: CONNECTION_PRESET_PORTS.xmpp,
        xmppDomain: XMPP_PRESET_DOMAIN,
        xmppConversation: 'direct',
        xmppTlsPolicy: 'required',
        xmppUsername: XMPP_PRESET_SIMULATOR_USERNAME,
        xmppPassword: '',
        xmppResource: 'velocity-simulator',
        xmppDestination: XMPP_PRESET_LOGGER_JID,
        xmppAllowUnverifiedTls: true,
      },
    },
    {
      id: 'local-xmpp-simulator-server',
      label: 'Local XMPP — Simulator Server / Logger Client',
      group: 'Local XMPP',
      protocol: 'xmpp',
      role: 'simulator-server',
      summary: 'The Simulator hosts the in-process XMPP service on 127.0.0.1:5222 for domain localhost with Direct conversation, Required STARTTLS, and one external account named velocity-logger. The external password is left intentionally empty for relaxed local testing, and each line is sent to every signed-in stream.',
      fields: {
        connectionType: 'xmpp-server',
        port: CONNECTION_PRESET_PORTS.xmpp,
        xmppDomain: XMPP_PRESET_DOMAIN,
        xmppConversation: 'direct',
        xmppTlsPolicy: 'required',
        xmppExternalUsername: XMPP_PRESET_LOGGER_USERNAME,
        xmppExternalPassword: '',
        xmppDestination: '',
        xmppAllowRemote: false,
      },
    },
  ]);

  const PRESETS_BY_ID = new Map(CONNECTION_PRESET_DEFINITIONS.map((preset) => [preset.id, preset]));

  /** @returns {Array<object>} every preset definition, in display order */
  function listConnectionPresets() {
    return CONNECTION_PRESET_DEFINITIONS.slice();
  }

  /**
   * Groups presets for `<optgroup>` rendering, preserving definition order.
   *
   * @returns {Array<{label: string, presets: Array<object>}>}
   */
  function listConnectionPresetGroups() {
    const groups = [];
    const byLabel = new Map();
    CONNECTION_PRESET_DEFINITIONS.forEach((preset) => {
      let group = byLabel.get(preset.group);
      if (!group) {
        group = { label: preset.group, presets: [] };
        byLabel.set(preset.group, group);
        groups.push(group);
      }
      group.presets.push(preset);
    });
    return groups;
  }

  /**
   * @param {string} id
   * @returns {object|null} the preset definition, or null when unknown/custom
   */
  function getConnectionPreset(id) {
    return PRESETS_BY_ID.get(String(id || '')) || null;
  }

  /**
   * Builds the complete field map a preset writes, including the defaults used
   * to reset fields the preset does not name.
   *
   * @param {string} id
   * @returns {object|null} field values keyed by preset field name, or null for
   *   an unknown id or the Custom entry
   */
  function buildConnectionPresetValues(id) {
    const preset = getConnectionPreset(id);
    if (!preset) return null;
    return {
      ...CONNECTION_PRESET_FIELD_DEFAULTS,
      host: CONNECTION_PRESET_HOST,
      ...preset.fields,
    };
  }

  /**
   * Human-readable tooltip for the Preset dropdown, kept in sync with the
   * selected entry and the modified state.
   *
   * @param {string} id
   * @param {{modified?: boolean, baseId?: string}} [state]
   * @returns {string}
   */
  function describeConnectionPreset(id, state = {}) {
    const intro = 'Preset: pre-fills the connection fields for a paired local Simulator and Logger test. It only fills editable fields — it never connects, starts playback, selects a file, or saves a secret.';
    const preset = getConnectionPreset(id);
    if (preset) {
      return `${preset.label}\n${preset.summary}\n${intro}`;
    }
    const base = getConnectionPreset(state.baseId);
    if (state.modified && base) {
      return `${CUSTOM_PRESET_LABEL} (modified)\nThese fields started from "${base.label}" and were edited. Select the preset again to restore its values.\n${intro}`;
    }
    return `${CUSTOM_PRESET_LABEL}\nKeeps the current connection fields exactly as they are. Choose a paired preset to pre-fill a local Simulator and Logger test.\n${intro}`;
  }

  return {
    CUSTOM_PRESET_ID,
    CUSTOM_PRESET_LABEL,
    CONNECTION_PRESET_HOST,
    CONNECTION_PRESET_PORTS,
    CONNECTION_PRESET_CONTROLS,
    CONNECTION_PRESET_FIELD_DEFAULTS,
    CONNECTION_PRESET_DEFINITIONS,
    listConnectionPresets,
    listConnectionPresetGroups,
    getConnectionPreset,
    buildConnectionPresetValues,
    describeConnectionPreset,
  };
}));
