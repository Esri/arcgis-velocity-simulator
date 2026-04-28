# WebSocket Transport

The ArcGIS Velocity Simulator supports WebSocket (ws:// and wss://) as a transport protocol for sending and receiving data alongside TCP, UDP, HTTP, and gRPC.

## Connection Modes

| Mode | Description |
|------|-------------|
| WebSocket Client | Connects to a remote WebSocket server (ws:// or wss://) and sends data as text frames. |
| WebSocket Server | Starts a local WebSocket server that accepts incoming ws:// or wss:// connections and broadcasts data to all connected clients. |

## Format Options

The WebSocket Format dropdown controls the Content-Type associated with each message. These match the formats supported by ArcGIS Velocity TCP, HTTP, and WebSocket feeds. **Delimited (CSV) is the default**, matching Velocity's ordering:

| UI Label | Value | Content-Type | Description |
|----------|-------|--------------|-------------|
| Delimited (CSV) | `delimited` | `text/plain` | Each message is a comma-separated row of field values. **Default format.** |
| JSON | `json` | `application/json` | Each message is a JSON object or array of features. |
| Esri JSON | `esri-json` | `application/json` | Each message uses the Esri Feature JSON schema. |
| GeoJSON | `geo-json` | `application/geo+json` | Each message is a GeoJSON FeatureCollection or Feature per RFC 7946. |
| XML | `xml` | `application/xml` | Each message is an XML payload. |

## TLS (WSS)

TLS is enabled by default (`Use TLS` checkbox checked), making the connection use the secure `wss://` protocol. When unchecked, the unsecure `ws://` protocol is used.

- **Client mode**: Uses the OS certificate store (macOS Keychain, Windows certificate store, or Linux CA bundles) plus Node.js bundled root certificates to verify the server. Custom CA, client cert, and key can be provided for mutual TLS or enterprise CAs.
- **Server mode**: Requires a TLS certificate and private key to be provided.

| Field | Description |
|-------|-------------|
| **CA cert path** | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store. |
| **TLS cert path** | Path to a client or server certificate file (PEM). Required for server-mode TLS. |
| **TLS key path** | Path to the private key file (PEM). Required for server-mode TLS. |

## Default Ports

| TLS State | Default Port | Protocol |
|-----------|-------------|----------|
| TLS On (WSS) | `8443` | `wss://` |
| TLS Off (WS) | `8080` | `ws://` |

WebSocket uses the same default ports as HTTP because the WebSocket handshake begins as an HTTP Upgrade request.

## WebSocket Path

The WS Path field (default `/`) specifies the URL path appended after the host and port.

- **Server mode**: Only WebSocket upgrade requests matching this path exactly are accepted.
- **Client mode**: This path is used in the outgoing connection URL. For example, `wss://velocity.example.com:8443/feed/stream-id`.

## Subscription Message

An optional message sent to the WebSocket server immediately after the connection is established. Many WebSocket APIs require a subscription, authentication, or channel-selection message before they begin streaming data. Leave empty if not needed.

## Ignore First Message

When enabled, the first message received after connecting is silently discarded. Some WebSocket servers send a subscription acknowledgment or welcome message before actual data. Enabling this ensures only real data is processed.

## Custom HTTP Headers

Optional HTTP headers sent during the WebSocket upgrade handshake, specified as a JSON object. For example:

```json
{"Authorization": "Bearer token123", "X-Custom-Header": "value"}
```

Useful for authentication tokens or API keys required by the WebSocket endpoint.

## UI Controls

When WebSocket is selected as the connection type, the following controls appear:

- **Format** — `Delimited (CSV)` (default), `JSON`, `Esri JSON`, `GeoJSON`, or `XML`.
- **Use TLS** — Checkbox: checked = `wss://` (port 8443), unchecked = `ws://` (port 8080).
- **CA cert path** — Custom CA certificate (PEM).
- **TLS cert path** — Client/server certificate (PEM).
- **TLS key path** — Private key (PEM).
- **WS Path** — URL path (default `/`).
- **Subscribe** — Optional subscription message sent after connecting.
- **Ignore 1st msg** — Checkbox to skip the first received message.
- **Headers** — Custom HTTP headers as JSON for the upgrade handshake.

## Tooltip Reference

### Connection Mode Tooltips

| Mode | Tooltip |
|------|---------|
| WebSocket Client | WebSocket Client — connects to a remote WebSocket server (ws:// or wss://) and sends data as text frames. |
| WebSocket Server | WebSocket Server — starts a local WebSocket server that accepts incoming ws:// or wss:// connections. |

### Format Tooltips

| Format | Tooltip |
|--------|---------|
| Delimited (CSV) | WebSocket Format: Delimited / CSV (text/plain). Each message is a comma-separated row of field values. Default format for ArcGIS Velocity WebSocket feeds. |
| JSON | WebSocket Format: JSON (application/json). Each message is a JSON object or array of features. |
| Esri JSON | WebSocket Format: Esri JSON (application/json). Each message uses the Esri Feature JSON schema with geometry and attributes objects. |
| GeoJSON | WebSocket Format: GeoJSON (application/geo+json). Each message is a GeoJSON FeatureCollection or Feature per RFC 7946. |
| XML | WebSocket Format: XML (application/xml). Each message is an XML-formatted payload. |

### Control Tooltips

| Control | Tooltip |
|---------|---------|
| Use TLS checkbox | Enable TLS (WSS) for the WebSocket connection. When checked, uses the secure wss:// protocol (port 8443). When unchecked, uses plain ws:// (port 8080). |
| CA cert path | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store automatically. |
| TLS cert path | Path to a client or server certificate file (PEM). Required for server-mode TLS. |
| TLS key path | Path to the private key file (PEM). Required for server-mode TLS and client-side mTLS. |
| WS path | WebSocket endpoint URL path appended after the host:port (e.g. /feed/stream-id). Default is /. |
| Subscribe | Optional subscription message sent to the WebSocket server immediately after connecting. Leave empty if not needed. |
| Ignore 1st msg | Ignore the first message received. Enable to skip subscription acknowledgments or welcome messages. |
| Headers | Custom HTTP headers for the WebSocket upgrade handshake as JSON (e.g. {"Authorization":"Bearer token"}). |

## CLI Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `--protocol ws` | Use WebSocket transport | — |
| `--mode client\|server` | Connection mode | `server` |
| `--wsFormat <format>` | Data format (`delimited`, `json`, `esri-json`, `geo-json`, `xml`) | `delimited` |
| `--wsTls` | Enable TLS (WSS) | `true` |
| `--wsTlsCaPath <path>` | CA certificate file path | system default |
| `--wsTlsCertPath <path>` | Client/server certificate file path | — |
| `--wsTlsKeyPath <path>` | Private key file path | — |
| `--wsPath <path>` | WebSocket endpoint URL path | `/` |
| `--wsSubscriptionMsg <msg>` | Subscription message sent after connecting | — |
| `--wsIgnoreFirstMsg` | Ignore first received message | `false` |
| `--wsHeaders <json>` | Custom HTTP headers as JSON string | — |

## Metadata Logging

When "Show Metadata" is enabled, WebSocket connections log message metadata:

```
[metadata] protocol=WebSocket mode=server path=/ content-type=text/plain tls=on (WSS) remote=127.0.0.1:52341 format=delimited
```

## Launch Configuration

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

