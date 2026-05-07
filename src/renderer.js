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
  const httpFormatSelect = document.getElementById('http-format');
  const httpFormatGroup = document.getElementById('http-format-group');
  const httpTlsCheckbox = document.getElementById('http-tls');
  const httpTlsGroup = document.getElementById('http-tls-group');
  const httpTlsCaGroup = document.getElementById('http-tls-ca-group');
  const httpTlsCertGroup = document.getElementById('http-tls-cert-group');
  const httpTlsKeyGroup = document.getElementById('http-tls-key-group');
  const httpPathGroup = document.getElementById('http-path-group');
  const httpPathInput = document.getElementById('http-path');
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
  let isConnected = false; // Is there an active TCP/UDP connection?
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
  };

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
  const DEFAULT_PORTS = { tcp: 5565, udp: 5565, grpc: 5565, http: 8443, ws: 8443 };
  const HTTP_PORT_TLS_ON = 8443;
  const HTTP_PORT_TLS_OFF = 8080;
  let lastProtocolDefault = 5565;

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
  });

  grpcSerializationSelect.addEventListener('change', updateGrpcSerializationTooltip);
  updateGrpcSerializationTooltip();

  grpcSendMethodSelect.addEventListener('change', updateGrpcSendMethodTooltip);
  updateGrpcSendMethodTooltip();

  httpFormatSelect.addEventListener('change', updateHttpFormatTooltip);
  updateHttpFormatTooltip();

  wsFormatSelect.addEventListener('change', updateWsFormatTooltip);
  updateWsFormatTooltip();

  connectionTypeSelect.addEventListener('change', updateConnectionModeTooltip);
  updateConnectionModeTooltip();

  // Toggle TLS cert fields when TLS checkbox changes
  grpcTlsCheckbox.addEventListener('change', () => {
    const isGrpc = connectionTypeSelect.value.startsWith('grpc');
    const show = isGrpc && grpcTlsCheckbox.checked;
    grpcTlsCaGroup.style.display = show ? '' : 'none';
    grpcTlsCertGroup.style.display = show ? '' : 'none';
    grpcTlsKeyGroup.style.display = show ? '' : 'none';
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
  });

  // --- Extra Options collapsible toggle ---
  function getExtraOptionsProtocolLabel() {
    const val = connectionTypeSelect.value;
    if (val.startsWith('http')) return 'HTTP Options';
    if (val.startsWith('ws')) return 'WebSocket Options';
    if (val.startsWith('grpc')) return 'gRPC Options';
    return 'Protocol Options';
  }

  function syncExtraOptionsToggleState() {
    if (!extraOptionsToggleBtn) return;
    const label = getExtraOptionsProtocolLabel();
    const action = extraOptionsExpanded ? 'Collapse' : 'Expand';
    const tooltip = `${action} ${label.toLowerCase()} such as format, TLS, paths, and headers.`;
    if (extraOptionsLabel) extraOptionsLabel.textContent = label;
    extraOptionsToggleBtn.setAttribute('aria-expanded', extraOptionsExpanded ? 'true' : 'false');
    extraOptionsToggleBtn.title = tooltip;
    extraOptionsToggleBtn.setAttribute('aria-label', tooltip);
  }

  function updateExtraOptionsToggleRow() {
    const val = connectionTypeSelect.value;
    const hasExtras = val.startsWith('http') || val.startsWith('ws') || val.startsWith('grpc');
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
    if (/tls=off/i.test(raw)) {
      return 'TLS: off - connection is unsecure (plaintext, no encryption)';
    }
    if (/self-signed/i.test(raw)) {
      return 'TLS: self-signed - connection is encrypted but the server certificate is auto-generated and not CA-verified; peer identity is unverified';
    }
    if (/cert verification skipped/i.test(raw)) {
      return 'TLS: self-signed - connection is encrypted but certificate authority verification is skipped; peer identity is unverified';
    }
    if (/mtls|client.*cert|cert.*client/i.test(raw)) {
      return 'TLS: mTLS - mutual TLS; both client and server certificates are verified';
    }
    if (/custom certs/i.test(raw)) {
      return 'TLS: CA-verified - connection is encrypted and the certificate chain is validated against a custom CA';
    }
    if (/tls=on/i.test(raw)) {
      return 'TLS: on - connection is encrypted';
    }
    return raw;
  }

  // The TLS tooltip for the current connection, set on connect and cleared on disconnect.
  let currentTlsTooltip = '';

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
    if (/tls.*off|unsecure|plaintext/i.test(tooltip)) {
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
    badge.title = tooltip; // fallback native tooltip
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
    // Update TLS trust badge: visible when connected with a TLS-capable protocol
    updateTlsBadge(isConnected ? currentTlsTooltip : '');

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
    'connected': '🟢',
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
  connectButton.addEventListener('click', () => {
    if (isConnected) return;
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
    // HTTP-specific params
    const httpFormat = httpFormatSelect.value;
    const httpTls = httpTlsCheckbox.checked;
    const httpTlsCaPath = document.getElementById('http-tls-ca-path').value || undefined;
    const httpTlsCertPath = document.getElementById('http-tls-cert-path').value || undefined;
    const httpTlsKeyPath = document.getElementById('http-tls-key-path').value || undefined;
    const httpPath = httpPathInput.value || '/';
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
    // Reset session counter on new connection.
    linesSentThisSession = 0;
    const tlsLabel = protocol === 'grpc' ? (useTls ? ' tls=on' : ' tls=off') : '';
    const serLabel = protocol === 'grpc' ? ` [${serialization || 'protobuf'}]` : '';
    const methodLabel = protocol === 'grpc' ? ` ${grpcSendMethod === 'unary' ? 'unary' : 'streaming'}` : '';
    const headerLabel = protocol === 'grpc' && mode === 'client' ? ` ${headerPathKey}=${headerPath}` : '';
    const httpLabel = protocol === 'http' ? ` [${httpFormat}] ${httpTls ? 'tls=on' : 'tls=off'} path=${httpPath}` : '';
    const wsLabel = protocol === 'ws' ? ` [${wsFormat}] ${wsTls ? 'wss' : 'ws'} path=${wsPath}` : '';
    logStatus(`Connecting via ${protocol.toUpperCase()} ${mode} to ${ip}:${port}${serLabel}${methodLabel}${tlsLabel}${headerLabel}${httpLabel}${wsLabel}...`);
    handleConnectionStatusChange('connecting');
    window.api.connect({ protocol, mode, ip, port, grpcSerialization: serialization, grpcSendMethod, headerPathKey, headerPath, useTls, tlsCaPath, tlsCertPath, tlsKeyPath, httpFormat, httpTls, httpTlsCaPath, httpTlsCertPath, httpTlsKeyPath, httpPath, wsFormat, wsTls, wsTlsCaPath, wsTlsCertPath, wsTlsKeyPath, wsPath, wsSubscriptionMsg, wsIgnoreFirstMsg, wsHeaders });
  });

  // Terminates the active connection.
  disconnectButton.addEventListener('click', () => {
    if (!isConnected) return;
    linesSentThisSession = 0;
    // If data is being sent, pause it before disconnecting.
    if (isSending) {
      playPauseButton.click();
    }
    logStatus('Disconnecting...');
    window.api.disconnect();
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
  const authBadgeContent = document.getElementById('auth-badge-content');

  if (velocityLoginBtn) {
    velocityLoginBtn.addEventListener('click', () => {
      window.api.openVelocityLogin();
    });
  }

  // When a feed is applied from the login dialog, auto-populate the UI
  window.api.onFeedApplied((item) => {
    if (!item) return;
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

    // Show auth badge
    if (authBadge) {
      authBadge.style.display = '';
      if (authBadgeContent) {
        authBadgeContent.textContent = `Velocity Feed: ${item.label || item.id}\nAuth: ${item.authType || 'token'}`;
      }
    }

    logStatus('✓ Feed applied - ready to connect');
  });

  // Token refresh notification
  window.api.onTokenRefreshed(() => {
    logStatus('🔑 Velocity token refreshed');
  });

  window.api.onTokenError((msg) => {
    logStatus(`⚠️ Velocity token refresh failed: ${msg}`);
    if (authBadge) authBadge.style.display = '';
    if (authBadgeContent) authBadgeContent.textContent = `Token Error: ${msg}`;
  });

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

      if (presets.intervalMs !== undefined) document.getElementById('rate-ms').value = presets.intervalMs;
      if (presets.linesPerInterval !== undefined) document.getElementById('lines-per-interval').value = presets.linesPerInterval;
      if (presets.loop !== undefined) {
        const shouldLoop = presets.loop === true || presets.loop === 'true';
        const isLooping = toggleLoopButton && toggleLoopButton.classList.contains('active');
        if (shouldLoop !== isLooping && toggleLoopButton) toggleLoopButton.click();
      }
    });
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
        isConnected = true;
        toggleConnectionInputs(true);
        updateAppStateDisplay();
        break;
      case 'disconnected':
        isConnected = false;
        isSending = false;
        isPaused = false;
        clearInterval(sendInterval);
        toggleConnectionInputs(false);
        toggleSendingControls(false);
        updateAppStateDisplay();
        break;
      case 'connecting':
        isConnected = false;
        connectButton.disabled = true;
        disconnectButton.disabled = true;
        updateAppStateDisplay();
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
    
    // Enable sending controls only if connected and file is loaded
    playPauseButton.disabled = !connected || csvLines.length === 0;
    sendManualButton.disabled = !connected || csvLines.length === 0;
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

  // TLS badge click-to-pin handler
  const tlsBadgeEl = document.getElementById('tls-badge');
  if (tlsBadgeEl) {
    tlsBadgeEl.addEventListener('click', (e) => {
      tlsBadgeEl.classList.toggle('pinned');
      e.stopPropagation();
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

