# WebSocket transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The ArcGIS Velocity Simulator supports WebSocket (`ws://` and `wss://`) as a
transport protocol alongside TCP, UDP, HTTP, gRPC, and XMPP. It runs as either a
WebSocket client that connects to a remote endpoint or a WebSocket server that
broadcasts to every connected consumer.

This guide is written for users configuring a WebSocket session and for
developers extending the transport. It covers connection modes, data formats,
TLS, default ports, request paths, subscription messages, custom headers,
user-interface controls and their tooltips, the command-line parameters, and the
launch-configuration keys. General certificate concepts live in the [TLS and SSL
security](tls.md) guide.

## Table of contents

- [Connection modes](#connection-modes)
- [Format options](#format-options)
- [TLS (WSS)](#tls-wss)
- [Default ports](#default-ports)
- [WebSocket path](#websocket-path)
- [Subscription message](#subscription-message)
- [Ignore first message](#ignore-first-message)
- [Custom HTTP headers](#custom-http-headers)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [CLI parameters](#cli-parameters)
- [Metadata logging](#metadata-logging)
- [Launch configuration](#launch-configuration)
- [Related documentation](#related-documentation)

## Connection modes

| Mode | Description |
|------|-------------|
| WebSocket Client | Connects to a remote WebSocket server (ws:// or wss://) and sends data as text frames. |
| WebSocket Server | Starts a local WebSocket server that accepts incoming ws:// or wss:// connections and broadcasts data to all connected clients. |

Both roles are supported by the renderer-independent headless
`TransportManager`, reusing `src/ws-transport.js` for the same connect, send,
receive, recipient, and disconnect behavior as the UI.

Disconnect closes every connected client, then the WebSocket server, then the
underlying HTTP server, and only reports `disconnected` once the listening
socket has been released. Reconnecting on the same port immediately after that
message therefore succeeds. Each close is bounded by a short wait, so a client
that never answers the close handshake is terminated instead of stalling the
disconnect. When a port is already in use, connecting fails with a
`WebSocket server failed to bind on <host>:<port>` message rather than an
unhandled error.

## Format options

The WebSocket Format dropdown controls the Content-Type associated with each
message. These match the formats supported by ArcGIS Velocity TCP, HTTP, and
WebSocket feeds. **Delimited (CSV) is the default**, matching Velocity's
ordering:

| UI Label | Value | Content-Type | Description |
|----------|-------|--------------|-------------|
| Delimited (CSV) | `delimited` | `text/plain` | Each message is a comma-separated row of field values. **Default format.**. |
| JSON | `json` | `application/json` | Each message is a JSON object or array of features. |
| Esri JSON | `esri-json` | `application/json` | Each message uses the Esri Feature JSON schema. |
| GeoJSON | `geo-json` | `application/geo+json` | Each message is a GeoJSON FeatureCollection or Feature per RFC 7946. |
| XML | `xml` | `application/xml` | Each message is an XML payload. |

## TLS (WSS)

TLS is enabled by default (`Use TLS` checkbox checked), making the connection
use the secure `wss://` protocol. When unchecked, the unsecure `ws://` protocol
is used.

- **Client mode**: Uses the OS certificate store (macOS Keychain, Windows certificate store, or Linux CA bundles) plus Node.js bundled root certificates to verify the server. Custom CA, client cert, and key can be provided for mutual TLS or enterprise CAs.
- **Server mode**: Requires a TLS certificate and private key to be provided.

| Field | Description |
|-------|-------------|
| **CA cert path** | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store. |
| **TLS cert path** | Path to a client or server certificate file (PEM). Required for server-mode TLS. |
| **TLS key path** | Path to the private key file (PEM). Required for server-mode TLS. |
| **wsAllowUnverifiedTls** | Client mode only. Explicitly accept an unverified server certificate (default: `false`). The bypass applies to any host, not only localhost. |

## Default ports

| TLS State | Default Port | Protocol |
|-----------|-------------|----------|
| TLS On (WSS) | `8443` | `wss://` |
| TLS Off (WS) | `8080` | `ws://` |

WebSocket uses the same default ports as HTTP because the WebSocket handshake
begins as an HTTP Upgrade request.

## WebSocket path

The WS Path field (default `/`) specifies the URL path appended after the host
and port.

- **Server mode**: Only WebSocket upgrade requests matching this path exactly are accepted.
- **Client mode**: This path is used in the outgoing connection URL. For example, `wss://velocity.example.com:8443/feed/stream-id`.

## Subscription message

An optional message sent to the WebSocket server immediately after the
connection is established. Many WebSocket APIs require a subscription,
authentication, or channel-selection message before they begin streaming data.
Leave empty if not needed.

## Ignore first message

When enabled, the first message received after connecting is silently discarded.
Some WebSocket servers send a subscription acknowledgment or welcome message
before actual data. Enabling this ensures only real data is processed.

## Custom HTTP headers

Optional HTTP headers sent during the WebSocket upgrade handshake, specified as
a JSON object. For example:

```json
{"Authorization": "Bearer token123", "X-Custom-Header": "value"}
```

Useful for authentication tokens or API keys required by the WebSocket endpoint.

## UI controls

When WebSocket is selected in the **Mode** dropdown, a **WebSocket Settings…**
action appears in the compact **Setup** toolbar. It opens the Protocol Settings
dialog, which holds every WebSocket-specific control, and it carries a concise
configured state, such as `Defaults` or `2 changed`. The adjacent **Summary**
action carries the warning count. Open Settings with the button or with
`Cmd+Shift+P` on macOS and `Ctrl+Shift+P` on Windows and Linux.
The dialog layout, its sections, and the Done, Revert changes, and Reset to
preset actions are described in
[Protocol settings and presets](connection-presets.md#the-protocol-settings-dialog).

Host, port, and the connection mode stay in the panel, because they apply to
every protocol.

The dialog offers three sections for WebSocket:

**Basics**

- **Format** - `Delimited (CSV)` (default), `JSON`, `Esri JSON`, `GeoJSON`, or `XML`.
- **WS path** - URL path (default `/`).

**Security**

- **Use TLS** - Checkbox: checked = `wss://` (port 8443), unchecked = `ws://` (port 8080).
- **CA cert** - Custom CA certificate (PEM). Client mode only.
- **TLS cert** - Client or server certificate (PEM).
- **TLS key** - Private key (PEM).
- **Allow unverified** - Client-only warning checkbox, shown when TLS is enabled. Accepts an unverified server certificate for any host. Off by default; see [TLS and SSL security](tls.md#explicit-certificate-verification-bypass).

**Advanced**

- **Subscribe** - Optional subscription message sent after connecting.
- **Ignore 1st msg** - Checkbox to skip the first received message.
- **Headers** - Custom HTTP headers as JSON for the upgrade handshake.

The current format, path, TLS state, and effective `ws://` or `wss://` URL are
also reported by the [connection summary](connection-summary.md), which never
shows a secret value.

## Tooltip reference

### Connection mode tooltips

| Mode | Tooltip |
|------|---------|
| WebSocket Client | WebSocket Client - connects to a remote WebSocket server (ws:// or wss://) and sends data as text frames. |
| WebSocket Server | WebSocket Server - starts a local WebSocket server that accepts incoming ws:// or wss:// connections. |

### Format tooltips

| Format | Tooltip |
|--------|---------|
| Delimited (CSV) | WebSocket Format: Delimited / CSV (text/plain). Each message is a comma-separated row of field values. Default format for ArcGIS Velocity WebSocket feeds. |
| JSON | WebSocket Format: JSON (application/json). Each message is a JSON object or array of features. |
| Esri JSON | WebSocket Format: Esri JSON (application/json). Each message uses the Esri Feature JSON schema with geometry and attributes objects. |
| GeoJSON | WebSocket Format: GeoJSON (application/geo+json). Each message is a GeoJSON FeatureCollection or Feature per RFC 7946. |
| XML | WebSocket Format: XML (application/xml). Each message is an XML-formatted payload. |

### Control tooltips

| Control | Tooltip |
|---------|---------|
| Use TLS checkbox | Enable TLS (WSS) for the WebSocket connection. When checked, uses the secure wss:// protocol (port 8443). When unchecked, uses plain ws:// (port 8080). |
| CA cert path | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store automatically. |
| TLS cert path | Path to a client or server certificate file (PEM). Required for server-mode TLS. |
| TLS key path | Path to the private key file (PEM). Required for server-mode TLS and client-side mTLS. |
| WebSocket Settings… | Open WebSocket settings (Cmd+Shift+P / Ctrl+Shift+P).<br>---<br>Everything specific to WebSocket is edited in the dialog: format, WS path, TLS, certificates, subscription message, and headers.<br>Configured: &lt;state&gt;.<br>Nothing is sent until you select Connect. |
| Allow unverified | Warning: accept any WSS server certificate<br>---<br>Certificate verification is disabled for every host, not only localhost. Traffic stays encrypted, but the server identity is not checked. Use only for local self-signed testing. |
| WS path | WebSocket endpoint URL path appended after the host:port (e.g. /feed/stream-id). Default is /. |
| Subscribe | Optional subscription message sent to the WebSocket server immediately after connecting. Leave empty if not needed. |
| Ignore 1st msg | Ignore the first message received. Enable to skip subscription acknowledgments or welcome messages. |
| Headers | Custom HTTP headers for the WebSocket upgrade handshake as JSON (e.g. {"Authorization":"Bearer token"}). |

### TLS Trust Badge

When connected, the status bar displays a lock icon reflecting the trust level
at a glance. The icon **shape** and **colour** both encode the trust level so it
is unambiguous for colour-blind users. No text label is shown beside the icon -
hover or click the badge for full details.

| Icon | Colour | Trust Level | Meaning |
|------|--------|-------------|---------|
| 🔓 | Grey / dimmed | off | No TLS - plaintext, unsecure connection. |
| 🔒 | Amber | on | TLS on - OS certificate store, trust level not fully determined. |
| 🔒⚠ | Amber | self-signed | TLS on, self-signed or cert-chain not verified. |
| 🔒✓ | Green | ca-verified | TLS on, CA-verified certificate chain. |
| 🔐 | Blue / cyan | mtls | Mutual TLS - both client and server present certificates. |

See [TLS and SSL security](tls.md) for full TLS concepts, certificate file
formats, OS trust store behaviour, and setup guides.

## CLI parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `protocol=ws` | Use WebSocket transport. | - |
| `mode=client\|server` | Connect outward as a client or host a broadcast server. | `server` |
| `wsFormat=<format>` | Message format: `delimited`, `json`, `esri-json`, `geo-json`, or `xml`. | `delimited` |
| `wsPath=<path>` | Upgrade endpoint path. A missing leading slash is added. | `/` |
| `wsTls=true\|false` | Use WSS when true or unsecure WS when false. | `true` |
| `wsTlsCaPath=<path>` | Custom CA certificate PEM; otherwise use system/Node trust in client mode. | `(none)` |
| `wsTlsCertPath=<path>` | Client mTLS or server identity certificate PEM. | `(none)` |
| `wsTlsKeyPath=<path>` | Private key PEM paired with the certificate. | `(none)` |
| `wsAllowUnverifiedTls=true\|false` | Client only: explicitly disable WSS certificate verification for any host. Encryption remains enabled. | `false` |
| `wsSubscriptionMsg=<text>` | Client-only text frame sent immediately after open. | `(none)` |
| `wsIgnoreFirstMsg=true\|false` | Client-only: discard the first received frame, commonly a subscription acknowledgement. | `false` |
| `wsHeaders=<json>` | Client-only JSON object of HTTP upgrade headers. | `(none)` |

In headless server mode, `waitForClient=true` pauses replay until at least one
WebSocket is open and pauses again whenever the recipient count returns to zero.
Client connection retry and restart recovery honor `connectWaitForServer`,
`connectRetryIntervalMs`, and `connectTimeoutMs`.

## Metadata logging

When "Show Metadata" is enabled, WebSocket connections log message metadata:

```json
[metadata] protocol=WebSocket mode=server path=/ content-type=text/plain tls=on (WSS) remote=127.0.0.1:52341 format=delimited
```

## Launch configuration

WebSocket parameters can be set in launch configuration JSON files:

```json
{
  "connection": {
    "protocol": "ws",
    "mode": "client",
    "ip": "velocity.example.com",
    "port": 8443,
    "wsFormat": "delimited",
    "wsTls": true,
    "wsPath": "/feed/stream-id",
    "wsSubscriptionMsg": "{\"subscribe\": \"feed-1\"}",
    "wsIgnoreFirstMsg": true,
    "wsHeaders": "{\"Authorization\": \"Bearer token123\"}"
  }
}
```

## Related documentation

| Document | Purpose |
|----------|---------|
| [TLS and SSL security](tls.md) | Certificate types, trust stores, mutual TLS, and the TLS Trust Badge. |
| [Protocol settings and presets](connection-presets.md) | The Protocol Settings dialog, its sections, and the paired Simulator and Logger presets. |
| [Connection summary and protocol settings](connection-summary.md) | The read-only description of the current connection, its warnings, and the effective URL. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Headless mode](headless.md) | No-UI replay sessions, parameters, and the completion artifact. |
| [HTTP and HTTPS transport](http.md) | HTTP and HTTPS modes, data formats, and request paths. |
| [gRPC transport](grpc.md) | gRPC modes, serialization formats, and metadata. |
