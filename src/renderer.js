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
 * @file renderer.js
 * @description This script manages the user interface and all interactions within the renderer process of the Electron application.
 * It handles file loading, data sending over TCP/UDP, UI updates, theme management, and communication with the main process via IPC.
 */

// --- Global Error Handling for Renderer Process ---
window.addEventListener('error', (event) => {
  // event.error contains the error object
  if (event.error) {
    window.api.showErrorInDialog(event.error);
  }
});

window.addEventListener('unhandledrejection', (event) => {
  // event.reason contains the error or rejection reason
  if (event.reason) {
    const error = event.reason instanceof Error ? event.reason : new Error(JSON.stringify(event.reason));
    window.api.showErrorInDialog(error);
  }
});

document.addEventListener('DOMContentLoaded', () => {
    // --- UI Element References ---
  // Query and store references to all interactive DOM elements.
  const selectFileButton = document.getElementById('select-file');
  const filePathSpan = document.getElementById('file-path');
  const statusMessages = document.getElementById('status-messages');
  const linesPerIntervalInput = document.getElementById('lines-per-interval');
  const rateMsInput = document.getElementById('rate-ms');
  const sendManualButton = document.getElementById('send-manual');
  const linePreviewText = document.getElementById('line-preview-text');
  const lineSlider = document.getElementById('line-slider');
  const lineInfoDisplay = document.getElementById('line-info-display');
  const clearStatusButton = document.getElementById('clear-status');
  const toggleGestureLoggingButton = document.getElementById('toggle-gesture-logging');
  const toggleMicLoggingButton = document.getElementById('toggle-mic-logging');
  const linesSentCountSpan = document.getElementById('lines-sent-value');
  const connectButton = document.getElementById('connect');
  const disconnectButton = document.getElementById('disconnect');
  const playPauseButton = document.getElementById('play-pause');
  const resizer = document.getElementById('resizer');
  const controlsWrapper = document.querySelector('.controls-wrapper');
  const statusArea = document.querySelector('.status-area');
  const themeSelect = document.getElementById('theme-select');
  const toggleViewButton = document.getElementById('toggle-view-button');
  const appTitle = document.querySelector('.app-title');
  const toggleCameraButton = document.getElementById('toggle-camera-button');
  const toggleGestureReportButton = document.getElementById('toggle-gesture-report');
  const toggleMicButton = document.getElementById('toggle-mic-button');
  const videoFeed = document.getElementById('video-feed');
  const lastGestureReceived = document.getElementById('last-gesture-received');
  const liveGestureReceived = document.getElementById('live-gesture-received');
  const appState = document.getElementById('app-state');
  const appStateEmoji = document.getElementById('app-state-emoji');
  const connectionTypeSelect = document.getElementById('connection-type');
  const connectionPresetSelect = document.getElementById('connection-preset');
  const connectionPresetState = document.getElementById('connection-preset-state');
  const grpcSerializationSelect = document.getElementById('grpc-serialization');
  const grpcSerializationGroup = document.getElementById('grpc-serialization-group');
  const grpcSendMethodSelect = document.getElementById('grpc-send-method');
  const grpcSendMethodGroup = document.getElementById('grpc-send-method-group');
  const grpcHeaderPathKeyInput = document.getElementById('grpc-header-path-key');
  const grpcHeaderPathKeyGroup = document.getElementById('grpc-header-path-key-group');
  const grpcHeaderPathInput = document.getElementById('grpc-header-path');
  const grpcHeaderPathGroup = document.getElementById('grpc-header-path-group');
  const grpcTlsCheckbox = document.getElementById('grpc-tls');
  const grpcTlsGroup = document.getElementById('grpc-tls-group');
  const grpcTlsCaGroup = document.getElementById('grpc-tls-ca-group');
  const grpcTlsCertGroup = document.getElementById('grpc-tls-cert-group');
  const grpcTlsKeyGroup = document.getElementById('grpc-tls-key-group');
  const grpcAllowUnverifiedGroup = document.getElementById('grpc-allow-unverified-group');
  const grpcAllowUnverifiedCheckbox = document.getElementById('grpc-allow-unverified');
  const grpcAdvancedDetails = document.getElementById('grpc-advanced');
  const httpFormatSelect = document.getElementById('http-format');
  const httpFormatGroup = document.getElementById('http-format-group');
  const httpTlsCheckbox = document.getElementById('http-tls');
  const httpTlsGroup = document.getElementById('http-tls-group');
  const httpTlsCaGroup = document.getElementById('http-tls-ca-group');
  const httpTlsCertGroup = document.getElementById('http-tls-cert-group');
  const httpTlsKeyGroup = document.getElementById('http-tls-key-group');
  const httpPathGroup = document.getElementById('http-path-group');
  const httpPathInput = document.getElementById('http-path');
  const httpAllowUnverifiedGroup = document.getElementById('http-allow-unverified-group');
  const httpAllowUnverifiedCheckbox = document.getElementById('http-allow-unverified');
  const httpAdvancedDetails = document.getElementById('http-advanced');
  const wsFormatSelect = document.getElementById('ws-format');
  const wsFormatGroup = document.getElementById('ws-format-group');
  const wsTlsCheckbox = document.getElementById('ws-tls');
  const wsTlsGroup = document.getElementById('ws-tls-group');
  const wsTlsCaGroup = document.getElementById('ws-tls-ca-group');
  const wsTlsCertGroup = document.getElementById('ws-tls-cert-group');
  const wsTlsKeyGroup = document.getElementById('ws-tls-key-group');
  const wsPathGroup = document.getElementById('ws-path-group');
  const wsPathInput = document.getElementById('ws-path');
  const wsSubscriptionMsgGroup = document.getElementById('ws-subscription-msg-group');
  const wsSubscriptionMsgInput = document.getElementById('ws-subscription-msg');
  const wsIgnoreFirstMsgGroup = document.getElementById('ws-ignore-first-msg-group');
  const wsIgnoreFirstMsgCheckbox = document.getElementById('ws-ignore-first-msg');
  const wsHeadersGroup = document.getElementById('ws-headers-group');
  const wsHeadersInput = document.getElementById('ws-headers');
  const wsAllowUnverifiedGroup = document.getElementById('ws-allow-unverified-group');
  const wsAllowUnverifiedCheckbox = document.getElementById('ws-allow-unverified');
  const wsAdvancedDetails = document.getElementById('ws-advanced');
  // --- XMPP controls ---
  const xmppConversationSelect = document.getElementById('xmpp-conversation');
  const xmppConversationGroup = document.getElementById('xmpp-conversation-group');
  const xmppDomainGroup = document.getElementById('xmpp-domain-group');
  const xmppDomainInput = document.getElementById('xmpp-domain');
  const xmppTlsPolicySelect = document.getElementById('xmpp-tls-policy');
  const xmppTlsPolicyGroup = document.getElementById('xmpp-tls-policy-group');
  const xmppTlsCaGroup = document.getElementById('xmpp-tls-ca-group');
  const xmppTlsCertGroup = document.getElementById('xmpp-tls-cert-group');
  const xmppTlsKeyGroup = document.getElementById('xmpp-tls-key-group');
  const xmppAllowUnverifiedGroup = document.getElementById('xmpp-allow-unverified-group');
  const xmppAllowUnverifiedCheckbox = document.getElementById('xmpp-allow-unverified');
  const xmppAllowRemoteGroup = document.getElementById('xmpp-allow-remote-group');
  const xmppAllowRemoteCheckbox = document.getElementById('xmpp-allow-remote');
  const xmppUsernameGroup = document.getElementById('xmpp-username-group');
  const xmppUsernameInput = document.getElementById('xmpp-username');
  const xmppPasswordGroup = document.getElementById('xmpp-password-group');
  const xmppPasswordInput = document.getElementById('xmpp-password');
  const xmppResourceGroup = document.getElementById('xmpp-resource-group');
  const xmppResourceInput = document.getElementById('xmpp-resource');
  const xmppExternalUsernameGroup = document.getElementById('xmpp-external-username-group');
  const xmppExternalUsernameInput = document.getElementById('xmpp-external-username');
  const xmppExternalPasswordGroup = document.getElementById('xmpp-external-password-group');
  const xmppExternalPasswordInput = document.getElementById('xmpp-external-password');
  const xmppDestinationGroup = document.getElementById('xmpp-destination-group');
  const xmppDestinationInput = document.getElementById('xmpp-destination');
  const xmppRoomGroup = document.getElementById('xmpp-room-group');
  const xmppRoomInput = document.getElementById('xmpp-room');
  const xmppNicknameGroup = document.getElementById('xmpp-nickname-group');
  const xmppNicknameInput = document.getElementById('xmpp-nickname');
  const xmppRoomPasswordGroup = document.getElementById('xmpp-room-password-group');
  const xmppRoomPasswordInput = document.getElementById('xmpp-room-password');
  const xmppTimeoutsGroup = document.getElementById('xmpp-timeouts-group');
  const xmppConnectTimeoutInput = document.getElementById('xmpp-connect-timeout');
  const xmppReplyTimeoutInput = document.getElementById('xmpp-reply-timeout');
  const xmppPingIntervalGroup = document.getElementById('xmpp-ping-interval-group');
  const xmppPingIntervalInput = document.getElementById('xmpp-ping-interval');
  const xmppReconnectDelayGroup = document.getElementById('xmpp-reconnect-delay-group');
  const xmppReconnectDelayInput = document.getElementById('xmpp-reconnect-delay');
  const xmppCopySettingsGroup = document.getElementById('xmpp-copy-settings-group');
  const xmppCopySettingsButton = document.getElementById('xmpp-copy-settings');
  const xmppCopyPasswordCheckbox = document.getElementById('xmpp-copy-password');
  const xmppAdvancedDetails = document.getElementById('xmpp-advanced');
  const toggleVoiceButton = document.getElementById('toggle-voice-button');
  const toggleLoopButton = document.getElementById('toggle-loop-button');
  const toggleStatusLog = document.getElementById('toggle-status-log');
  const toggleConnectionControls = document.getElementById('toggle-connection-controls');
  const toggleSortOrderButton = document.getElementById('toggle-sort-order');
  const connectionControlsGroup = document.querySelector('.connection-controls-group');
  const extraOptionsToggleRow = document.getElementById('extra-options-toggle-row');
  const extraOptionsToggleBtn = document.getElementById('extra-options-toggle');
  const extraOptionsLabel = extraOptionsToggleBtn ? extraOptionsToggleBtn.querySelector('.extra-options-label') : null;
  const extraOptionsBody = document.getElementById('extra-options-body');
  let extraOptionsExpanded = false;

  const ipAddressInput = document.getElementById('ip-address');
  const portInput = document.getElementById('port');
  const clearLogsButton = document.getElementById('clear-logs-button');

  const GRPC_SERIALIZATION_TOOLTIPS = {
    protobuf: 'gRPC Feature Serialization Format: Protobuf. Uses the ArcGIS Velocity external GrpcFeed protocol (velocity-grpc.proto) with typed Feature messages and google.protobuf.Any-wrapped attributes. Recommended for standard external Velocity gRPC interoperability.',
    kryo: 'gRPC Feature Serialization Format: Kryo. Uses the internal GrpcFeatureService protocol (feature-service.proto) where the bytes field carries raw binary feature payloads. Intended for internal-path compatibility and advanced testing.',
    text: 'gRPC Feature Serialization Format: Text. Uses the internal GrpcFeatureService protocol (feature-service.proto) where the bytes field carries plain UTF-8 text, typically a CSV line. Best for simple human-readable testing.',
  };

  const GRPC_SEND_METHOD_TOOLTIPS = {
    stream: 'gRPC RPC Type: Client Streaming. Opens a persistent client-streaming RPC and multiplexes all messages over a single long-lived HTTP/2 stream. The client writes multiple request messages before the server responds once. Ideal for high-throughput ingestion with minimal per-message overhead. Maps to Stream (GrpcFeed) or executeMulti (GrpcFeatureService).',
    unary: 'gRPC RPC Type: Unary. Each message is sent as a discrete request/response round-trip - one request in, one response out. The simplest gRPC call pattern, analogous to a traditional REST call. Easier to trace and debug, but incurs per-call overhead (HTTP/2 framing, header compression). Maps to Send (GrpcFeed) or execute (GrpcFeatureService).',
  };

  // --- State Variables ---
  // These variables track the application's current state.
  let isLooping = false; // Is the "continuous loop" feature enabled?
  let sendInterval; // Holds the interval ID for the automated data sending.
  let isSending = false; // Is data currently being sent automatically?
  let isPaused = false; // Is the sending process paused?
  let isConnected = false; // Is there an active network connection?
  let isConnecting = false;
  let currentTlsTooltip = '';
  let linesSentCount = 0; // Total lines sent since the app started or since the log was cleared.
  let linesSentThisSession = 0; // Lines sent in the current play session (from play to pause).
  let csvLines = []; // Array to hold the lines from the loaded CSV file.
  let currentLineIndex = 0; // Index of the next line to be sent from csvLines.
  let isGestureLoggingEnabled = false; // Should gesture commands be logged to the status panel?
  let isMicLoggingEnabled = false; // Should voice commands be logged to the status panel?
  let statusOrder = 'ascending'; // ascending | descending
  const statusBuffer = []; // keep raw status entries for re-render
  
  // Expose microphone logging state globally for offline speech recognition
  window.isMicLoggingEnabled = isMicLoggingEnabled;
  let appStateTimeout; // Holds the timeout ID for temporary app state messages.
  let lastSplitterPosition = '50%'; // Default splitter position
  let isCompactViewInitialized = false;
  let initialStatusVisibility = null;

  // Ensure offline speech status UI is hidden by default (shown only when mic logging is enabled)
  const initialOfflineSpeechStatus = document.querySelector('.offline-speech-status');
  if (initialOfflineSpeechStatus) {
    initialOfflineSpeechStatus.style.display = 'none';
  }

  function updateGrpcSerializationTooltip() {
    const tooltip = GRPC_SERIALIZATION_TOOLTIPS[grpcSerializationSelect.value] || GRPC_SERIALIZATION_TOOLTIPS.protobuf;
    grpcSerializationSelect.title = tooltip;
    grpcSerializationSelect.setAttribute('aria-label', tooltip);
    grpcSerializationGroup.title = tooltip;
  }

  function updateGrpcSendMethodTooltip() {
    const tooltip = GRPC_SEND_METHOD_TOOLTIPS[grpcSendMethodSelect.value] || GRPC_SEND_METHOD_TOOLTIPS.stream;
    grpcSendMethodSelect.title = tooltip;
    grpcSendMethodSelect.setAttribute('aria-label', tooltip);
    grpcSendMethodGroup.title = tooltip;
  }

  const HTTP_FORMAT_TOOLTIPS = {
    json: 'HTTP Format: JSON (application/json). The standard format for most HTTP feeds. Each request body is a JSON object or array of features.',
    delimited: 'HTTP Format: Delimited / CSV (text/plain). Each line is a comma-separated row of field values. Best for simple tabular data without nested structures.',
    'esri-json': 'HTTP Format: Esri JSON (application/json). Uses the Esri Feature JSON schema with geometry and attributes objects. Use when the Velocity HTTP Receiver expects ArcGIS-native feature format.',
    'geo-json': 'HTTP Format: GeoJSON (application/geo+json). Standard GeoJSON per RFC 7946 with FeatureCollection and Feature objects. Use when the receiver expects standard geospatial interchange format.',
    xml: 'HTTP Format: XML (application/xml). Sends data as XML-formatted payloads. Use when the Velocity HTTP Receiver is configured for XML input.',
  };

  const CONNECTION_MODE_TOOLTIPS = {
    'tcp-server': 'TCP Server - listens on the specified port and accepts incoming TCP connections from clients.',
    'tcp-client': 'TCP Client - connects to a remote TCP server at the specified host and port.',
    'udp-server': 'UDP Server - binds to the specified port and receives incoming UDP datagrams.',
    'udp-client': 'UDP Client - sends UDP datagrams to the specified host and port.',
    'http-client': 'HTTP Client - sends data via HTTP/HTTPS POST requests to a remote endpoint.',
    'http-server': 'HTTP Server - starts a local HTTP/HTTPS server that accepts POST requests from clients.',
    'ws-client': 'WebSocket Client - connects to a remote WebSocket server (ws:// or wss://) and sends data as text frames.',
    'ws-server': 'WebSocket Server - starts a local WebSocket server that accepts incoming ws:// or wss:// connections.',
    'grpc-client': 'gRPC Client - connects to a remote gRPC server using HTTP/2.',
    'grpc-server': 'gRPC Server - starts a local gRPC server that accepts incoming RPC calls.',
    'xmpp-client': 'XMPP Client - signs in to an XMPP server and publishes each line as a direct chat message or into a Multi-User Chat room.',
    'xmpp-server': 'XMPP Server - hosts a local XMPP client-to-server endpoint that a receiver signs in to, then publishes each line to it.',
  };

  const XMPP_CONVERSATION_TOOLTIPS = {
    direct: 'XMPP Conversation: Direct. Each replayed line is delivered as a one-to-one chat message to every destination JID, up to 20 of them.',
    muc: 'XMPP Conversation: Room (MUC). Each replayed line is broadcast as an XEP-0045 groupchat message into the room. Every occupant receives it, and the room echoes the message back to the sender.',
  };

  const XMPP_TLS_POLICY_TOOLTIPS = {
    required: 'XMPP STARTTLS: Required. The stream must be upgraded to TLS before any credential is sent. The built-in server advertises STARTTLS as mandatory and refuses plaintext authentication.',
    preferred: 'XMPP STARTTLS: Preferred. The stream is upgraded to TLS when the peer offers it, but authentication still proceeds on a plaintext stream when it does not.',
    disabled: "XMPP STARTTLS: Disabled. Encryption is not required and the built-in server stops advertising STARTTLS. As a client the Simulator still accepts an upgrade a third-party server insists on, so Disabled means 'do not require TLS', not 'refuse TLS'.",
  };

  function updateXmppConversationTooltip() {
    if (!xmppConversationSelect) return;
    const tooltip = XMPP_CONVERSATION_TOOLTIPS[xmppConversationSelect.value] || XMPP_CONVERSATION_TOOLTIPS.direct;
    xmppConversationSelect.dataset.tooltip = tooltip;
    xmppConversationSelect.setAttribute('aria-label', tooltip);
    if (xmppConversationGroup) xmppConversationGroup.dataset.tooltip = tooltip;
  }

  function updateXmppTlsPolicyTooltip() {
    if (!xmppTlsPolicySelect) return;
    const value = xmppTlsPolicySelect.value;
    const tooltip = XMPP_TLS_POLICY_TOOLTIPS[value] || XMPP_TLS_POLICY_TOOLTIPS.required;
    xmppTlsPolicySelect.dataset.tooltip = tooltip;
    xmppTlsPolicySelect.dataset.tooltipIcon = value === 'disabled' ? '🔓' : '🔒';
    xmppTlsPolicySelect.dataset.tooltipKind = value === 'disabled' ? 'warning' : 'secure';
    xmppTlsPolicySelect.setAttribute('aria-label', tooltip);
    if (xmppTlsPolicyGroup) xmppTlsPolicyGroup.dataset.tooltip = tooltip;
  }

  function updateHttpFormatTooltip() {
    if (!httpFormatSelect) return;
    const tooltip = HTTP_FORMAT_TOOLTIPS[httpFormatSelect.value] || HTTP_FORMAT_TOOLTIPS.delimited;
    httpFormatSelect.title = tooltip;
    httpFormatSelect.setAttribute('aria-label', tooltip);
    if (httpFormatGroup) httpFormatGroup.title = tooltip;
  }

  const WS_FORMAT_TOOLTIPS = {
    delimited: 'WebSocket Format: Delimited / CSV (text/plain). Each message is a comma-separated row of field values. Default format for ArcGIS Velocity WebSocket feeds.',
    json: 'WebSocket Format: JSON (application/json). Each message is a JSON object or array of features.',
    'esri-json': 'WebSocket Format: Esri JSON (application/json). Each message uses the Esri Feature JSON schema with geometry and attributes objects.',
    'geo-json': 'WebSocket Format: GeoJSON (application/geo+json). Each message is a GeoJSON FeatureCollection or Feature per RFC 7946.',
    xml: 'WebSocket Format: XML (application/xml). Each message is an XML-formatted payload.',
  };

  function updateWsFormatTooltip() {
    if (!wsFormatSelect) return;
    const tooltip = WS_FORMAT_TOOLTIPS[wsFormatSelect.value] || WS_FORMAT_TOOLTIPS.delimited;
    wsFormatSelect.title = tooltip;
    wsFormatSelect.setAttribute('aria-label', tooltip);
    if (wsFormatGroup) wsFormatGroup.title = tooltip;
  }

  function updateConnectionModeTooltip() {
    const tooltip = CONNECTION_MODE_TOOLTIPS[connectionTypeSelect.value] || '';
    connectionTypeSelect.title = tooltip;
    connectionTypeSelect.setAttribute('aria-label', tooltip);
  }

  // Default ports per protocol
  const DEFAULT_PORTS = { tcp: 5565, udp: 5565, grpc: 5565, http: 8443, ws: 8443, xmpp: 5222 };
  const HTTP_PORT_TLS_ON = 8443;
  const HTTP_PORT_TLS_OFF = 8080;
  let lastProtocolDefault = 5565;

  /**
   * Shows exactly the XMPP controls that apply to the selected role and
   * conversation. Everything else stays hidden so the options panel only ever
   * asks for settings that are actually used.
   */
  function updateXmppOptionsVisibility() {
    const value = connectionTypeSelect.value || '';
    const isXmpp = value.startsWith('xmpp');
    const isClient = value === 'xmpp-client';
    const isMuc = isXmpp && xmppConversationSelect && xmppConversationSelect.value === 'muc';
    const tlsEnabled = isXmpp && xmppTlsPolicySelect && xmppTlsPolicySelect.value !== 'disabled';
    const show = (group, visible) => {
      if (group) group.style.display = visible ? '' : 'none';
    };

    show(xmppConversationGroup, isXmpp);
    show(xmppDomainGroup, isXmpp);
    show(xmppTlsPolicyGroup, isXmpp);
    show(xmppTlsCaGroup, isXmpp && isClient && tlsEnabled);
    show(xmppAllowUnverifiedGroup, isXmpp && isClient && tlsEnabled);
    show(xmppTlsCertGroup, isXmpp && !isClient && tlsEnabled);
    show(xmppTlsKeyGroup, isXmpp && !isClient && tlsEnabled);
    show(xmppAllowRemoteGroup, isXmpp && !isClient);
    show(xmppUsernameGroup, isXmpp && isClient);
    show(xmppPasswordGroup, isXmpp && isClient);
    show(xmppResourceGroup, isXmpp && isClient);
    show(xmppExternalUsernameGroup, isXmpp && !isClient);
    show(xmppExternalPasswordGroup, isXmpp && !isClient);
    show(xmppDestinationGroup, isXmpp && !isMuc);
    show(xmppRoomGroup, isXmpp && isMuc);
    show(xmppNicknameGroup, isXmpp && isMuc);
    show(xmppRoomPasswordGroup, isXmpp && isMuc);
    show(xmppTimeoutsGroup, isXmpp);
    show(xmppPingIntervalGroup, isXmpp && isClient);
    show(xmppReconnectDelayGroup, isXmpp && isClient);
    show(xmppCopySettingsGroup, isXmpp && !isClient);

    if (xmppDestinationInput) {
      xmppDestinationInput.placeholder = isClient
        ? 'feed@example.com, geoevent@example.com'
        : '(optional — every signed-in account)';
    }
    updateAdvancedDisclosureVisibility();
  }

  /**
   * Shows the explicit "Allow unverified" certificate control only where it
   * applies: client modes with TLS enabled. Server modes are unaffected.
   */
  function updateUnverifiedTlsVisibility() {
    const type = connectionTypeSelect.value || '';
    const isClient = type.endsWith('-client');
    const rules = [
      [grpcAllowUnverifiedGroup, type.startsWith('grpc') && Boolean(grpcTlsCheckbox && grpcTlsCheckbox.checked)],
      [httpAllowUnverifiedGroup, type.startsWith('http') && Boolean(httpTlsCheckbox && httpTlsCheckbox.checked)],
      [wsAllowUnverifiedGroup, type.startsWith('ws') && Boolean(wsTlsCheckbox && wsTlsCheckbox.checked)],
    ];
    rules.forEach(([group, protocolMatches]) => {
      if (group) group.style.display = isClient && protocolMatches ? '' : 'none';
    });
  }

  /**
   * An Advanced disclosure only makes sense when it still holds a visible
   * control, so it is hidden with its protocol and whenever every option
   * inside it is hidden by the current mode.
   */
  function updateAdvancedDisclosureVisibility() {
    const val = connectionTypeSelect.value || '';
    [
      [httpAdvancedDetails, val.startsWith('http')],
      [wsAdvancedDetails, val.startsWith('ws')],
      [grpcAdvancedDetails, val.startsWith('grpc')],
      [xmppAdvancedDetails, val.startsWith('xmpp')],
    ].forEach(([details, protocolMatches]) => {
      if (!details) return;
      const hasVisibleOption = protocolMatches && [...details.querySelectorAll('.control-group')]
        .some((group) => group.style.display !== 'none');
      details.style.display = hasVisibleOption ? '' : 'none';
      if (!hasVisibleOption) details.open = false;
    });
  }

  // Show/hide gRPC, HTTP, and WebSocket controls based on connection type
  connectionTypeSelect.addEventListener('change', () => {
    const val = connectionTypeSelect.value;
    const isGrpc = val.startsWith('grpc');
    const isGrpcClient = val === 'grpc-client';
    const isHttp = val.startsWith('http');
    const isWs = val.startsWith('ws');

    // gRPC controls
    grpcSerializationGroup.style.display = isGrpc ? '' : 'none';
    grpcSendMethodGroup.style.display = isGrpc ? '' : 'none';
    grpcTlsGroup.style.display = isGrpc ? '' : 'none';
    const showGrpcTlsCerts = isGrpc && grpcTlsCheckbox.checked;
    grpcTlsCaGroup.style.display = showGrpcTlsCerts ? '' : 'none';
    grpcTlsCertGroup.style.display = showGrpcTlsCerts ? '' : 'none';
    grpcTlsKeyGroup.style.display = showGrpcTlsCerts ? '' : 'none';
    grpcHeaderPathKeyGroup.style.display = isGrpcClient ? '' : 'none';
    grpcHeaderPathGroup.style.display = isGrpcClient ? '' : 'none';

    // HTTP controls
    httpFormatGroup.style.display = isHttp ? '' : 'none';
    httpTlsGroup.style.display = isHttp ? '' : 'none';
    const showHttpTlsCerts = isHttp && httpTlsCheckbox.checked;
    httpTlsCaGroup.style.display = showHttpTlsCerts ? '' : 'none';
    httpTlsCertGroup.style.display = showHttpTlsCerts ? '' : 'none';
    httpTlsKeyGroup.style.display = showHttpTlsCerts ? '' : 'none';
    httpPathGroup.style.display = isHttp ? '' : 'none';

    // WebSocket controls
    wsFormatGroup.style.display = isWs ? '' : 'none';
    wsTlsGroup.style.display = isWs ? '' : 'none';
    const showWsTlsCerts = isWs && wsTlsCheckbox.checked;
    wsTlsCaGroup.style.display = showWsTlsCerts ? '' : 'none';
    wsTlsCertGroup.style.display = showWsTlsCerts ? '' : 'none';
    wsTlsKeyGroup.style.display = showWsTlsCerts ? '' : 'none';
    wsPathGroup.style.display = isWs ? '' : 'none';
    wsSubscriptionMsgGroup.style.display = isWs ? '' : 'none';
    wsIgnoreFirstMsgGroup.style.display = isWs ? '' : 'none';
    wsHeadersGroup.style.display = isWs ? '' : 'none';

    // XMPP controls
    updateXmppOptionsVisibility();

    // Smart port switching
    const currentPort = parseInt(portInput.value, 10);
    const protocol = val.split('-')[0];
    let newDefault;
    if (isHttp || isWs) {
      const tlsChecked = isHttp ? httpTlsCheckbox.checked : wsTlsCheckbox.checked;
      newDefault = tlsChecked ? HTTP_PORT_TLS_ON : HTTP_PORT_TLS_OFF;
    } else {
      newDefault = DEFAULT_PORTS[protocol] || 5565;
    }
    if (currentPort === lastProtocolDefault || isNaN(currentPort)) {
      portInput.value = newDefault;
    }
    lastProtocolDefault = newDefault;

    updateGrpcSerializationTooltip();
    updateConnectionModeTooltip();
    updateUnverifiedTlsVisibility();
    updateAdvancedDisclosureVisibility();
    refreshTlsBadge();
  });

  grpcSerializationSelect.addEventListener('change', updateGrpcSerializationTooltip);
  updateGrpcSerializationTooltip();

  grpcSendMethodSelect.addEventListener('change', updateGrpcSendMethodTooltip);
  updateGrpcSendMethodTooltip();

  httpFormatSelect.addEventListener('change', updateHttpFormatTooltip);
  updateHttpFormatTooltip();

  wsFormatSelect.addEventListener('change', updateWsFormatTooltip);
  updateWsFormatTooltip();

  if (xmppConversationSelect) {
    xmppConversationSelect.addEventListener('change', () => {
      updateXmppConversationTooltip();
      updateXmppOptionsVisibility();
    });
    updateXmppConversationTooltip();
  }

  if (xmppTlsPolicySelect) {
    xmppTlsPolicySelect.addEventListener('change', () => {
      updateXmppTlsPolicyTooltip();
      updateXmppOptionsVisibility();
      refreshTlsBadge();
    });
    updateXmppTlsPolicyTooltip();
  }

  updateXmppOptionsVisibility();
  updateUnverifiedTlsVisibility();
  updateAdvancedDisclosureVisibility();

  connectionTypeSelect.addEventListener('change', updateConnectionModeTooltip);
  updateConnectionModeTooltip();

  // Toggle TLS cert fields when TLS checkbox changes
  grpcTlsCheckbox.addEventListener('change', () => {
    const isGrpc = connectionTypeSelect.value.startsWith('grpc');
    const show = isGrpc && grpcTlsCheckbox.checked;
    grpcTlsCaGroup.style.display = show ? '' : 'none';
    grpcTlsCertGroup.style.display = show ? '' : 'none';
    grpcTlsKeyGroup.style.display = show ? '' : 'none';
    updateUnverifiedTlsVisibility();
    updateAdvancedDisclosureVisibility();
    refreshTlsBadge();
  });

  // Toggle HTTP TLS cert fields and port when HTTP TLS checkbox changes
  httpTlsCheckbox.addEventListener('change', () => {
    const isHttp = connectionTypeSelect.value.startsWith('http');
    const show = isHttp && httpTlsCheckbox.checked;
    httpTlsCaGroup.style.display = show ? '' : 'none';
    httpTlsCertGroup.style.display = show ? '' : 'none';
    httpTlsKeyGroup.style.display = show ? '' : 'none';
    // Smart port switch between 8080 and 8443
    if (isHttp) {
      const currentPort = parseInt(portInput.value, 10);
      if (httpTlsCheckbox.checked && currentPort === HTTP_PORT_TLS_OFF) {
        portInput.value = HTTP_PORT_TLS_ON;
        lastProtocolDefault = HTTP_PORT_TLS_ON;
      } else if (!httpTlsCheckbox.checked && currentPort === HTTP_PORT_TLS_ON) {
        portInput.value = HTTP_PORT_TLS_OFF;
        lastProtocolDefault = HTTP_PORT_TLS_OFF;
      }
    }
    updateUnverifiedTlsVisibility();
    updateAdvancedDisclosureVisibility();
    refreshTlsBadge();
  });

  // Toggle WebSocket TLS cert fields and port when WS TLS checkbox changes
  wsTlsCheckbox.addEventListener('change', () => {
    const isWs = connectionTypeSelect.value.startsWith('ws');
    const show = isWs && wsTlsCheckbox.checked;
    wsTlsCaGroup.style.display = show ? '' : 'none';
    wsTlsCertGroup.style.display = show ? '' : 'none';
    wsTlsKeyGroup.style.display = show ? '' : 'none';
    // Smart port switch between 8080 and 8443
    if (isWs) {
      const currentPort = parseInt(portInput.value, 10);
      if (wsTlsCheckbox.checked && currentPort === HTTP_PORT_TLS_OFF) {
        portInput.value = HTTP_PORT_TLS_ON;
        lastProtocolDefault = HTTP_PORT_TLS_ON;
      } else if (!wsTlsCheckbox.checked && currentPort === HTTP_PORT_TLS_ON) {
        portInput.value = HTTP_PORT_TLS_OFF;
        lastProtocolDefault = HTTP_PORT_TLS_OFF;
      }
    }
    updateUnverifiedTlsVisibility();
    updateAdvancedDisclosureVisibility();
    refreshTlsBadge();
  });

  // --- Extra Options collapsible toggle ---
  function getExtraOptionsProtocolLabel() {
    const val = connectionTypeSelect.value;
    if (val.startsWith('http')) return 'HTTP Options';
    if (val.startsWith('ws')) return 'WebSocket Options';
    if (val.startsWith('grpc')) return 'gRPC Options';
    if (val.startsWith('xmpp')) return 'XMPP Options';
    return 'Protocol Options';
  }

  function syncExtraOptionsToggleState() {
    if (!extraOptionsToggleBtn) return;
    const label = getExtraOptionsProtocolLabel();
    const action = extraOptionsExpanded ? 'Collapse' : 'Expand';
    const detail = connectionTypeSelect.value.startsWith('xmpp')
      ? 'such as conversation type, domain, STARTTLS policy, account, and destinations'
      : 'such as format, TLS, paths, and headers';
    const tooltip = `${action} ${label.toLowerCase()} ${detail}.`;
    if (extraOptionsLabel) extraOptionsLabel.textContent = label;
    extraOptionsToggleBtn.setAttribute('aria-expanded', extraOptionsExpanded ? 'true' : 'false');
    extraOptionsToggleBtn.title = tooltip;
    extraOptionsToggleBtn.setAttribute('aria-label', tooltip);
  }

  function updateExtraOptionsToggleRow() {
    const val = connectionTypeSelect.value;
    const hasExtras = val.startsWith('http') || val.startsWith('ws') || val.startsWith('grpc') || val.startsWith('xmpp');
    if (val.startsWith('xmpp') && !extraOptionsExpanded && extraOptionsBody) {
      extraOptionsExpanded = true;
      extraOptionsBody.style.display = '';
    }
    if (extraOptionsToggleRow) extraOptionsToggleRow.style.display = hasExtras ? '' : 'none';
    if (!hasExtras && extraOptionsBody) {
      extraOptionsExpanded = false;
      extraOptionsBody.style.display = 'none';
    }
    syncExtraOptionsToggleState();
  }

  if (extraOptionsToggleBtn) {
    extraOptionsToggleBtn.addEventListener('click', () => {
      extraOptionsExpanded = !extraOptionsExpanded;
      extraOptionsBody.style.display = extraOptionsExpanded ? '' : 'none';
      syncExtraOptionsToggleState();
    });
  }

  // Also call updateExtraOptionsToggleRow on mode change (hook into existing listener)
  connectionTypeSelect.addEventListener('change', updateExtraOptionsToggleRow);
  // Set initial state (TCP server selected by default - no extras)
  updateExtraOptionsToggleRow();

  // ------------------------------------------------------------------
  // Connection presets
  //
  // A preset only pre-fills editable connection fields. It never connects,
  // never starts playback, never selects a file, never stores a secret, and
  // never changes the application startup defaults. Definitions live in
  // connection-presets.js so the Simulator and the Logger share the same ids
  // and labels with the roles inverted.
  // ------------------------------------------------------------------
  const connectionPresets = window.ConnectionPresets || null;
  const CUSTOM_PRESET_ID = connectionPresets ? connectionPresets.CUSTOM_PRESET_ID : 'custom';
  let activePresetId = CUSTOM_PRESET_ID;
  let modifiedFromPresetId = '';
  let applyingPresetValues = false;

  function updateConnectionPresetTooltip() {
    if (!connectionPresetSelect || !connectionPresets) return;
    const tooltip = connectionPresets.describeConnectionPreset(connectionPresetSelect.value, {
      modified: Boolean(modifiedFromPresetId),
      baseId: modifiedFromPresetId,
    });
    connectionPresetSelect.title = tooltip;
    connectionPresetSelect.dataset.tooltip = tooltip;
    connectionPresetSelect.dataset.tooltipIcon = modifiedFromPresetId ? '✎' : '🎚';
    connectionPresetSelect.dataset.tooltipKind = 'info';
    connectionPresetSelect.setAttribute('aria-label', tooltip.replace(/\n+/g, ' '));
    if (connectionPresetState) {
      connectionPresetState.hidden = !modifiedFromPresetId;
      if (modifiedFromPresetId) {
        const base = connectionPresets.getConnectionPreset(modifiedFromPresetId);
        const stateTooltip = `Modified\nThese fields started from "${base ? base.label : 'a preset'}" and were edited. Select the preset again to restore its values.`;
        connectionPresetState.dataset.tooltip = stateTooltip;
        connectionPresetState.setAttribute('aria-label', stateTooltip.replace(/\n+/g, ' '));
      }
    }
  }

  /** Opens every collapsed ancestor so a control can be seen and focused. */
  function revealControl(element) {
    if (!element) return;
    if (extraOptionsBody && extraOptionsBody.contains(element)) {
      extraOptionsExpanded = true;
      extraOptionsBody.style.display = '';
      syncExtraOptionsToggleState();
    }
    let node = element.parentElement;
    while (node) {
      if (node.tagName === 'DETAILS') {
        node.open = true;
        if (node.style.display === 'none') node.style.display = '';
      }
      if (node.classList && node.classList.contains('control-group') && node.style.display === 'none') {
        node.style.display = '';
      }
      node = node.parentElement;
    }
    if (connectionControlsGroup && connectionControlsGroup.classList.contains('hidden')) {
      connectionControlsGroup.classList.remove('hidden');
      if (toggleConnectionControls) toggleConnectionControls.dataset.enabled = 'true';
    }
  }

  /** Opens the options area that belongs to the selected connection type. */
  function revealProtocolOptions() {
    const val = connectionTypeSelect.value || '';
    const hasExtras = val.startsWith('http') || val.startsWith('ws') ||
      val.startsWith('grpc') || val.startsWith('xmpp');
    if (hasExtras && extraOptionsBody) {
      extraOptionsExpanded = true;
      extraOptionsBody.style.display = '';
      if (extraOptionsToggleRow) extraOptionsToggleRow.style.display = '';
      syncExtraOptionsToggleState();
    }
  }

  function setPresetControlValue(field, value) {
    const control = connectionPresets.CONNECTION_PRESET_CONTROLS[field];
    if (!control) return;
    const element = document.getElementById(control.elementId);
    if (!element) return;
    if (control.kind === 'checked') {
      element.checked = value === true;
    } else {
      element.value = value === null || value === undefined ? '' : String(value);
    }
    element.dispatchEvent(new Event('change'));
  }

  /**
   * Fills the connection fields from a preset. Field order matters: the
   * connection type is applied first so protocol-specific rows exist, and the
   * port is written last so the smart port default cannot overwrite it.
   */
  function applyConnectionPreset(presetId) {
    if (!connectionPresets) return false;
    const preset = connectionPresets.getConnectionPreset(presetId);
    if (!preset) return false;
    const values = connectionPresets.buildConnectionPresetValues(presetId);
    applyingPresetValues = true;
    try {
      setPresetControlValue('connectionType', values.connectionType);
      Object.keys(values).forEach((field) => {
        if (field === 'connectionType') return;
        setPresetControlValue(field, values[field]);
      });
      setPresetControlValue('port', values.port);
    } finally {
      applyingPresetValues = false;
    }
    activePresetId = presetId;
    modifiedFromPresetId = '';
    updateXmppOptionsVisibility();
    updateUnverifiedTlsVisibility();
    updateAdvancedDisclosureVisibility();
    revealProtocolOptions();
    // Applying a preset is a deterministic reset, so every Advanced disclosure
    // starts collapsed again and only the ones a preset needs are reopened.
    [grpcAdvancedDetails, httpAdvancedDetails, wsAdvancedDetails, xmppAdvancedDetails]
      .forEach((details) => { if (details) details.open = false; });
    // A preset that turns on a certificate-verification bypass opens the
    // disclosure holding it, so the warning control is never enabled out of
    // sight.
    Object.entries({
      grpcAllowUnverifiedTls: grpcAllowUnverifiedCheckbox,
      httpAllowUnverifiedTls: httpAllowUnverifiedCheckbox,
      wsAllowUnverifiedTls: wsAllowUnverifiedCheckbox,
      xmppAllowUnverifiedTls: xmppAllowUnverifiedCheckbox,
    }).forEach(([field, control]) => {
      if (values[field] === true) revealControl(control);
    });
    updateConnectionPresetTooltip();
    logStatus(`🎚 Preset applied: ${preset.label}`);
    logStatus(`   ${preset.summary}`);
    logStatus('   Fields were pre-filled only; review them and select Connect when ready.');
    return true;
  }

  /** Any manual edit to a populated connection field falls back to Custom. */
  function markConnectionFieldsModified() {
    if (applyingPresetValues) return;
    if (activePresetId === CUSTOM_PRESET_ID) return;
    modifiedFromPresetId = activePresetId;
    activePresetId = CUSTOM_PRESET_ID;
    if (connectionPresetSelect) connectionPresetSelect.value = CUSTOM_PRESET_ID;
    updateConnectionPresetTooltip();
  }

  if (connectionPresetSelect && connectionPresets) {
    connectionPresetSelect.addEventListener('change', () => {
      const selected = connectionPresetSelect.value;
      if (selected === CUSTOM_PRESET_ID) {
        // Custom preserves whatever is currently entered.
        activePresetId = CUSTOM_PRESET_ID;
        modifiedFromPresetId = '';
        updateConnectionPresetTooltip();
        logStatus('🎚 Preset set to Custom; the current connection fields were kept unchanged');
        return;
      }
      applyConnectionPreset(selected);
    });
    if (connectionControlsGroup) {
      ['change', 'input'].forEach((eventName) => {
        connectionControlsGroup.addEventListener(eventName, (event) => {
          if (event.target === connectionPresetSelect) return;
          markConnectionFieldsModified();
        });
      });
    }
    updateConnectionPresetTooltip();
  }

  const applyInitialSplitterPosition = () => {
    if (!isCompactViewInitialized || initialStatusVisibility === null) {
      return; // Not all startup info has been received yet.
    }

    const isCompact = document.body.classList.contains('compact');
    if (!isCompact && !initialStatusVisibility) {
      // This is the special case: full view and hidden status area.
      controlsWrapper.style.flexBasis = '100%';
    }
    // In all other cases, the splitter position is set correctly by handleSetCompactView.
    
    // Check if status area should be collapsed based on current splitter position
    checkStatusAreaCollapsed();
  };

  /**
   * Checks if the status area should be collapsed based on current dimensions
   * and adds/removes the collapsed class accordingly
   */
  function checkStatusAreaCollapsed() {
    const isCompact = document.body.classList.contains('compact');
    const container = document.querySelector('.main-content');
    
    if (!container || !controlsWrapper) return;
    
    const controlsRect = controlsWrapper.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    let statusSize;
    if (isCompact) {
      // In compact view, status area height is container height - controls height - resizer height
      statusSize = containerRect.height - controlsRect.height - 5;
    } else {
      // In full view, status area width is container width - controls width - resizer width
      statusSize = containerRect.width - controlsRect.width - 5;
    }
    
    // Add collapsed class when status area size is very small (less than 30px)
    statusArea.classList.toggle('collapsed', statusSize < 30);
  }

  /**
   * Converts a raw tlsInfo string (from transport connect results) into a concise,
   * human-readable tooltip for the status bar "connected" indicator.
   *
   * Examples of raw values:
   *   "tls=off (unsecure)"
   *   "tls=on (cert verification skipped - no CA provided), 142 trusted CAs loaded, ..."
   *   "tls=on, custom certs: ca=/path/ca.pem"
   *   "tls=on, cert=self-signed (auto-generated), key=self-signed (auto-generated)"
   *
   * @param {string} raw - The raw tlsInfo string
   * @returns {string} Human-readable tooltip, or '' if no useful info
   */
  function tlsInfoToTooltip(raw) {
    if (!raw) return '';
    if (/STARTTLS preferred but unavailable/i.test(raw)) {
      return 'STARTTLS Preferred — the peer did not offer STARTTLS, so this connection is plaintext and unsecure.\nEncryption: No.\nCertificate trust: Not applicable.\nUse Required when plaintext fallback is not acceptable.';
    }
    if (/tls=off/i.test(raw)) {
      return 'TLS Off — this connection is plaintext and unsecure.\nEncryption: No.\nCertificate trust: Not applicable.\nAuthentication is shown separately by the key badge.';
    }
    if (/self-signed/i.test(raw)) {
      return 'TLS Self-Signed — traffic is encrypted, but the certificate is not CA-verified.\nEncryption: Yes.\nCertificate trust: Self-signed or local-only; peer identity is not fully verified.\nUse this for development/testing, not production.';
    }
    if (/cert verification skipped/i.test(raw)) {
      return 'TLS Verification Skipped — traffic is encrypted, but certificate authority checks are disabled.\nEncryption: Yes.\nCertificate trust: Not verified; peer identity is unverified.\nUse this only for development or trusted private networks.';
    }
    if (/mtls|client.*cert|cert.*client/i.test(raw)) {
      return 'Mutual TLS — encrypted connection with certificate-based client authentication.\nEncryption: Yes.\nCertificate trust: Client and server certificates are used.\nToken authentication is shown separately by the key badge.';
    }
    if (/custom certs/i.test(raw)) {
      return 'TLS Verified — encrypted connection with a certificate chain validated by a custom CA.\nEncryption: Yes.\nCertificate trust: Verified against the configured CA certificate.\nAuthentication is shown separately by the key badge.';
    }
    if (/tls=on/i.test(raw)) {
      return 'TLS On — traffic is encrypted.\nEncryption: Yes.\nCertificate trust: Uses the OS trust store or configured TLS options.\nAuthentication is shown separately by the key badge.';
    }
    return raw;
  }

  /**
   * Wraps a simple on/off TLS checkbox in the uniform descriptor the TLS badge
   * uses, so protocols that model TLS differently can plug into the same code.
   */
  function createCheckboxTlsControl(checkbox, protocol, mode, secureName, unsecureName) {
    return {
      checkbox,
      protocol,
      mode,
      secureName,
      unsecureName,
      isEnabled: () => Boolean(checkbox && checkbox.checked),
      toggleLabel: () => (checkbox && checkbox.checked ? 'off' : 'on'),
      detail: () => '',
      toggle() {
        if (!checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      },
    };
  }

  /**
   * XMPP models TLS as a three-value STARTTLS policy rather than a checkbox.
   * Clicking the badge flips between the encrypted default and Disabled;
   * Preferred stays available through the XMPP options select.
   */
  function createXmppTlsControl(mode) {
    const policy = xmppTlsPolicySelect ? xmppTlsPolicySelect.value : 'required';
    return {
      checkbox: xmppTlsPolicySelect,
      protocol: 'XMPP',
      mode,
      secureName: policy === 'preferred' ? 'STARTTLS when offered' : 'STARTTLS',
      unsecureName: 'an unsecure plaintext stream',
      isEnabled: () => policy !== 'disabled',
      toggleLabel: () => (policy === 'disabled' ? 'on' : 'off'),
      detail: () => `STARTTLS policy: ${policy}.`,
      isOpportunistic: () => policy === 'preferred',
      toggle() {
        if (!xmppTlsPolicySelect) return;
        xmppTlsPolicySelect.value = policy === 'disabled' ? 'required' : 'disabled';
        xmppTlsPolicySelect.dispatchEvent(new Event('change'));
      },
    };
  }

  function getSelectedTlsControl() {
    const value = connectionTypeSelect.value || '';
    const mode = value.endsWith('-server') ? 'Server' : 'Client';
    if (value.startsWith('grpc')) {
      return createCheckboxTlsControl(grpcTlsCheckbox, 'gRPC', mode, 'TLS', 'unsecure gRPC');
    }
    if (value.startsWith('http')) {
      return createCheckboxTlsControl(httpTlsCheckbox, 'HTTP', mode, 'HTTPS', 'HTTP');
    }
    if (value.startsWith('ws')) {
      return createCheckboxTlsControl(wsTlsCheckbox, 'WebSocket', mode, 'WSS', 'WS');
    }
    if (value.startsWith('xmpp')) {
      return createXmppTlsControl(mode);
    }
    return null;
  }

  function canToggleTlsFromFooter() {
    return !isConnected;
  }

  function getConfiguredTlsTooltip() {
    const selected = getSelectedTlsControl();
    if (!selected || !selected.checkbox) return '';

    const enabled = selected.isEnabled();
    const endpoint = `${ipAddressInput.value || 'host'}:${portInput.value || 'port'}`;
    const action = canToggleTlsFromFooter()
      ? `Click to turn TLS ${selected.toggleLabel()} for ${selected.protocol} ${selected.mode}.`
      : `Disconnect before changing TLS for this ${selected.protocol} ${selected.mode} connection.`;
    const detail = selected.detail();
    const detailLine = detail ? `\n${detail}` : '';

    if (selected.isOpportunistic && selected.isOpportunistic()) {
      return `STARTTLS Preferred — ${selected.protocol} ${selected.mode} will request encryption but may fall back to plaintext when the peer does not offer it.${detailLine}\nScope: New ${selected.protocol} connections only.\nEncryption: Opportunistic, not guaranteed.\nCertificate trust: Checked only when STARTTLS is negotiated.\nEndpoint: ${endpoint}.\nAction: ${action}`;
    }
    if (enabled) {
      return `TLS Configured — ${selected.protocol} ${selected.mode} will use ${selected.secureName} on the next connection.${detailLine}\nScope: New ${selected.protocol} connections only.\nEncryption: Enabled in the UI.\nCertificate trust: Checked after connection.\nEndpoint: ${endpoint}.\nAction: ${action}\nAuth: Token status is shown separately by the key badge.`;
    }

    return `TLS Off — ${selected.protocol} ${selected.mode} will use ${selected.unsecureName} on the next connection.${detailLine}\nScope: New ${selected.protocol} connections only.\nEncryption: No.\nCertificate trust: Not applicable.\nEndpoint: ${endpoint}.\nAction: ${action}\nAuth: Token status is shown separately by the key badge.`;
  }

  function getTlsBadgeTooltipForStatus() {
    if (isConnected && currentTlsTooltip && getSelectedTlsControl()) return currentTlsTooltip;
    return getConfiguredTlsTooltip();
  }

  function refreshTlsBadge() {
    updateTlsBadge(getTlsBadgeTooltipForStatus());
  }

  const velocityAuthUtils = window.VelocityAuthUtils || {};
  const shouldSendVelocityTokenByDefault = velocityAuthUtils.shouldSendVelocityTokenByDefault || (() => false);
  const describeVelocityAuthType = velocityAuthUtils.describeVelocityAuthType || ((authType) => authType || 'not specified');
  let velocityAuthState = {
    hasToken: false,
    tokenSendingEnabled: false,
    contextLabel: 'No feed selected',
    authType: 'token',
    expires: 0,
    error: '',
  };

  function formatTokenExpiry(expires) {
    if (!expires) return 'Unknown';
    const date = new Date(expires);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  function updateAuthBadge(nextState = {}) {
    velocityAuthState = { ...velocityAuthState, ...nextState };
    const wrapper = document.getElementById('auth-badge-wrapper');
    const badge = document.getElementById('auth-badge');
    const icon = document.getElementById('auth-badge-icon');
    const label = document.getElementById('auth-badge-label');
    const content = document.getElementById('auth-badge-content');
    if (!badge) return;

    if (!velocityAuthState.hasToken && !velocityAuthState.error) {
      if (wrapper) wrapper.style.display = 'none';
      badge.style.display = 'none';
      badge.classList.remove('pinned');
      return;
    }

    const isError = Boolean(velocityAuthState.error);
    const isOn = velocityAuthState.hasToken && velocityAuthState.tokenSendingEnabled && !isError;
    const state = isError ? 'error' : (isOn ? 'on' : 'off');
    const iconText = isError ? '⚠' : (isOn ? '🔑' : '◇');
    const labelText = isError ? 'Token Error' : (isOn ? 'Token On' : 'Token Off');
    const actionText = isOn
      ? 'Click to turn token sending off for new client connections.'
      : 'Click to turn token sending on for new client connections.';
    const tooltip = isError
      ? `Token Error — Velocity token refresh failed.\nToken: Hidden for security.\nStatus: ${velocityAuthState.error}\nAction: Sign in again if reconnecting fails.`
      : `${labelText} — ${isOn ? 'Velocity token will be sent with new gRPC, HTTP, and WebSocket client connections.' : 'A Velocity token is available, but it will not be sent with new client connections.'}\nScope: New client connections only.\nToken: Hidden for security.\nSelected feed: ${velocityAuthState.contextLabel}.\nAuth type: ${describeVelocityAuthType(velocityAuthState.authType)}.\nExpires: ${formatTokenExpiry(velocityAuthState.expires)}.\nAction: ${actionText}`;

    badge.dataset.authState = state;
    badge.dataset.tooltip = tooltip;
    badge.dataset.tooltipIcon = isError ? '⚠' : '🔑';
    badge.dataset.tooltipKind = isError ? 'error' : 'auth';
    badge.setAttribute('aria-label', tooltip.replace(/\n+/g, ' '));
    badge.setAttribute('aria-pressed', isOn ? 'true' : 'false');
    if (wrapper) wrapper.style.display = 'flex';
    badge.style.display = 'flex';
    if (icon) icon.textContent = iconText;
    if (label) label.textContent = labelText;
    if (content) content.textContent = tooltip;
  }

  function setVelocityTokenSending(enabled, logChange = true) {
    updateAuthBadge({ tokenSendingEnabled: enabled, error: '' });
    window.api.setVelocityTokenSending(enabled);
    if (logChange) {
      logStatus(enabled
        ? '🔑 Velocity token sending enabled for new client connections'
        : '◇ Velocity token sending disabled for new client connections');
    }
  }

  function updateAuthFromVelocityItem(item) {
    const tokenSendingEnabled = shouldSendVelocityTokenByDefault(item);
    updateAuthBadge({
      hasToken: true,
      tokenSendingEnabled,
      contextLabel: item.tokenOnly ? 'Custom connection settings (no feed selected)' : (item.label || item.id || 'Selected feed'),
      authType: item.authType || (tokenSendingEnabled ? 'token' : 'none'),
      error: '',
    });
  }

  /**
   * Updates the TLS trust badge in the status bar center.
   * Shows a lock icon whose colour reflects the trust level, with a hover/click popover.
   * Pass null or '' to hide the badge (disconnected / no-TLS protocols).
   * @param {string} tooltip - The human-readable TLS tooltip, or '' to hide
   */
  function updateTlsBadge(tooltip) {
    const badge   = document.getElementById('tls-badge');
    const icon    = document.getElementById('tls-badge-icon');
    const content = document.getElementById('tls-badge-content');
    if (!badge) return;

    if (!tooltip) {
      badge.style.display = 'none';
      badge.classList.remove('pinned');
      return;
    }

    // Each trust level gets a visually distinct icon so it is distinguishable
    // without relying on colour alone (colour-blindness accessibility).
    // 🔓 open lock  = no TLS (plaintext)
    // 🔒⚠          = TLS on, self-signed / cert-chain not verified
    // 🔐            = mTLS - key icon signals mutual authentication
    // 🔒✓           = TLS on, CA-verified certificate chain
    let trust, iconChar;
    if (/STARTTLS Preferred|opportunistic/i.test(tooltip)) {
      trust = 'opportunistic'; iconChar = '🔒?';
    } else if (/tls configured|enabled in the ui|checked after connection/i.test(tooltip)) {
      trust = 'configured';  iconChar = '🔒…';
    } else if (/tls.*off|unsecure|plaintext/i.test(tooltip)) {
      trust = 'off';         iconChar = '🔓';
    } else if (/self-signed|verification.*skip/i.test(tooltip)) {
      trust = 'self-signed'; iconChar = '🔒⚠';
    } else if (/mtls|mutual/i.test(tooltip)) {
      trust = 'mtls';        iconChar = '🔐';
    } else if (/ca-verified|custom ca/i.test(tooltip)) {
      trust = 'ca-verified'; iconChar = '🔒✓';
    } else {
      trust = 'on';          iconChar = '🔒';
    }

    badge.dataset.trust = trust;
    badge.dataset.tlsToggleable = canToggleTlsFromFooter() && getSelectedTlsControl() ? 'true' : 'false';
    badge.dataset.tooltip = tooltip;
    badge.dataset.tooltipIcon = iconChar;
    badge.dataset.tooltipKind = trust === 'off' || trust === 'self-signed' || trust === 'opportunistic'
      ? 'warning'
      : 'secure';
    badge.setAttribute('aria-label', tooltip.replace(/\n+/g, ' '));
    const selected = getSelectedTlsControl();
    badge.setAttribute('aria-pressed', selected && selected.isEnabled() ? 'true' : 'false');
    badge.style.display = 'flex';
    if (icon)    icon.textContent    = iconChar;
    if (content) content.textContent = tooltip;
  }

  /**
   * Updates the main application state display in the status bar.
   * Can show a temporary message (like "Stepped") or a permanent state (like "Playing").
   * @param {string|null} temporaryText - Text for a temporary message. If null, displays the permanent state.
   * @param {number} [duration=0] - How long (in ms) to display the temporary message.
   */
  function updateAppStateDisplay(temporaryText = null, duration = 0) {
    if (!appState || !appStateEmoji) return;
    
    // Always clear the previous timeout to reset the timer on new calls
    clearTimeout(appStateTimeout);

    if (temporaryText) {
      const tempState = temporaryText.toLowerCase();
      appState.textContent = temporaryText;
      appState.setAttribute('data-state', tempState);
      
      // Show emoji and set it
      const emoji = stateEmojis[tempState] || '⭐';
      appStateEmoji.textContent = emoji;
      appStateEmoji.style.display = 'inline';
      
      if (duration > 0) {
        // Set a new timeout to revert to the permanent state
        appStateTimeout = setTimeout(() => updateAppStateDisplay(), duration);
      }
      return;
    }
    
    let stateText = '';
    let stateAttribute = '';
    
    if (!isConnected) {
      stateText = 'Disconnected';
      stateAttribute = 'disconnected';
    } else if (!isSending) {
      stateText = 'Connected - Ready';
      stateAttribute = 'connected';
    } else if (isPaused) {
      stateText = 'Connected - Paused';
      stateAttribute = 'paused';
    } else {
      stateText = 'Connected - Playing';
      stateAttribute = 'playing';
    }
    
    appState.textContent = stateText;
    appState.setAttribute('data-state', stateAttribute);
    // Update TLS badge: configured state while disconnected, actual trust when connected.
    refreshTlsBadge();

    // Show emoji and set it based on state
    const emoji = stateEmojis[stateAttribute] || '⭐';
    appStateEmoji.textContent = emoji;
    appStateEmoji.style.display = 'inline';
  }

  // --- Initialization and Media State ---
  let isInitializing = true; // Flag to prevent saving during initial load
  let isCameraOn = false; // Is the camera currently active?
  let isMicOn = false; // Is the microphone currently active?
  let stream = null; // Holds the media stream for the camera.

  // --- Mappings ---
  // Gesture to emoji mapping
  const gestureEmojis = {
    'connect': '👍',
    'disconnect': '🤙',
    'step': '✌️',
    'play': '👊',
    'pause': '🖐️'
  };

  // App state to emoji mapping
  const stateEmojis = {
    'disconnected': '🔴',
    'connecting': '🟡',
    'connected': '🟢',
    'signed in': '🔐',
    'in room': '🏛',
    'copied': '📋',
    'playing': '▶️',
    'paused': '⏸️',
    'stepped': '👣'
  };

    // --- UI Resizer Logic ---
  // Handles resizing of the control and status panels using a draggable resizer element.
  // The layout changes between horizontal and vertical based on the compact view state.
  let lastClickTime = 0;
  const DOUBLE_CLICK_DELAY = 300; // milliseconds
  
  resizer.addEventListener('mousedown', (e) => {
    // Check if status log is enabled - if not, don't allow resizing
    const statusLogEnabled = toggleStatusLog.dataset.enabled === 'true';
    if (!statusLogEnabled) {
      return; // Exit early if status log is hidden
    }
    
    // Handle double-click to toggle collapse/expand
    const currentTime = Date.now();
    if (currentTime - lastClickTime < DOUBLE_CLICK_DELAY) {
      // Double-click detected - toggle collapsed state
      const isCollapsed = statusArea.classList.contains('collapsed');
      const isCompact = document.body.classList.contains('compact');
      const container = document.querySelector('.main-content');
      
      if (isCollapsed) {
        // Expand to a reasonable size
        if (isCompact) {
          controlsWrapper.style.flexBasis = '60%';
        } else {
          controlsWrapper.style.flexBasis = '60%';
        }
      } else {
        // Collapse completely
        if (isCompact) {
          controlsWrapper.style.flexBasis = `${container.clientHeight - 10}px`;
        } else {
          controlsWrapper.style.flexBasis = `${container.clientWidth - 10}px`;
        }
      }
      
      // Update collapsed state and save position
      checkStatusAreaCollapsed();
      if (window.api && window.api.saveSplitterPosition) {
        window.api.saveSplitterPosition(controlsWrapper.style.flexBasis);
      }
      
      return; // Don't start dragging after double-click
    }
    lastClickTime = currentTime;
    
    e.preventDefault();
    function handleMouseUp() {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // Save the new splitter position only if the status area is visible.
      if (!statusArea.classList.contains('hidden')) {
        if (window.api && window.api.saveSplitterPosition) {
          window.api.saveSplitterPosition(controlsWrapper.style.flexBasis);
        }
      }
      
      // Check collapsed state after resizing is complete
      checkStatusAreaCollapsed();
    }
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  });

  function handleMouseMove(e) {
    const isCompact = document.body.classList.contains('compact');
    const container = document.querySelector('.main-content');

    if (isCompact) {
      // Vertical resizing
      const newControlsHeight = e.clientY - container.getBoundingClientRect().top;
      const minControlsHeight = 0;
      const minStatusHeight = 0;
      const containerHeight = container.clientHeight;
      const statusHeight = containerHeight - newControlsHeight - 5; // Account for resizer height

      if (newControlsHeight >= minControlsHeight && (containerHeight - newControlsHeight) >= minStatusHeight) {
        controlsWrapper.style.flexBasis = `${newControlsHeight}px`;
        
        // Add collapsed class when status area height is very small (less than 30px)
        statusArea.classList.toggle('collapsed', statusHeight < 30);
      }
    } else {
      // Horizontal resizing
      const newControlsWidth = e.clientX - container.getBoundingClientRect().left;
      const minControlsWidth = 0;
      const minStatusWidth = 0;
      const containerWidth = container.clientWidth;
      const statusWidth = containerWidth - newControlsWidth - 5; // Account for resizer width

      if (newControlsWidth >= minControlsWidth && (containerWidth - newControlsWidth) >= minStatusWidth) {
        controlsWrapper.style.flexBasis = `${newControlsWidth}px`;
        
        // Add collapsed class when status area width is very small (less than 30px)
        statusArea.classList.toggle('collapsed', statusWidth < 30);
      }
    }
  }

    // --- Theme Management ---
  // Handles applying and saving color themes for the application UI.
    /**
   * Applies a specified theme to the application body and saves it.
   * It removes any existing theme class and adds the new one.
   * Handles the 'system' theme by detecting the OS preference.
   * @param {string} theme - The name of the theme to apply (e.g., 'dark', 'light', 'system').
   */
  function applyTheme(theme) {
    // Remove all existing theme classes
    document.body.className = document.body.className.replace(/\b(light|dark|dark-gray|light-gray|blue|green|high-contrast|color-blind|system|midnight|sunset|rose|rose-dark|ocean|mocha)\b/g, '').trim();
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      document.body.classList.add(systemTheme);
    } else {
      document.body.classList.add(theme);
    }
    
    localStorage.setItem('theme', theme);
    // Save theme to persistent config (but not during initial load)
    if (!isInitializing && window.api && window.api.saveTheme) {
      window.api.saveTheme(theme);
    }
  }

    // Listen for changes in the OS's color scheme and re-apply the theme if it's set to 'system'.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const savedTheme = localStorage.getItem('theme') || 'system';
    if (savedTheme === 'system') {
      applyTheme('system');
    }
  });

    // --- UI Event Listeners ---
  // Assigns event listeners to all interactive UI elements.
  themeSelect.addEventListener('change', (e) => {
    applyTheme(e.target.value);
  });

  selectFileButton.addEventListener('click', async () => {
    if (isConnected || isSending) return;
    try {
      const filePath = await window.api.openFileDialog();
      if (filePath) {
        loadFile(filePath);
      }
    } catch (error) {
      logStatus(`Error selecting or reading file: ${error.message}`);
      window.api.showErrorInDialog(new Error(`Error selecting or reading file: ${error.message}`));
    }
  });

    // --- Connection Management ---
  // Handles the logic for connecting to and disconnecting from a TCP/UDP endpoint.
  // Establishes connection to the specified endpoint.
  connectButton.addEventListener('click', async () => {
    if (isConnected || isConnecting) return;
    const connectionType = connectionTypeSelect.value;
    const [protocol, mode] = connectionType.split('-');
    const ip = document.getElementById('ip-address').value;
    const port = parseInt(document.getElementById('port').value, 10);
    const serialization = grpcSerializationSelect.value;
    const grpcSendMethod = grpcSendMethodSelect.value;
    const headerPathKey = grpcHeaderPathKeyInput.value;
    const headerPath = grpcHeaderPathInput.value;
    const useTls = grpcTlsCheckbox.checked;
    const tlsCaPath = document.getElementById('grpc-tls-ca-path').value || undefined;
    const tlsCertPath = document.getElementById('grpc-tls-cert-path').value || undefined;
    const tlsKeyPath = document.getElementById('grpc-tls-key-path').value || undefined;
    // Explicit certificate-verification bypasses are client-only opt-ins.
    const isClientMode = mode === 'client';
    const allowUnverifiedTls = isClientMode && Boolean(grpcAllowUnverifiedCheckbox && grpcAllowUnverifiedCheckbox.checked);
    // HTTP-specific params
    const httpFormat = httpFormatSelect.value;
    const httpTls = httpTlsCheckbox.checked;
    const httpTlsCaPath = document.getElementById('http-tls-ca-path').value || undefined;
    const httpTlsCertPath = document.getElementById('http-tls-cert-path').value || undefined;
    const httpTlsKeyPath = document.getElementById('http-tls-key-path').value || undefined;
    const httpPath = httpPathInput.value || '/';
    const httpAllowUnverifiedTls = isClientMode && Boolean(httpAllowUnverifiedCheckbox && httpAllowUnverifiedCheckbox.checked);
    // WebSocket-specific params
    const wsFormat = wsFormatSelect.value;
    const wsTls = wsTlsCheckbox.checked;
    const wsTlsCaPath = document.getElementById('ws-tls-ca-path').value || undefined;
    const wsTlsCertPath = document.getElementById('ws-tls-cert-path').value || undefined;
    const wsTlsKeyPath = document.getElementById('ws-tls-key-path').value || undefined;
    const wsPath = wsPathInput.value || '/';
    const wsSubscriptionMsg = wsSubscriptionMsgInput.value || undefined;
    const wsIgnoreFirstMsg = wsIgnoreFirstMsgCheckbox.checked;
    const wsHeaders = wsHeadersInput.value || undefined;
    const wsAllowUnverifiedTls = isClientMode && Boolean(wsAllowUnverifiedCheckbox && wsAllowUnverifiedCheckbox.checked);
    // XMPP-specific params
    const xmppOptions = collectXmppConnectOptions(protocol, mode);
    if (xmppOptions === null) return;
    // Reset session counter on new connection.
    linesSentThisSession = 0;
    const tlsLabel = protocol === 'grpc'
      ? (useTls ? (allowUnverifiedTls ? ' tls=on (unverified)' : ' tls=on') : ' tls=off')
      : '';
    const serLabel = protocol === 'grpc' ? ` [${serialization || 'protobuf'}]` : '';
    const methodLabel = protocol === 'grpc' ? ` ${grpcSendMethod === 'unary' ? 'unary' : 'streaming'}` : '';
    const headerLabel = protocol === 'grpc' && mode === 'client' ? ` ${headerPathKey}=${headerPath}` : '';
    const httpLabel = protocol === 'http'
      ? ` [${httpFormat}] ${httpTls ? (httpAllowUnverifiedTls ? 'tls=on (unverified)' : 'tls=on') : 'tls=off'} path=${httpPath}`
      : '';
    const wsLabel = protocol === 'ws' ? ` [${wsFormat}] ${wsTls ? 'wss' : 'ws'} path=${wsPath}` : '';
    const xmppLabel = protocol === 'xmpp' ? describeXmppConnectIntent(xmppOptions) : '';
    logStatus(`Connecting via ${protocol.toUpperCase()} ${mode} to ${ip}:${port}${serLabel}${methodLabel}${tlsLabel}${headerLabel}${httpLabel}${wsLabel}${xmppLabel}...`);
    handleConnectionStatusChange('connecting');
    const result = await window.api.connect({ protocol, mode, ip, port, grpcSerialization: serialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath, allowUnverifiedTls, httpFormat, httpTls, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, httpPath, httpAllowUnverifiedTls, wsFormat, wsTls, wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath, wsPath, wsSubscriptionMsg, wsIgnoreFirstMsg, wsHeaders, wsAllowUnverifiedTls, ...xmppOptions });
    if (result && result.success === false) {
      logStatus(`❌ ${result.error || 'The connection could not be started.'}`);
      handleConnectionStatusChange('disconnected');
    }
  });

  /**
   * Reads the XMPP options panel and validates the combinations that would
   * otherwise fail deep inside the transport. Returns `null` when a required
   * value is missing, after logging an actionable message and leaving the
   * connection state untouched.
   *
   * @param {string} protocol
   * @param {string} mode
   * @returns {object|null}
   */
  function collectXmppConnectOptions(protocol, mode) {
    if (protocol !== 'xmpp') return {};
    const conversation = xmppConversationSelect ? xmppConversationSelect.value : 'direct';
    const isMuc = conversation === 'muc';
    const tlsPolicy = xmppTlsPolicySelect ? xmppTlsPolicySelect.value : 'required';
    const tlsEnabled = tlsPolicy !== 'disabled';
    const options = {
      xmppConversation: conversation,
      xmppDomain: (xmppDomainInput && xmppDomainInput.value.trim()) || 'localhost',
      xmppTlsPolicy: tlsPolicy,
      xmppConnectTimeoutMs: readPositiveNumber(xmppConnectTimeoutInput, 30000),
      xmppReplyTimeoutMs: readPositiveNumber(xmppReplyTimeoutInput, 15000),
    };

    if (mode === 'client') {
      options.xmppUsername = xmppUsernameInput ? xmppUsernameInput.value.trim() : '';
      options.xmppPassword = xmppPasswordInput ? xmppPasswordInput.value : '';
      options.xmppResource = (xmppResourceInput && xmppResourceInput.value.trim()) || 'velocity-simulator';
      options.xmppTlsCaPath = tlsEnabled
        ? (xmppTlsCaGroup && document.getElementById('xmpp-tls-ca-path').value) || undefined
        : undefined;
      options.xmppAllowUnverifiedTls = tlsEnabled &&
        Boolean(xmppAllowUnverifiedCheckbox && xmppAllowUnverifiedCheckbox.checked);
      options.xmppPingIntervalMs = readPositiveNumber(xmppPingIntervalInput, 60000);
      options.xmppReconnectDelayMs = readPositiveNumber(xmppReconnectDelayInput, 60000);
      // The password is intentionally not required: an XMPP account may be
      // configured with a present-but-empty password for relaxed local
      // testing. The username stays required.
      if (!options.xmppUsername) {
        return showXmppValidationError(xmppUsernameInput,
          'XMPP Client requires a username. Enter the account to sign in with.');
      }
    } else {
      options.xmppTlsCertPath = tlsEnabled
        ? document.getElementById('xmpp-tls-cert-path').value || undefined
        : undefined;
      options.xmppTlsKeyPath = tlsEnabled
        ? document.getElementById('xmpp-tls-key-path').value || undefined
        : undefined;
      options.xmppAllowRemote = Boolean(xmppAllowRemoteCheckbox && xmppAllowRemoteCheckbox.checked);
      options.xmppExternalUsername = xmppExternalUsernameInput ? xmppExternalUsernameInput.value.trim() : '';
      // The external password may be present but empty for relaxed local
      // testing; only the username is required.
      options.xmppExternalPassword = xmppExternalPasswordInput ? xmppExternalPasswordInput.value : '';
      if (!options.xmppExternalUsername) {
        return showXmppValidationError(xmppExternalUsernameInput,
          'XMPP Server requires one external account. Enter its username; the password may be left empty.');
      }
      if (Boolean(options.xmppTlsCertPath) !== Boolean(options.xmppTlsKeyPath)) {
        return showXmppValidationError(
          options.xmppTlsCertPath ? document.getElementById('xmpp-tls-key-path') : document.getElementById('xmpp-tls-cert-path'),
          'XMPP Server TLS needs both a certificate and its private key. Leave both empty to use an automatic self-signed certificate.');
      }
      const host = ipAddressInput.value.trim();
      if (!options.xmppAllowRemote && !['localhost', '127.0.0.1', '::1'].includes(host)) {
        return showXmppValidationError(xmppAllowRemoteCheckbox,
          'Enable Allow remote before binding the XMPP server to a non-loopback address.');
      }
    }

    if (isMuc) {
      options.xmppRoom = xmppRoomInput ? xmppRoomInput.value.trim() : '';
      options.xmppNickname = (xmppNicknameInput && xmppNicknameInput.value.trim()) || 'velocity-simulator';
      options.xmppRoomPassword = xmppRoomPasswordInput ? xmppRoomPasswordInput.value : '';
      if (!options.xmppRoom) {
        return showXmppValidationError(xmppRoomInput,
          'Room (MUC) conversations require a room name or room JID.');
      }
      if (/[/@]/.test(options.xmppNickname)) {
        return showXmppValidationError(xmppNicknameInput,
          `The room nickname '${options.xmppNickname}' must not contain '/' or '@'.`);
      }
    } else {
      const destination = xmppDestinationInput ? xmppDestinationInput.value.trim() : '';
      options.xmppDestination = destination || undefined;
      const entries = destination.split(',').map((entry) => entry.trim()).filter(Boolean);
      if (mode === 'client' && entries.length === 0) {
        return showXmppValidationError(xmppDestinationInput,
          'Direct conversations require at least one destination JID, for example feed@example.com.');
      }
      if (entries.length > 20) {
        return showXmppValidationError(xmppDestinationInput,
          `At most 20 comma-separated destination JIDs are allowed; ${entries.length} were entered.`);
      }
      const invalid = entries.find((entry) => entry.includes('/') || !/^[^@\s]+@[^@\s/]+$/.test(entry));
      if (invalid) {
        return showXmppValidationError(xmppDestinationInput,
          `'${invalid}' is not a bare destination JID. Use user@domain with no resource part.`);
      }
    }

    return options;
  }

  function showXmppValidationError(control, message) {
    extraOptionsExpanded = true;
    if (extraOptionsBody) extraOptionsBody.style.display = '';
    syncExtraOptionsToggleState();
    // Required values are never hidden behind a collapsed disclosure: the
    // offending control is revealed before it is focused.
    revealControl(control);
    if (control) {
      control.setAttribute('aria-invalid', 'true');
      control.focus();
      control.addEventListener('input', () => control.removeAttribute('aria-invalid'), { once: true });
      control.addEventListener('change', () => control.removeAttribute('aria-invalid'), { once: true });
    }
    logStatus(`❌ ${message}`);
    return null;
  }

  /**
   * Reads a positive integer from a numeric input, falling back to a default.
   * Every XMPP timing is positive: zero neither disables a keepalive nor waits
   * forever, so a blank, zero, or negative field falls back to the default.
   */
  function readPositiveNumber(input, fallback) {
    if (!input) return fallback;
    const parsed = parseInt(input.value, 10);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
  }

  /** Builds the status-log suffix describing what the XMPP connection will do. */
  function describeXmppConnectIntent(options) {
    const target = options.xmppConversation === 'muc'
      ? `room ${options.xmppRoom} as '${options.xmppNickname}'`
      : `→ ${options.xmppDestination || 'every signed-in account'}`;
    return ` [${options.xmppConversation}] starttls=${options.xmppTlsPolicy} domain=${options.xmppDomain} ${target}`;
  }

  // XMPP: copy the settings a receiver needs to sign in to the built-in server.
  if (xmppCopySettingsButton) {
    xmppCopySettingsButton.addEventListener('click', async () => {
      const includePassword = Boolean(xmppCopyPasswordCheckbox && xmppCopyPasswordCheckbox.checked);
      try {
        const result = await window.api.getXmppClientSettings({ includePassword });
        if (!result || !result.success) {
          logStatus(`❌ Could not build XMPP client settings: ${(result && result.error) || 'the XMPP server is not running.'}`);
          return;
        }
        await navigator.clipboard.writeText(result.text);
        logStatus(includePassword
          ? '📋 XMPP client settings copied, including the external account password.'
          : '📋 XMPP client settings copied. The account password was not copied.');
        updateAppStateDisplay('Copied', 1500);
        if (xmppCopyPasswordCheckbox) xmppCopyPasswordCheckbox.checked = false;
      } catch (error) {
        logStatus(`❌ Could not copy XMPP client settings: ${error.message}`);
      }
    });
  }

  // Terminates the active connection.
  disconnectButton.addEventListener('click', async () => {
    if (!isConnected && !isConnecting) return;
    linesSentThisSession = 0;
    // If data is being sent, pause it before disconnecting.
    if (isSending) {
      playPauseButton.click();
    }
    logStatus('Disconnecting...');
    const result = await window.api.disconnect();
    if (result && result.success === false) {
      logStatus(`❌ ${result.error || 'The connection could not be closed.'}`);
    }
  });

  /**
   * Updates the play/pause button state for icon-only UI design
   * 
   * This function manages the play/pause button's visual state by:
   * 1. Updating the tooltip text for accessibility
   * 2. Toggling the 'is-playing' CSS class to swap icons
   * 
   * The button contains both play and pause SVG icons. CSS rules
   * use the 'is-playing' class to show/hide the appropriate icon:
   * - Default state: shows play icon (▶️)
   * - is-playing class: shows pause icon (⏸️)
   * 
   * @param {boolean} isPlaying - True if media is currently playing
   */
  function updatePlayPauseButton(isPlaying) {
    if (isPlaying) {
      // Update tooltip for accessibility
      playPauseButton.title = 'Pause';
      // Add class to trigger CSS icon swap (play → pause)
      playPauseButton.classList.add('is-playing');
    } else {
      // Update tooltip for accessibility
      playPauseButton.title = 'Play';
      // Remove class to trigger CSS icon swap (pause → play)
      playPauseButton.classList.remove('is-playing');
    }
  }

    // --- Data Sending (Play/Pause) ---
  // Manages the start, pause, and resumption of the data sending process.
  // Toggles the data sending state (play, pause, resume).
  playPauseButton.addEventListener('click', () => {
    // Case 1: Start sending data for the first time.
    if (!isSending) {
      isSending = true;
      isPaused = false;
      // Reset counter for the new session.
      linesSentThisSession = 0;
      updatePlayPauseButton(true);
      updateAppStateDisplay();
      logStatus('Sending started...');
      startSending();
    // Case 2: Toggle pause/resume state if sending is already active.
    } else {
      isPaused = !isPaused;
        // Subcase 2a: Pause the sending process.
        if (isPaused) {
        updatePlayPauseButton(false);
        updateAppStateDisplay();
        logStatus(`Sending paused. Lines sent this session: ${linesSentThisSession}`);
        // Reset counter after pausing.
        linesSentThisSession = 0;
        clearInterval(sendInterval);
      } else {
        // Reset counter before resuming.
        linesSentThisSession = 0;
        updatePlayPauseButton(true);
        updateAppStateDisplay();
        logStatus('Sending resumed...');
        startSending();
      }
    }
  });

  sendManualButton.addEventListener('click', () => {
    if (!isConnected) return;
    const linesPerInterval = parseInt(linesPerIntervalInput.value, 10);
    if (isNaN(linesPerInterval) || linesPerInterval < 1) {
        logStatus('Error: Invalid Lines per Interval.');
        return;
    }
    sendLines(linesPerInterval, true);
    updateAppStateDisplay('Stepped', 1500); // Show "Stepped" for 1.5 seconds
  });

  lineSlider.addEventListener('input', () => {
    if (csvLines.length === 0) return;
    currentLineIndex = parseInt(lineSlider.value, 10);
    updateLineInfo(false);
  });


  const handleSendingParamChange = () => {
    if (isSending && !isPaused) {
      clearInterval(sendInterval);
      startSending();
    }
  };

  linesPerIntervalInput.addEventListener('input', handleSendingParamChange);
  rateMsInput.addEventListener('input', handleSendingParamChange);

  // Clears all messages from the status log panel.
  clearStatusButton.addEventListener('click', () => {
    statusMessages.innerHTML = '';
    statusBuffer.length = 0;
    linesSentCount = 0;
    updateLinesSentCount();
  });
  // Toggle sort order for status messages
  if (toggleSortOrderButton) {
    toggleSortOrderButton.addEventListener('click', () => {
      statusOrder = statusOrder === 'ascending' ? 'descending' : 'ascending';
      const isAscending = statusOrder === 'ascending';
      toggleSortOrderButton.dataset.order = statusOrder;
      toggleSortOrderButton.title = `Order: ${isAscending ? 'Ascending' : 'Descending'}`;
      // swap icon
      toggleSortOrderButton.innerHTML = `<div class="button-icon ${isAscending ? 'icon-ascending' : 'icon-descending'}"></div>`;
      // re-render from buffer
      renderStatusMessages();
    });
  }

  function renderStatusMessages() {
    if (!statusMessages) return;
    statusMessages.innerHTML = '';
    const entries = statusOrder === 'ascending' ? statusBuffer : [...statusBuffer].reverse();
    for (const html of entries) {
      statusMessages.innerHTML += html;
    }
    // maintain autoscroll behavior by scrolling to bottom for ascending, to top for descending
    if (statusOrder === 'ascending') {
      statusMessages.scrollTop = statusMessages.scrollHeight;
    } else {
      statusMessages.scrollTop = 0;
    }
  }

  toggleGestureReportButton.addEventListener('click', () => {
    const isEnabled = document.body.classList.toggle('show-gestures');
    toggleGestureReportButton.setAttribute('data-enabled', isEnabled.toString());
    const status = isEnabled ? 'shown' : 'hidden';
    logStatus(`Report camera gesture ${status}`);

    // Show or hide gesture displays based on both the toggle and camera state
    const shouldShowGestures = isEnabled && isCameraOn;
    if (lastGestureReceived) {
      lastGestureReceived.style.display = shouldShowGestures ? 'block' : 'none';
    }
    if (liveGestureReceived) {
      liveGestureReceived.style.display = shouldShowGestures ? 'block' : 'none';
    }
  });

  // Toggle hand gesture logging button event listener
  toggleGestureLoggingButton.addEventListener('click', () => {
    isGestureLoggingEnabled = !isGestureLoggingEnabled;
    toggleGestureLoggingButton.setAttribute('data-enabled', isGestureLoggingEnabled.toString());
    
    const status = isGestureLoggingEnabled ? 'enabled' : 'disabled';
    logStatus(`Hand gesture logging ${status}`);
  });

  // Toggle microphone logging button event listener
  toggleMicLoggingButton.addEventListener('click', () => {
    isMicLoggingEnabled = !isMicLoggingEnabled;
    window.isMicLoggingEnabled = isMicLoggingEnabled; // Update global variable
    toggleMicLoggingButton.setAttribute('data-enabled', isMicLoggingEnabled.toString());
    
    // Update offline speech status section visibility
    const offlineSpeechStatus = document.querySelector('.offline-speech-status');
    if (offlineSpeechStatus) {
      const shouldShow = isMicLoggingEnabled;
      offlineSpeechStatus.style.display = shouldShow ? 'flex' : 'none';
    }
    
    const status = isMicLoggingEnabled ? 'enabled' : 'disabled';
    logStatus(`Microphone logging ${status}`);
  });

  toggleStatusLog.addEventListener('click', () => {
    const isEnabled = toggleStatusLog.dataset.enabled !== 'true';
    toggleStatusLog.dataset.enabled = isEnabled.toString();
    statusArea.classList.toggle('hidden', !isEnabled);
    
    // Add/remove class to disable resizer when status area is hidden
    document.body.classList.toggle('status-area-disabled', !isEnabled);
    
    window.api.saveStatusAreaVisibility(isEnabled);
    
    const isCompact = document.body.classList.contains('compact');

    if (!isCompact) {
      if (!isEnabled) {
        // hiding
        lastSplitterPosition = controlsWrapper.style.flexBasis;
        controlsWrapper.style.flexBasis = '100%';
      } else {
        // showing
        controlsWrapper.style.flexBasis = lastSplitterPosition;
      }
    }
  });

  toggleConnectionControls.addEventListener('click', () => {
    const isEnabled = toggleConnectionControls.dataset.enabled !== 'true';
    toggleConnectionControls.dataset.enabled = isEnabled.toString();
    connectionControlsGroup.classList.toggle('hidden', !isEnabled);
  });

  // ─── Command Line Interface ───────────────────────────────────────────────
  const cliBtn = document.getElementById('cli-btn');
  if (cliBtn) {
    cliBtn.addEventListener('click', () => {
      window.api.showCommandLineDialog();
    });
  }

  // ─── Velocity Login / Feed Picker ─────────────────────────────────────────
  const velocityLoginBtn = document.getElementById('velocity-login-btn');
  const authBadge = document.getElementById('auth-badge');

  if (velocityLoginBtn) {
    velocityLoginBtn.addEventListener('click', () => {
      window.api.openVelocityLogin();
    });
  }

  if (authBadge) {
    const toggleAuthBadge = (event) => {
      event.stopPropagation();
      if (!velocityAuthState.hasToken || velocityAuthState.error) return;
      setVelocityTokenSending(!velocityAuthState.tokenSendingEnabled);
    };
    authBadge.addEventListener('click', toggleAuthBadge);
    authBadge.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleAuthBadge(event);
      }
    });
    const authPopover = document.getElementById('auth-badge-popover');
    if (authPopover) {
      authPopover.addEventListener('click', (event) => event.stopPropagation());
    }
  }

  // When a feed is applied from the login dialog, auto-populate the UI
  window.api.onFeedApplied((item) => {
    if (!item) return;
    updateAuthFromVelocityItem(item);

    // Token-only mode: authenticate without changing connection settings
    if (item.tokenOnly) {
      logStatus('🔑 Velocity token applied — using your own connection settings');
      return;
    }

    const type = item.feedType || '';

    // Map feed type to connection mode
    if (type === 'grpc') {
      connectionTypeSelect.value = 'grpc-client';
      connectionTypeSelect.dispatchEvent(new Event('change'));
      // Parse URL for host
      if (item.url) {
        ipAddressInput.value = item.url.replace(/^https?:\/\//, '').split(':')[0].split('/')[0];
        portInput.value = '443';
      }
      if (item.headerPath) {
        grpcHeaderPathInput.value = item.headerPath;
      }
      // Enable TLS for gRPC Velocity feeds
      if (grpcTlsCheckbox) grpcTlsCheckbox.checked = true;
      if (grpcTlsCheckbox) grpcTlsCheckbox.dispatchEvent(new Event('change'));
    } else if (type === 'http-receiver') {
      connectionTypeSelect.value = 'http-client';
      connectionTypeSelect.dispatchEvent(new Event('change'));
      if (item.url) {
        try {
          const u = new URL(item.url);
          ipAddressInput.value = u.hostname;
          portInput.value = u.port || (u.protocol === 'https:' ? '443' : '80');
          if (httpPathInput) httpPathInput.value = u.pathname || '/';
          if (httpTlsCheckbox) httpTlsCheckbox.checked = u.protocol === 'https:';
        } catch (_) {
          ipAddressInput.value = item.url;
        }
      }
      // Set format if available
      if (item.format && httpFormatSelect) {
        const fmtMap = { 'delimited': 'delimited', 'json': 'json', 'geojson': 'geo-json', 'esrijson': 'esri-json', 'xml': 'xml' };
        const mapped = fmtMap[item.format.toLowerCase()] || 'delimited';
        httpFormatSelect.value = mapped;
      }
    } else if (type === 'websocket') {
      connectionTypeSelect.value = 'ws-client';
      connectionTypeSelect.dispatchEvent(new Event('change'));
      if (item.url) {
        try {
          const u = new URL(item.url);
          ipAddressInput.value = u.hostname;
          portInput.value = u.port || (u.protocol === 'wss:' ? '443' : '80');
          if (wsPathInput) wsPathInput.value = u.pathname || '/';
          if (wsTlsCheckbox) wsTlsCheckbox.checked = u.protocol === 'wss:';
        } catch (_) {
          ipAddressInput.value = item.url;
        }
      }
      if (item.format && wsFormatSelect) {
        const fmtMap = { 'delimited': 'delimited', 'json': 'json', 'geojson': 'geo-json', 'esrijson': 'esri-json', 'xml': 'xml' };
        wsFormatSelect.value = fmtMap[item.format.toLowerCase()] || 'delimited';
      }
    }

    logStatus('✓ Feed applied - ready to connect');
  });

  // Token refresh notification
  window.api.onTokenRefreshed((state) => {
    updateAuthBadge({ hasToken: true, expires: state && state.expires ? state.expires : velocityAuthState.expires, error: '' });
    logStatus('🔑 Velocity token refreshed');
  });

  window.api.onTokenError((msg) => {
    logStatus(`⚠️ Velocity token refresh failed: ${msg}`);
    updateAuthBadge({ hasToken: true, error: msg || 'Unknown token refresh error' });
  });

  if (window.api.onTokenState) {
    window.api.onTokenState((state) => {
      if (!state) return;
      updateAuthBadge({
        hasToken: Boolean(state.hasToken),
        tokenSendingEnabled: Boolean(state.tokenSendingEnabled),
        expires: state.expires || velocityAuthState.expires,
      });
    });
  }

  window.api.onLoadStatusAreaVisibility((isVisible) => {
    initialStatusVisibility = (isVisible === undefined) ? true : isVisible;
    toggleStatusLog.dataset.enabled = initialStatusVisibility.toString();
    statusArea.classList.toggle('hidden', !initialStatusVisibility);
    
    // Add/remove class to disable resizer when status area is hidden on load
    document.body.classList.toggle('status-area-disabled', !initialStatusVisibility);

    applyInitialSplitterPosition();
  });

    // --- IPC Handlers ---
  // Listens for events and data sent from the main process.
  window.api.onLogStatus((message) => logStatus(message));

  window.api.onConnectionStatusChanged((status, message) => {
    logStatus(message);
    if (status === 'authenticated') {
      updateAppStateDisplay('Signed in', 1500);
      return;
    }
    if (status === 'room') {
      updateAppStateDisplay('In room', 1500);
      return;
    }
    // Extract the tlsInfo detail (embedded after '\n  ' by main.js) and build a tooltip.
    // Clear it when disconnecting so a stale tooltip is never shown.
    if (status === 'connected') {
      const detailMatch = message && message.match(/\n\s+(.+)/);
      currentTlsTooltip = detailMatch ? tlsInfoToTooltip(detailMatch[1].trim()) : '';
    } else if (status === 'disconnected') {
      currentTlsTooltip = '';
    }
    handleConnectionStatusChange(status);
  });

  window.api.onSetTheme((_event, theme) => {
    themeSelect.value = theme;
    applyTheme(theme);
  });

  window.api.onSetFontSize((fontSize) => {
    statusMessages.style.fontSize = fontSize;
    window.api.saveFontSettings({ fontSize });
  });

  window.api.onSetFontFamily((fontFamily) => {
    statusMessages.style.fontFamily = fontFamily;
    window.api.saveFontSettings({ fontFamily });
  });

  window.api.onLoadFileOnStartup((filePath) => {
    logStatus(`Attempting to load file from startup argument: ${filePath}`);
    loadFile(filePath);
  });

  // Apply CLI presets for UI prepopulation
  if (window.api.onCliPresets) {
    window.api.onCliPresets((presets) => {
      if (!presets) return;
      // CLI prepopulation is a programmatic fill, not a manual edit, so it
      // must not flip the preset indicator to "Custom (modified)".
      applyingPresetValues = true;
      try {
        applyCliPresets(presets);
      } finally {
        applyingPresetValues = false;
      }
    });
  }

  function applyCliPresets(presets) {
      // Build the connection type string (e.g. 'grpc-client')
      if (presets.protocol || presets.mode) {
        const p = (presets.protocol || 'tcp').toLowerCase();
        const m = (presets.mode || 'server').toLowerCase();
        connectionTypeSelect.value = `${p}-${m}`;
        connectionTypeSelect.dispatchEvent(new Event('change'));
      }
      if (presets.ip !== undefined) document.getElementById('ip-address').value = presets.ip;
      if (presets.port !== undefined) document.getElementById('port').value = presets.port;
      if (presets.grpcSerialization !== undefined) grpcSerializationSelect.value = presets.grpcSerialization;
      if (presets.grpcSendMethod !== undefined) grpcSendMethodSelect.value = presets.grpcSendMethod;
      if (presets.grpcHeaderPathKey !== undefined) grpcHeaderPathKeyInput.value = presets.grpcHeaderPathKey;
      if (presets.grpcHeaderPath !== undefined) grpcHeaderPathInput.value = presets.grpcHeaderPath;
      if (presets.useTls !== undefined) {
        grpcTlsCheckbox.checked = presets.useTls === true || presets.useTls === 'true';
        grpcTlsCheckbox.dispatchEvent(new Event('change'));
      }
      if (presets.tlsCaPath) document.getElementById('grpc-tls-ca-path').value = presets.tlsCaPath;
      if (presets.tlsCertPath) document.getElementById('grpc-tls-cert-path').value = presets.tlsCertPath;
      if (presets.tlsKeyPath) document.getElementById('grpc-tls-key-path').value = presets.tlsKeyPath;

      // HTTP presets
      if (presets.httpFormat !== undefined && httpFormatSelect) {
        httpFormatSelect.value = presets.httpFormat;
        httpFormatSelect.dispatchEvent(new Event('change'));
      }
      if (presets.httpTls !== undefined && httpTlsCheckbox) {
        httpTlsCheckbox.checked = presets.httpTls === true || presets.httpTls === 'true';
        httpTlsCheckbox.dispatchEvent(new Event('change'));
      }
      if (presets.httpPath !== undefined && httpPathInput) httpPathInput.value = presets.httpPath;
      if (presets.httpTlsCaPath) { const el = document.getElementById('http-tls-ca-path'); if (el) el.value = presets.httpTlsCaPath; }
      if (presets.httpTlsCertPath) { const el = document.getElementById('http-tls-cert-path'); if (el) el.value = presets.httpTlsCertPath; }
      if (presets.httpTlsKeyPath) { const el = document.getElementById('http-tls-key-path'); if (el) el.value = presets.httpTlsKeyPath; }

      // WebSocket presets
      const wsFormatSel = document.getElementById('ws-format');
      const wsTlsChk = document.getElementById('ws-tls');
      if (presets.wsFormat !== undefined && wsFormatSel) {
        wsFormatSel.value = presets.wsFormat;
        wsFormatSel.dispatchEvent(new Event('change'));
      }
      if (presets.wsTls !== undefined && wsTlsChk) {
        wsTlsChk.checked = presets.wsTls === true || presets.wsTls === 'true';
        wsTlsChk.dispatchEvent(new Event('change'));
      }
      if (presets.wsPath !== undefined) { const el = document.getElementById('ws-path'); if (el) el.value = presets.wsPath; }
      if (presets.wsTlsCaPath) { const el = document.getElementById('ws-tls-ca-path'); if (el) el.value = presets.wsTlsCaPath; }
      if (presets.wsTlsCertPath) { const el = document.getElementById('ws-tls-cert-path'); if (el) el.value = presets.wsTlsCertPath; }
      if (presets.wsTlsKeyPath) { const el = document.getElementById('ws-tls-key-path'); if (el) el.value = presets.wsTlsKeyPath; }
      if (presets.wsSubscriptionMsg !== undefined) { const el = document.getElementById('ws-subscription-msg'); if (el) el.value = presets.wsSubscriptionMsg; }
      if (presets.wsIgnoreFirstMsg !== undefined) { const el = document.getElementById('ws-ignore-first-msg'); if (el) el.checked = presets.wsIgnoreFirstMsg === true || presets.wsIgnoreFirstMsg === 'true'; }
      if (presets.wsHeaders !== undefined) { const el = document.getElementById('ws-headers'); if (el) el.value = presets.wsHeaders; }

      // XMPP presets
      const applyXmppText = (key, id) => {
        if (presets[key] === undefined) return;
        const el = document.getElementById(id);
        if (el) el.value = presets[key] === null ? '' : presets[key];
      };
      const applyXmppCheck = (key, id) => {
        if (presets[key] === undefined) return;
        const el = document.getElementById(id);
        if (el) el.checked = presets[key] === true || presets[key] === 'true';
      };
      if (presets.xmppConversation !== undefined && xmppConversationSelect) {
        xmppConversationSelect.value = presets.xmppConversation;
        xmppConversationSelect.dispatchEvent(new Event('change'));
      }
      if (presets.xmppTlsPolicy !== undefined && xmppTlsPolicySelect) {
        xmppTlsPolicySelect.value = presets.xmppTlsPolicy;
        xmppTlsPolicySelect.dispatchEvent(new Event('change'));
      }
      applyXmppText('xmppDomain', 'xmpp-domain');
      applyXmppText('xmppTlsCaPath', 'xmpp-tls-ca-path');
      applyXmppText('xmppTlsCertPath', 'xmpp-tls-cert-path');
      applyXmppText('xmppTlsKeyPath', 'xmpp-tls-key-path');
      applyXmppText('xmppUsername', 'xmpp-username');
      applyXmppText('xmppPassword', 'xmpp-password');
      applyXmppText('xmppResource', 'xmpp-resource');
      applyXmppText('xmppExternalUsername', 'xmpp-external-username');
      applyXmppText('xmppExternalPassword', 'xmpp-external-password');
      applyXmppText('xmppDestination', 'xmpp-destination');
      applyXmppText('xmppRoom', 'xmpp-room');
      applyXmppText('xmppNickname', 'xmpp-nickname');
      applyXmppText('xmppRoomPassword', 'xmpp-room-password');
      applyXmppText('xmppConnectTimeoutMs', 'xmpp-connect-timeout');
      applyXmppText('xmppReplyTimeoutMs', 'xmpp-reply-timeout');
      applyXmppText('xmppPingIntervalMs', 'xmpp-ping-interval');
      applyXmppText('xmppReconnectDelayMs', 'xmpp-reconnect-delay');
      applyXmppCheck('xmppAllowUnverifiedTls', 'xmpp-allow-unverified');
      applyXmppCheck('xmppAllowRemote', 'xmpp-allow-remote');
      const unverifiedPresetIds = {
        allowUnverifiedTls: 'grpc-allow-unverified',
        httpAllowUnverifiedTls: 'http-allow-unverified',
        wsAllowUnverifiedTls: 'ws-allow-unverified',
      };
      Object.entries(unverifiedPresetIds).forEach(([key, id]) => {
        const element = document.getElementById(id);
        if (presets[key] !== undefined && element) {
          element.checked = presets[key] === true || presets[key] === 'true';
        }
      });
      updateXmppOptionsVisibility();
      updateUnverifiedTlsVisibility();
      updateAdvancedDisclosureVisibility();

      if (presets.intervalMs !== undefined) document.getElementById('rate-ms').value = presets.intervalMs;
      if (presets.linesPerInterval !== undefined) document.getElementById('lines-per-interval').value = presets.linesPerInterval;
      if (presets.loop !== undefined) {
        const shouldLoop = presets.loop === true || presets.loop === 'true';
        const isLooping = toggleLoopButton && toggleLoopButton.classList.contains('active');
        if (shouldLoop !== isLooping && toggleLoopButton) toggleLoopButton.click();
      }
  }

  // Listen for saved theme from main process
  if (window.api && window.api.onLoadSavedTheme) {
    window.api.onLoadSavedTheme((savedTheme) => {
      if (savedTheme) {
        themeSelect.value = savedTheme;
        applyTheme(savedTheme);
      }
      // Mark initialization as complete after theme is loaded
      isInitializing = false;
    });
  } else {
    // If no saved theme handler, mark initialization complete
    isInitializing = false;
  }

    // --- Core Functions ---
  // Contains the main logic for file handling, UI updates, and data sending.

    /**
   * Loads and processes a CSV file selected by the user.
   * @param {string} filePath - The absolute path to the file.
   */
  async function loadFile(filePath) {
    try {
      const fileName = filePath.split(/[\\/]/).pop();
      filePathSpan.textContent = fileName;
      filePathSpan.title = filePath;
      logStatus(`Selected file: ${filePath}`);
      const lines = await window.api.readCsvFile(filePath);
      if (lines && lines.length > 0) {
        csvLines = lines;
        currentLineIndex = 0;
        linesSentCount = 0;
        updateLinesSentCount();
        updateLineInfo();
        logStatus(`Loaded ${csvLines.length} lines from file.`);
        connectButton.disabled = false;
        sendManualButton.disabled = true; // Disabled until connected
        lineSlider.disabled = false;
      } else {
        logStatus('File is empty or could not be read.');
        connectButton.disabled = true;
        lineSlider.disabled = true;
      }
    } catch (error) {
      logStatus(`Error selecting or reading file: ${error.message}`);
      window.api.showErrorInDialog(new Error(`Error selecting or reading file: ${error.message}`));
    }
  }

    /**
   * Updates the application state based on connection status.
   * @param {string} status - The connection status (e.g., 'connected', 'disconnected', 'connecting').
   */
  function handleConnectionStatusChange(status) {
    switch (status) {
      case 'connected':
        isConnecting = false;
        isConnected = true;
        toggleConnectionInputs(true);
        updateAppStateDisplay();
        break;
      case 'disconnected':
        isConnecting = false;
        isConnected = false;
        isSending = false;
        isPaused = false;
        clearInterval(sendInterval);
        toggleConnectionInputs(false);
        toggleSendingControls(false);
        updateAppStateDisplay();
        break;
      case 'connecting':
        isConnecting = true;
        isConnected = false;
        connectButton.disabled = true;
        disconnectButton.disabled = false;
        setXmppControlsLocked(true);
        updateAppStateDisplay('Connecting');
        break;
    }
  }

    /**
   * Sends a specified number of lines from the CSV data.
   * Handles looping back to the start if the end of the file is reached and looping is enabled.
   * @param {number} count - The number of lines to send.
   * @param {boolean} [logEachLine=false] - Whether to log each sent line to the status panel.
   */
  function sendLines(count, logEachLine = false) {
    if (currentLineIndex >= csvLines.length) {
      if (isLooping) {
        logStatus('End of file reached. Looping back to the beginning.');
        currentLineIndex = 0;
      } else {
        logStatus('End of file reached.');
        if (isSending) playPauseButton.click();
        return;
      }
    }
    const linesLeft = csvLines.length - currentLineIndex;
    const numToSend = Math.min(count, linesLeft);
    for (let i = 0; i < numToSend; i++) {
      const line = csvLines[currentLineIndex];
      window.api.sendData(line);
      if (logEachLine) {
        logStatus(`Sent: ${line}`);
      }
      currentLineIndex++;
      linesSentCount++;
      linesSentThisSession++;
    }
    updateLineInfo();
    updateLinesSentCount();
  }

    /**
   * Updates the UI to display the current line number and a preview of the line content.
   * @param {boolean} [updateSlider=true] - Whether to update the slider's position.
   */
  function updateLineInfo(updateSlider = true) {
    const totalLines = csvLines.length;
    lineSlider.max = totalLines > 0 ? totalLines - 1 : 0;

    if (totalLines === 0) {
      lineInfoDisplay.textContent = '0 / 0';
      lineSlider.value = 0;
      return;
    }

    if (updateSlider) {
      lineSlider.value = currentLineIndex;
    }

    // The text content should show the 1-based index for the user
    const displayIndex = currentLineIndex + 1;

    // Update the text display
    const lineInfoText = `${displayIndex} / ${totalLines}`;
    lineInfoDisplay.textContent = lineInfoText;

    const lineContent = csvLines[currentLineIndex] || '-';
    linePreviewText.textContent = lineContent;
    linePreviewText.title = lineContent;
  }

    /**
   * Updates the 'Lines Sent' counter in the UI.
   */
  function updateLinesSentCount() {
    linesSentCountSpan.textContent = linesSentCount;
  }

    /**
   * Starts the automated process of sending data at a specified interval.
   */
  function startSending() {
    const linesPerInterval = parseInt(linesPerIntervalInput.value, 10);
    const rateMs = parseInt(rateMsInput.value, 10);
    if (isNaN(linesPerInterval) || linesPerInterval < 1 || isNaN(rateMs) || rateMs < 1) {
      logStatus('Error: Invalid sending parameters.');
      return;
    }
    sendInterval = setInterval(() => sendLines(linesPerInterval), rateMs);
  }

  function toggleConnectionInputs(connected) {
    connectButton.disabled = connected || csvLines.length === 0;
    disconnectButton.disabled = !connected;
    selectFileButton.disabled = connected;
    connectionTypeSelect.disabled = connected;
    grpcSerializationSelect.disabled = connected;
    grpcSendMethodSelect.disabled = connected;
    grpcHeaderPathKeyInput.disabled = connected;
    grpcTlsCheckbox.disabled = connected;
    grpcHeaderPathInput.disabled = connected;
    httpFormatSelect.disabled = connected;
    httpTlsCheckbox.disabled = connected;
    httpPathInput.disabled = connected;
    document.getElementById('ip-address').disabled = connected;
    document.getElementById('port').disabled = connected;
    // A preset only pre-fills fields, so it is locked while a connection owns
    // them, together with the explicit certificate-verification bypasses.
    [connectionPresetSelect, grpcAllowUnverifiedCheckbox, httpAllowUnverifiedCheckbox, wsAllowUnverifiedCheckbox]
      .forEach((control) => { if (control) control.disabled = connected; });
    setXmppControlsLocked(connected);
    
    // Enable sending controls only if connected and file is loaded
    playPauseButton.disabled = !connected || csvLines.length === 0;
    sendManualButton.disabled = !connected || csvLines.length === 0;
  }

  function setXmppControlsLocked(locked) {
    document.querySelectorAll('#extra-options-body input[id^="xmpp-"], #extra-options-body select[id^="xmpp-"]')
      .forEach((control) => {
        if (control === xmppCopyPasswordCheckbox) return;
        control.disabled = locked;
      });
    const canCopy = isConnected && connectionTypeSelect.value === 'xmpp-server';
    if (xmppCopySettingsButton) xmppCopySettingsButton.disabled = !canCopy;
    if (xmppCopyPasswordCheckbox) {
      xmppCopyPasswordCheckbox.disabled = !canCopy;
      if (!canCopy) xmppCopyPasswordCheckbox.checked = false;
    }
  }
  
  function toggleSendingControls(sending) {
    updatePlayPauseButton(false);
    playPauseButton.disabled = true;
    sendManualButton.disabled = true;
  }

  function logStatus(message) {
    const timestamp = new Date().toLocaleTimeString();
    const entryHtml = `<div>[${timestamp}] ${message}</div>`;
    statusBuffer.push(entryHtml);
    // append in correct place depending on order to avoid full re-render on each log
    if (statusOrder === 'ascending') {
      statusMessages.insertAdjacentHTML('beforeend', entryHtml);
      statusMessages.scrollTop = statusMessages.scrollHeight;
    } else {
      statusMessages.insertAdjacentHTML('afterbegin', entryHtml);
      // keep view anchored to top for descending so newest stays visible
      statusMessages.scrollTop = 0;
    }
  }

  // Expose logStatus globally for use by other scripts
  window.logStatus = logStatus;
  
  // --- Initial State ---
  // Theme will be loaded from config via IPC, set a temporary fallback
  // The saved theme from config will override this when received
  themeSelect.value = 'dark';
  applyTheme('dark');

  handleConnectionStatusChange('disconnected');
  // Use toggleConnectionInputs to properly set initial button states based on current conditions
  toggleConnectionInputs(false);

  // Ensure gesture text is hidden by default on startup
  if (lastGestureReceived) lastGestureReceived.style.display = 'none';
  if (liveGestureReceived) liveGestureReceived.style.display = 'none';

  // --- Context Menu --- 
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.api.showContextMenu();
  });
  // Listen for compact/full view toggle from main process
  if (toggleViewButton) {
    toggleViewButton.addEventListener('click', () => {
      window.api.toggleCompactView();
    });
  }

  const handleSetCompactView = async (_, isCompact, splitterPosition) => {
    document.body.classList.toggle('compact', isCompact);

    // If switching to compact view, turn off camera and mic if they are on.
    if (isCompact) {
      if (isCameraOn) {
        toggleCameraButton.click(); // This will trigger the existing logic to turn off the camera
      }
      if (isMicOn) {
        toggleMicButton.click(); // This will trigger the existing logic to turn off the mic
      }
    }

    // Update camera and microphone button visibility based on compact mode
    // We need to re-apply the support state to respect compact mode
    if (window.api && window.api.getCameraSupportState) {
      const cameraSupportState = await window.api.getCameraSupportState();
      if (cameraSupportState !== undefined) {
        toggleCameraSupport(cameraSupportState);
      }
    }
    if (window.api && window.api.getMicrophoneSupportState) {
      const microphoneSupportState = await window.api.getMicrophoneSupportState();
      if (microphoneSupportState !== undefined) {
        toggleMicrophoneSupport(microphoneSupportState);
      }
    }

    // Update tooltip for the view button
    if (toggleViewButton) {
      toggleViewButton.title = isCompact ? 'Switch to Full View' : 'Switch to Compact View';
    }

    // Dynamically update the main title
    if (appTitle) {
      appTitle.textContent = isCompact ? 'Simulator' : 'ArcGIS Velocity Simulator';
    }

    if (isCompact) {
      // When in compact view, apply the position sent from the main process.
      if (splitterPosition) {
        controlsWrapper.style.flexBasis = splitterPosition;
      }
    } else {
      // When switching back to full view, explicitly get the correct splitter position.
      if (window.api && window.api.getFullViewDimensions) {
        const fullViewDims = await window.api.getFullViewDimensions();
        if (fullViewDims && fullViewDims.splitterPosition) {
          controlsWrapper.style.flexBasis = fullViewDims.splitterPosition;
        }
      }
    }

    // Force the resizer to re-render to apply the new orientation correctly.
    if (resizer) {
      resizer.style.display = 'none';
      void resizer.offsetWidth; // Trigger reflow.
      resizer.style.display = '';
    }

    isCompactViewInitialized = true;
    applyInitialSplitterPosition();
  };

  if (window.api && window.api.onSetCompactView) {
    window.api.onSetCompactView(handleSetCompactView);
  } else if (window.api && window.api.on) {
    // Fallback for older preload versions if any
    window.api.on('set-compact-view', handleSetCompactView);
  }

  // --- Lazy Loader for Gesture Libraries (TFJS, Handpose, Fingerpose) ---
  let gestureLibsLoaded = false;
  let gestureLibsLoadingPromise = null;

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const absolute = new URL(src, document.baseURI).href;
      const existing = Array.from(document.scripts).some(s => s.src === absolute);
      if (existing) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = absolute;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load script: ' + src));
      document.head.appendChild(script);
    });
  }

  async function ensureGestureLibsLoaded() {
    if (gestureLibsLoaded) return;
    if (gestureLibsLoadingPromise) return gestureLibsLoadingPromise;

    gestureLibsLoadingPromise = (async () => {
      if (!window.tf) {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs/dist/tf.min.js');
      }
      if (!window.handpose) {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/handpose/dist/handpose.min.js');
      }
      if (!window.fp) {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/fingerpose@0.1.0/dist/fingerpose.min.js');
      }
      gestureLibsLoaded = true;
    })();

    return gestureLibsLoadingPromise;
  }

  // --- Lazy Loader for Voice Recognition (Web Speech API) and Offline Speech (Web Audio API) ---
  let voiceLibsLoaded = false;
  let voiceLibsLoadingPromise = null;

  async function ensureVoiceLibsLoaded() {
    if (voiceLibsLoaded) return;
    if (voiceLibsLoadingPromise) return voiceLibsLoadingPromise;

    voiceLibsLoadingPromise = (async () => {
      // Load local scripts lazily when microphone is first turned on
      await loadExternalScript('voice.js');
      await loadExternalScript('simple-offline-speech.js');

      // Initialize offline speech UI and handlers once
      if (typeof window.initializeSimpleOfflineSpeech === 'function') {
        try {
          window.initializeSimpleOfflineSpeech();
        } catch (e) {
          console.error('Failed to initialize offline speech:', e);
        }
      }
      voiceLibsLoaded = true;
    })();

    return voiceLibsLoadingPromise;
  }

  // --- Gesture and Camera Controls ---
  toggleCameraButton.addEventListener('click', async () => {
    isCameraOn = !isCameraOn;
    if (isCameraOn) {
      try {
        // Load heavy gesture libraries on demand
        await ensureGestureLibsLoaded();
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        videoFeed.srcObject = stream;
        videoFeed.style.display = 'block';
        const playPromise = videoFeed.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((e) => {
            // If the user toggles the camera quickly, play() can be interrupted by a new load().
            // Avoid surfacing this as an unhandled rejection in the console.
            if (e && e.name === 'AbortError') return;
            console.warn('Video play failed:', e);
          });
        }

        // Wait for the video to be ready before starting gesture detection
        videoFeed.addEventListener('loadedmetadata', () => {
          window.initGestureDetection(videoFeed);
          if (document.body.classList.contains('show-gestures')) {
            lastGestureReceived.style.display = 'block';
            liveGestureReceived.style.display = 'block';
          }
          lastGestureReceived.textContent = '-';
          liveGestureReceived.textContent = '-';
        }, { once: true });
        toggleCameraButton.classList.add('active');
        logStatus('Camera on. Supported gestures: 👍 connect, 🤙 disconnect, 👊 play, 🖐️ pause, ✌️ step');
      } catch (err) {
        console.error('Error accessing camera:', err);
        logStatus('Error: Could not start camera or load gesture libraries.');
        isCameraOn = false;
      }
    } else {
      window.stopGestureDetection();
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      videoFeed.style.display = 'none';
      videoFeed.srcObject = null;
      lastGestureReceived.style.display = 'none';
      liveGestureReceived.style.display = 'none';
      lastGestureReceived.textContent = '-';
      liveGestureReceived.textContent = '-';
      toggleCameraButton.classList.remove('active');
      logStatus('Camera off.');
    }
  });

  // --- Voice and Gesture Command Handling ---
  let networkErrorLogged = false; // Flag to prevent logging network error multiple times
  
  toggleMicButton.addEventListener('click', async () => {
    isMicOn = !isMicOn;
    if (isMicOn) {
      // Reset the network error flag when starting a new microphone session
      networkErrorLogged = false;
      try {
        // Lazy load voice and offline speech modules on first use
        await ensureVoiceLibsLoaded();
        await window.startVoiceRecognition();
        toggleMicButton.classList.add('active');
        logStatus('Microphone (Web Speech API) on. Supported commands: connect, disconnect, play, start, pause, stop, step, switch, toggle view');
      } catch (error) {
        // If voice recognition fails, revert the mic state
        isMicOn = false;
        toggleMicButton.classList.remove('active');
        logStatus('❌ Failed to start microphone: ' + error.message);
      }
    } else {
      window.stopVoiceRecognition();
      toggleMicButton.classList.remove('active');
      logStatus('Microphone (Web Speech API) off.');
    }
  });

  toggleLoopButton.addEventListener('click', toggleLoop);



  document.addEventListener('voice-command-detected', (e) => {
    const command = e.detail;
    handleControlCommand(command, 'voice');
  });

  // Handle offline voice commands
  document.addEventListener('offline-voice-command-detected', (e) => {
    const { command, transcript, confidence, source } = e.detail;
    handleControlCommand(command, source);
  });



  // Handle microphone permission denied events
  document.addEventListener('microphone-permission-denied', (e) => {
    isMicOn = false;
    toggleMicButton.classList.remove('active');
    logStatus('❌ Microphone access denied. Please allow microphone permissions in your browser settings.');
  });

  // Handle speech network error events
  document.addEventListener('speech-network-error', (e) => {
    // Don't automatically turn off the mic - let the user control it
    // Just log the error message once and keep the button visible
    if (!networkErrorLogged) {
      logStatus('🌐 Web Speech API requires internet connection. Use the offline microphone button for local speech recognition.');
      networkErrorLogged = true;
    }
  });

  document.addEventListener('gesture-detected', (e) => {
    const { name, score } = e.detail;
    
    // Update last gesture received with emoji and text
    const emoji = gestureEmojis[name] || '❓';
    lastGestureReceived.textContent = `${emoji} ${name}`;
    
    handleControlCommand(name, 'gesture');
  });

  // Handle real-time gesture feedback (updates continuously as hand moves)
  document.addEventListener('gesture-realtime', (e) => {
    const { name, score, isConfident } = e.detail;
    
    if (!liveGestureReceived) return;
    
    if (name) {
      const emoji = gestureEmojis[name] || '❓';
      const confidenceIndicator = isConfident ? '✓' : '?';
      liveGestureReceived.textContent = `${emoji} ${name} ${confidenceIndicator}`;
      liveGestureReceived.style.opacity = isConfident ? '1.0' : '0.6';
    } else {
      liveGestureReceived.textContent = '-';
      liveGestureReceived.style.opacity = '0.4';
    }
  });

  function handleControlCommand(command, source) {
    // Only log commands if their respective logging is enabled
    const shouldLog = (source === 'gesture' && isGestureLoggingEnabled) || 
                      (source === 'voice' && isMicLoggingEnabled) || 
                      (source === 'offline' && isMicLoggingEnabled) || 
                      (source !== 'gesture' && source !== 'voice' && source !== 'offline');
    
    if (shouldLog) {
      logStatus(`Command received: ${command.replace('_', ' ')}`);
    }
    // Add a small delay to prevent rapid-fire events
    setTimeout(() => {
      switch (command) {
        case 'connect':
          connectButton.click();
          break;
        case 'disconnect':
          disconnectButton.click();
          break;
        case 'play':
        case 'start':
          if (!isSending || isPaused) {
            playPauseButton.click();
          }
          break;
        case 'pause':
        case 'stop':
          if (isSending && !isPaused) {
            playPauseButton.click();
          }
          break;
        case 'step':
          sendManualButton.click();
          break;
        case 'switch_views':
          toggleViewButton.click();
          break;
      }
    }, 200); // 200ms delay
  }

  /**
   * Toggles the continuous loop feature on or off.
   */
  function toggleLoop() {
    isLooping = !isLooping;
    updateLoopButtonState();
  }

  /**
   * Updates the visual state (style and tooltip) of the loop button.
   */
  function updateLoopButtonState() {
    if (isLooping) {
      toggleLoopButton.classList.add('active');
      toggleLoopButton.title = 'Disable Continuous Loop';
    } else {
      toggleLoopButton.classList.remove('active');
      toggleLoopButton.title = 'Enable Continuous Loop';
    }
  }

  // Handle keyboard shortcuts from main process
  window.api.onKeyboardShortcut((action) => {
    switch (action) {
      case 'connect':
        connectButton.click();
        break;
      case 'disconnect':
        disconnectButton.click();
        break;
      case 'play-pause':
        playPauseButton.click();
        break;
      case 'clear-status':
        clearStatusButton.click();
        break;
      case 'toggle-sort-order':
        if (toggleSortOrderButton) toggleSortOrderButton.click();
        break;
    }
  });

  // Handle camera support toggle from main process
  window.api.onToggleCameraSupport((isEnabled) => {
    toggleCameraSupport(isEnabled);
  });

  // Handle microphone support toggle from main process
  window.api.onToggleMicrophoneSupport((isEnabled) => {
    toggleMicrophoneSupport(isEnabled);
  });

  // --- Inspect Element pick mode ---
  // Activated by the "Inspect Element Mode" menu item (checkbox): changes cursor to a
  // crosshair and on the next click sends the coordinates to the main process, which calls
  // webContents.inspectElement(x, y) to highlight the element in DevTools.
  // Deactivated by toggling the menu item again, pressing Escape, or completing a pick.
  if (window.api && window.api.onEnterInspectMode) {
    let pickCleanup = null;

    function cancelPickMode() {
      if (!pickCleanup) return;
      pickCleanup();
      pickCleanup = null;
      document.body.style.cursor = '';
      if (window.api.inspectElementDone) window.api.inspectElementDone();
    }

    const onEscapeCancel = (e) => {
      if (e.key === 'Escape') cancelPickMode();
    };

    window.api.onEnterInspectMode(() => {
      document.body.style.cursor = 'crosshair';

      const onPick = (e) => {
        document.body.style.cursor = '';
        pickCleanup = null;
        document.removeEventListener('keydown', onEscapeCancel, { capture: true });
        window.api.inspectElement(e.clientX, e.clientY);
        e.stopImmediatePropagation();
        e.preventDefault();
      };

      pickCleanup = () => {
        document.removeEventListener('click', onPick, { capture: true });
        document.removeEventListener('keydown', onEscapeCancel, { capture: true });
      };

      document.addEventListener('click', onPick, { capture: true, once: true });
      document.addEventListener('keydown', onEscapeCancel, { capture: true });
    });

    // Main process toggled the checkbox off while pick mode was still pending
    if (window.api.onCancelInspectMode) {
      window.api.onCancelInspectMode(() => {
        if (pickCleanup) {
          pickCleanup();
          pickCleanup = null;
          document.body.style.cursor = '';
        }
      });
    }
  }

  // Initialize status bar with current app state
  if (appState) {
    updateAppStateDisplay();
  }

  // TLS badge: click toggles TLS when disconnected; otherwise click pins details.
  const tlsBadgeEl = document.getElementById('tls-badge');
  if (tlsBadgeEl) {
    const handleTlsBadgeActivation = (e) => {
      e.stopPropagation();
      const selected = getSelectedTlsControl();
      if (!selected || !selected.checkbox) return;
      if (!canToggleTlsFromFooter()) {
        tlsBadgeEl.classList.toggle('pinned');
        return;
      }
      selected.toggle();
      // Re-read the control so the log reflects the new state rather than the
      // value captured when the descriptor was created.
      const nowEnabled = Boolean(getSelectedTlsControl()?.isEnabled());
      logStatus(nowEnabled
        ? `🔒 TLS enabled for ${selected.protocol} ${selected.mode}`
        : `🔓 TLS disabled for ${selected.protocol} ${selected.mode}`);
      refreshTlsBadge();
    };
    tlsBadgeEl.addEventListener('click', handleTlsBadgeActivation);
    tlsBadgeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTlsBadgeActivation(e);
      }
    });
    document.addEventListener('click', () => tlsBadgeEl.classList.remove('pinned'));
    const tlsPopoverEl = document.getElementById('tls-badge-popover');
    if (tlsPopoverEl) {
      tlsPopoverEl.addEventListener('click', (e) => e.stopPropagation());
    }
  }

  // Initialize simple offline speech recognition
  if (typeof window.initializeSimpleOfflineSpeech === 'function') {
    window.initializeSimpleOfflineSpeech();
  }

  /**
   * Toggles camera support on or off, showing/hiding camera-related buttons
   * @param {boolean} isEnabled - Whether camera support should be enabled
   */
  function toggleCameraSupport(isEnabled) {
    const cameraButtons = [
      toggleCameraButton,
      toggleGestureReportButton,
      toggleGestureLoggingButton
    ];

    // Check if we're in compact mode
    const isCompact = document.body.classList.contains('compact');

    cameraButtons.forEach(button => {
      if (button) {
        // In compact mode, always hide camera buttons regardless of support state
        button.style.display = (isEnabled && !isCompact) ? 'flex' : 'none';
      }
    });

    // If turning off camera support and camera is on, turn off the camera
    if (!isEnabled && isCameraOn) {
      toggleCameraButton.click();
    }

    // Hide camera container if camera support is disabled or in compact mode
    const cameraContainer = document.querySelector('.camera-container');
    if (cameraContainer) {
      cameraContainer.style.display = (isEnabled && !isCompact) ? 'block' : 'none';
    }

    // Only log if this is not the initial setup
    if (cameraSupportInitialized) {
      // Removed status log message for camera support toggle
      //logStatus(`Camera support ${isEnabled ? 'enabled' : 'disabled'}`);
    }
    cameraSupportInitialized = true;
  }

  // Initialize camera support state (will be set by main process)
  let cameraSupportInitialized = false;

  /**
   * Toggles microphone support on or off, showing/hiding microphone-related buttons
   * @param {boolean} isEnabled - Whether microphone support should be enabled
   */
  function toggleMicrophoneSupport(isEnabled) {
    const offlineMicButton = document.getElementById('offline-mic-button');
    const microphoneButtons = [
      toggleMicButton,
      offlineMicButton,
      toggleMicLoggingButton
    ];

    // Check if we're in compact mode
    const isCompact = document.body.classList.contains('compact');

    microphoneButtons.forEach(button => {
      if (button) {
        // In compact mode, always hide microphone buttons regardless of support state
        button.style.display = (isEnabled && !isCompact) ? 'flex' : 'none';
      }
    });

    // If turning off microphone support and microphones are on, turn them off
    if (!isEnabled) {
      if (isMicOn) {
        toggleMicButton.click();
      }
      if (window.isOfflineSpeechActive && offlineMicButton) {
        offlineMicButton.click();
      }
    }

    // Only log if this is not the initial setup
    if (microphoneSupportInitialized) {
      // Removed status log message for microphone support toggle
      //logStatus(`Microphone support ${isEnabled ? 'enabled' : 'disabled'}`);
    }
    microphoneSupportInitialized = true;
  }

  // Initialize microphone support state (will be set by main process)
  let microphoneSupportInitialized = false;

  // --- Window Resize Handler ---
  // Handle window resize to auto-collapse status area when window becomes too narrow
  let resizeTimeout;
  const RESIZE_DEBOUNCE_DELAY = 150; // milliseconds
  
  window.addEventListener('resize', () => {
    // Debounce resize events to avoid excessive calculations
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      handleWindowResize();
    }, RESIZE_DEBOUNCE_DELAY);
  });

  function handleWindowResize() {
    const isCompact = document.body.classList.contains('compact');
    const statusLogEnabled = toggleStatusLog.dataset.enabled === 'true';
    
    // Only auto-collapse if status log is enabled and not already hidden
    if (!statusLogEnabled || statusArea.classList.contains('hidden')) {
      return;
    }
    
    const container = document.querySelector('.main-content');
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const minWindowSize = isCompact ? 400 : 600; // Minimum window size before auto-collapse
    const minStatusSize = 200; // Minimum status area size to keep visible
    
    if (isCompact) {
      // In compact view, check window height
      if (containerRect.height < minWindowSize) {
        // Auto-collapse vertically by setting controls to almost full height
        const newControlsHeight = containerRect.height - 30;
        controlsWrapper.style.flexBasis = `${newControlsHeight}px`;
      } else {
        // Ensure status area has minimum size if window is large enough
        const currentControlsHeight = controlsWrapper.getBoundingClientRect().height;
        const statusHeight = containerRect.height - currentControlsHeight - 5;
        
        if (statusHeight < minStatusSize && containerRect.height > minWindowSize + minStatusSize) {
          // Adjust controls to give status area minimum size
          const newControlsHeight = containerRect.height - minStatusSize - 5;
          controlsWrapper.style.flexBasis = `${newControlsHeight}px`;
        }
      }
    } else {
      // In full view, check window width
      if (containerRect.width < minWindowSize) {
        // Auto-collapse horizontally by setting controls to almost full width
        const newControlsWidth = containerRect.width - 30;
        controlsWrapper.style.flexBasis = `${newControlsWidth}px`;
      } else {
        // Ensure status area has minimum size if window is large enough
        const currentControlsWidth = controlsWrapper.getBoundingClientRect().width;
        const statusWidth = containerRect.width - currentControlsWidth - 5;
        
        if (statusWidth < minStatusSize && containerRect.width > minWindowSize + minStatusSize) {
          // Adjust controls to give status area minimum size
          const newControlsWidth = containerRect.width - minStatusSize - 5;
          controlsWrapper.style.flexBasis = `${newControlsWidth}px`;
        }
      }
    }
    
    // Update collapsed state after resize
    checkStatusAreaCollapsed();
    
    // Save the new position
    if (window.api && window.api.saveSplitterPosition) {
      window.api.saveSplitterPosition(controlsWrapper.style.flexBasis);
    }
  }
});
