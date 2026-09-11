# HTTP and HTTPS transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The ArcGIS Velocity Simulator supports HTTP and HTTPS as a transport protocol
for sending data to an ArcGIS Velocity HTTP Receiver feed, an ArcGIS GeoEvent
Server connector, or any endpoint that accepts POST requests. It runs as either
an HTTP client or an HTTP server.

This guide is written for users configuring an HTTP session and for developers
extending the transport. It covers connection modes, data formats, TLS, default
ports, request paths, user-interface controls and their tooltips, the
command-line parameters, and the launch-configuration keys. General certificate
concepts live in the [TLS and SSL security](tls.md) guide.

## Table of contents

- [Connection modes](#connection-modes)
- [Format options](#format-options)
- [TLS (HTTPS)](#tls-https)
- [Default ports](#default-ports)
- [HTTP path](#http-path)
- [GET polling](#get-polling)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [CLI parameters](#cli-parameters)
- [Metadata logging](#metadata-logging)
- [Launch configuration](#launch-configuration)
- [Related documentation](#related-documentation)

## Connection modes

| Mode | Description |
|------|-------------|
| HTTP Client | POSTs data to an HTTP(S) endpoint. |
| HTTP Server | Hosts an HTTP(S) server that accepts POST requests and broadcasts replay data to SSE watchers. |

Both modes are available in renderer-independent headless runs through
`TransportManager`; the same `src/http-transport.js` implementation is used by
the UI and headless engine.

## Format options

The HTTP Format dropdown controls the `Content-Type` header used when sending
data. **Delimited (CSV) is the default**, matching the order used by Velocity.
These HTTP choices are independent of TCP and UDP payload conversion; in
particular, XML remains available here but is not a TCP or UDP choice. See
[Data formats](data-formats.md) for the shared distinction:

| UI Label | Value | Content-Type | Description |
|----------|-------|--------------|-------------|
| Delimited (CSV) | `delimited` | `text/plain` | Each line is a comma-separated row of field values. **Default format** - matches the default for ArcGIS Velocity TCP and HTTP feeds. Best for simple tabular data without nested structures. |
| JSON | `json` | `application/json` | The standard format for most HTTP feeds. Each request body is a JSON object or array of features. |
| Esri JSON | `esri-json` | `application/json` | Uses the Esri Feature JSON schema with `geometry` and `attributes` objects. Use when the Velocity HTTP Receiver expects ArcGIS-native feature format. |
| GeoJSON | `geo-json` | `application/geo+json` | Standard GeoJSON per [RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946) with `FeatureCollection` and `Feature` objects. Use when the receiver expects standard geospatial interchange format. |
| XML | `xml` | `application/xml` | Sends data as XML-formatted payloads. Use when the Velocity HTTP Receiver is configured for XML input. |

## TLS (HTTPS)

TLS is enabled by default (`Use TLS` checkbox checked), making the connection
HTTPS. When TLS is enabled:

- **Client mode**: Uses the OS certificate store (macOS Keychain, Windows certificate store, or Linux CA bundles) plus Node.js bundled root certificates to verify the server. Custom CA, client cert, and key can be provided for mutual TLS or enterprise CAs.
- **Server mode**: Requires a TLS certificate and private key to be provided. The OS certificate store cannot provide a server identity certificate.

When TLS is enabled, additional certificate path fields appear:

| Field | Description |
|-------|-------------|
| **CA cert path** | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store automatically. Only needed for enterprise or self-signed CAs not in the system trust store. |
| **TLS cert path** | Path to a client or server certificate file (PEM). Required for server-mode TLS. For client mode, only needed for mutual TLS (mTLS) authentication. |
| **TLS key path** | Path to the private key file (PEM) corresponding to the TLS certificate. Required for server-mode TLS and client-side mTLS. |
| **httpAllowUnverifiedTls** | Client mode only. Explicitly accept an unverified server certificate (default: `false`). The bypass applies to any host, not only localhost. |

## Default ports

| TLS State | Default Port |
|-----------|-------------|
| TLS On (HTTPS) | `8443` |
| TLS Off (HTTP) | `8080` |

The port automatically switches between `8080` and `8443` when the TLS checkbox
is toggled, as long as the user hasn't manually entered a custom port.

## HTTP path

The HTTP Path field (default `/`) specifies the URL path appended after the host
and port in the request URL.

- **Server mode**: POST requests must match this path exactly. With GET polling enabled, ordinary GET requests at the same path receive the latest replay payload; otherwise GET returns status or opens Server-Sent Events.
- **Client mode**: This path is used in the outgoing POST request URL. For example, if the host is `velocity.example.com`, the port is `8443`, and the path is `/receiver/feed-id`, the full URL becomes `https://velocity.example.com:8443/receiver/feed-id`.

When connecting to an ArcGIS Velocity HTTP Receiver endpoint, set this to the
system-generated path provided by the feed configuration (typically something
like `/receiver/<feed-id>`). For a focused local ArcGIS Velocity or ArcGIS
GeoEvent Server receiver, `/` is sufficient only when that product is configured
for the same path.

Applying a receiver from the Velocity sign-in dialog preserves its advertised
host, explicit port, path, and required non-secret query. HTTPS uses 443 when
the advertised URL omits a port; this does not change the local server default.
The management API context is not substituted into the receiver address.
See [ArcGIS Velocity REST API](velocity-rest-api.md) for public URL selection.

## GET polling

Enable **GET polling** in HTTP Server mode when an ArcGIS Velocity HTTP Poller
feed requests the Simulator. Playback stores the latest replay payload, and an
ordinary GET at the exact HTTP path returns it using the selected content type.
Before playback provides a payload, the server returns HTTP 204.

Server-Sent Event clients still subscribe with `Accept: text/event-stream`.
GET polling is off by default, preserving existing HTTP Server behavior.

## UI controls

When HTTP is selected in the **Mode** dropdown, a **HTTP Settings…** button
appears in the compact **Setup** toolbar. It opens Protocol Settings,
which holds every HTTP-specific control, and it carries a concise configured
state, such as `Defaults` or `2 changed`. Connection warnings remain visible
beneath the toolbar. Open Settings
with the button or with `Cmd+Shift+P` on macOS and `Ctrl+Shift+P` on Windows
and Linux. Its
layout, sections, and the Done, Revert changes, and Reset to preset actions
are described in
[Protocol settings and presets](connection-presets.md#the-protocol-settings-window).

Host, port, and the connection mode stay in the panel, because they apply to
every protocol.

Protocol Settings offers Basics and Security for both roles. HTTP Server also
offers Advanced:

**Basics**

- **Format** - `Delimited (CSV)` (default), `JSON`, `Esri JSON`, `GeoJSON`, or `XML`. Controls the `Content-Type` header sent with each request. Must match the format configured in the ArcGIS Velocity HTTP Receiver feed. Hovering over the dropdown shows a detailed tooltip for the currently selected format.
- **HTTP path** - The URL path appended after the host:port (default `/`). In server mode, only POST requests matching this path are accepted. In client mode, this path is used in outgoing POST URLs. Set this to the Velocity feed's system-generated path when connecting to a real endpoint.

**Security**

- **Use TLS** - Checkbox to enable TLS (HTTPS). When checked, the connection uses HTTPS and the port defaults to `8443`. When unchecked, uses plain HTTP with port `8080`. Toggling this checkbox also reveals or hides the certificate path fields.
- **CA cert** - Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store. Only needed for enterprise or self-signed CAs. Client mode only.
- **TLS cert** - Path to a client or server certificate file (PEM). Required for server-mode TLS; only needed in client mode for mutual TLS (mTLS).
- **TLS key** - Path to the private key file (PEM). Required for server-mode TLS and client-side mTLS.
- **Allow unverified** - Client-only warning checkbox, shown when TLS is enabled. Accepts an unverified server certificate for any host. Off by default; see [TLS and SSL security](tls.md#explicit-certificate-verification-bypass).

**Advanced**

- **GET polling** - In HTTP Server mode, returns the latest replay payload to
  ordinary GET requests at the configured path. Use it for a GET-based HTTP
  Poller feed.

**Mode** stays in the panel and offers `HTTP Client` and `HTTP Server`. Hovering
over each option shows a description of that connection mode.

The current format, path, TLS state, and effective URL are also reported by the
[connection summary](connection-summary.md), which never shows a secret value.

## Tooltip reference

The following tooltips appear after a deliberate stationary hover over HTTP-related controls in the
UI. These are also set dynamically via `HTTP_FORMAT_TOOLTIPS` and
`CONNECTION_MODE_TOOLTIPS` in `renderer.js`.

### Connection mode tooltips

| Mode | Tooltip |
|------|---------|
| HTTP Client | HTTP Client - sends data via HTTP/HTTPS POST requests to a remote endpoint. |
| HTTP Server | HTTP Server - starts a local HTTP/HTTPS server that accepts POST requests from clients. |

### Format tooltips

| Format | Tooltip |
|--------|---------|
| JSON | HTTP Format: JSON (application/json). The standard format for most HTTP feeds. Each request body is a JSON object or array of features. |
| Delimited (CSV) | HTTP Format: Delimited / CSV (text/plain). Each line is a comma-separated row of field values. Best for simple tabular data without nested structures. |
| Esri JSON | HTTP Format: Esri JSON (application/json). Uses the Esri Feature JSON schema with geometry and attributes objects. Use when the Velocity HTTP Receiver expects ArcGIS-native feature format. |
| GeoJSON | HTTP Format: GeoJSON (application/geo+json). Standard GeoJSON per RFC 7946 with FeatureCollection and Feature objects. Use when the receiver expects standard geospatial interchange format. |
| XML | HTTP Format: XML (application/xml). Sends data as XML-formatted payloads. Use when the Velocity HTTP Receiver is configured for XML input. |

### Control tooltips

| Control | Tooltip |
|---------|---------|
| Use TLS checkbox | Enable TLS (HTTPS) for the HTTP connection. When checked, the connection uses HTTPS (port 8443 by default). When unchecked, uses plain HTTP (port 8080). In client mode, the OS certificate store is used automatically; in server mode, a certificate and key must be provided. |
| CA cert path | Path to a custom CA certificate file (PEM). Leave empty to use the OS certificate store automatically. Only needed for enterprise or self-signed CAs not in the system trust store. |
| TLS cert path | Path to a client or server certificate file (PEM). Required for server-mode TLS. For client mode, only needed for mutual TLS (mTLS) authentication. |
| TLS key path | Path to the private key file (PEM) corresponding to the TLS certificate. Required for server-mode TLS and client-side mTLS. |
| HTTP Settings… | Open HTTP settings (Cmd+Shift+P / Ctrl+Shift+P).<br>---<br>Everything specific to HTTP is edited in the dialog: format, HTTP path, TLS, and certificates.<br>Configured: &lt;state&gt;.<br>Nothing is sent until you select Connect. |
| Allow unverified | Warning: accept any HTTPS server certificate<br>---<br>Certificate verification is disabled for every host, not only localhost. Traffic stays encrypted, but the server identity is not checked. Use only for local self-signed testing. |
| HTTP path | HTTP endpoint URL path appended after the host:port (e.g. /receiver/feed-id). In server mode, only POST requests matching this path are accepted; all others return 404. In client mode, this path is used in the outgoing POST request URL. Default is /. |
| GET polling | Serve the latest replay payload to GET requests at the configured HTTP path.<br>---<br>Off: GET requests provide status or Server-Sent Events.<br>On: each ordinary GET receives the latest replay payload using the selected format.<br>Default is off. |

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
| `protocol=http` | Use HTTP transport. | - |
| `mode=client\|server` | Send POST requests as a client, or host POST/SSE endpoints as a server. | `server` |
| `httpFormat=<format>` | Content type format: `delimited`, `json`, `esri-json`, `geo-json`, or `xml`. | `delimited` |
| `httpPolling=true\|false` | HTTP Server: serve the latest replay payload to ordinary GET requests. | `false` |
| `httpPath=<path>` | Exact POST, health-check, and SSE endpoint path. A missing leading slash is added. | `/` |
| `httpTls=true\|false` | Use HTTPS when true or unsecure HTTP when false. | `true` |
| `httpTlsCaPath=<path>` | Custom CA certificate PEM; otherwise use system/Node trust in client mode. | `(none)` |
| `httpTlsCertPath=<path>` | Client mTLS or server identity certificate PEM. | `(none)` |
| `httpTlsKeyPath=<path>` | Private key PEM paired with the certificate. | `(none)` |
| `httpAllowUnverifiedTls=true\|false` | Client only: explicitly disable HTTPS certificate verification for any host. Encryption remains enabled. | `false` |

In headless server mode, `waitForClient=true` treats an active SSE watcher as a
recipient and does not consume source lines until one exists. Without it, sends
with no watcher report zero recipients and the replay advances normally.
Headless client mode also opens the SSE subscription, so server-to-client data is
raised as a `data-received` event while POST remains the outgoing send path.

The subscription follows two rules. When the endpoint answers the subscription
with anything other than HTTP 200 and a `text/event-stream` content type — for
example a POST-only endpoint that answers `200 application/json` — the answer is
definitive: the subscription stops for the life of the connection, is logged
once, and the endpoint is never polled or re-sent the `Authorization` header.
When a stream that was established does drop, it is a transport failure rather
than an answer, so the client re-subscribes after one second and retries a
refused connection every two seconds. Sending is unaffected either way.

A POST that fails is a per-request failure, not a disconnect. The client stays
connected, the failure is reported for that line, and a later send succeeds once
the peer is reachable again. Only an explicit disconnect ends the connection.

## Metadata logging

When "Show Metadata" is enabled, HTTP connections log request metadata:

```json
[metadata] protocol=HTTP mode=server method=POST path=/ content-type=application/json content-length=245 tls=on (HTTPS) remote=127.0.0.1:52341 format=json
```

## Launch configuration

HTTP parameters can be set in launch configuration JSON files:

```json
{
  "connection": {
    "protocol": "http",
    "mode": "client",
    "ip": "velocity.example.com",
    "port": 8443,
    "httpFormat": "delimited",
    "httpTls": true,
    "httpPath": "/receiver/feed-id"
  }
}
```

## Related documentation

| Document | Purpose |
|----------|---------|
| [TLS and SSL security](tls.md) | Certificate types, trust stores, mutual TLS, and the TLS Trust Badge. |
| [Protocol settings and presets](connection-presets.md) | Protocol Settings, its sections, and the paired Simulator and Logger presets. |
| [Connection summary and protocol settings](connection-summary.md) | The read-only description of the current connection, its warnings, and the effective URL. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Headless mode](headless.md) | No-UI replay sessions, parameters, and the completion artifact. |
| [Data formats](data-formats.md) | Shared input-versus-payload concepts and TCP/UDP conversion behavior. |
| [WebSocket transport](websocket.md) | WebSocket modes, formats, subscription messages, and custom headers. |
| [gRPC transport](grpc.md) | gRPC modes, serialization formats, and metadata. |
