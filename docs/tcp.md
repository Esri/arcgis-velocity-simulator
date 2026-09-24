# TCP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator publishes CSV-first source records over a TCP byte
stream in client or server mode. This guide is for users configuring a TCP feed
and developers implementing a compatible receiver. Read [Data
formats](data-formats.md) for the shared conversion and schema rules.

## Table of contents

- [Roles and defaults](#roles-and-defaults)
- [Address family](#address-family)
- [Connection greeting](#connection-greeting)
- [Formats and framing](#formats-and-framing)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Headless and Launch Config](#headless-and-launch-config)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Roles and defaults

**TCP Server** listens on the selected address and port and publishes replayed
records to connected clients. Use it when the receiver connects to the
Simulator. **TCP Client** connects to the selected remote server and publishes
records over that connection.

TCP Server, `127.0.0.1`, port `5565`, and Delimited are the application-wide
defaults. A local preset fills the paired role and address but does not connect
or start playback.

## Address family

The **Address family** selector in Protocol Settings **Basics** offers **Auto**
(default), **IPv4**, and **IPv6**. Auto preserves Node.js and operating-system
address selection, including TCP hostname resolution. Explicit IPv4 or IPv6
resolves DNS names only in the selected family; a literal of the other family
is rejected before connecting.

In headless client mode, `connectWaitForServer=true` also retries DNS
`ENOTFOUND` and temporary `EAI_AGAIN` failures, including explicit-family
lookups. `connectRetryIntervalMs` controls the delay and `connectTimeoutMs`
bounds the retry period. Invalid hosts and address-family mismatches are
configuration errors and are not retried.

Use `::1` for IPv6 loopback and `::` only for an intentional all-interface
IPv6 server bind. Explicit IPv6 listeners accept IPv6 only. Auto retains
existing operating-system listen semantics; it is not a new simultaneous
dual-stack mode. IPv4-mapped IPv6 literals are accepted only in TCP Auto.
Raw IPv6 literals and bracketed host-only literals such as `[::1]` are
accepted; enter the port separately. Status endpoints display `[host]:port`.
Changing the selector never changes Host, and local presets retain
`127.0.0.1` with Auto.

Velocity TCP Server feeds and outputs listen on IPv4 only. Applying one
selects IPv4 and rejects an advertised IPv6 endpoint. Other TCP connectors
can use advertised IPv6 addresses when the deployment supports them;
application socket support is not a guarantee of deployment reachability.

## Connection greeting

**Handshake text** is an optional greeting sent once on each new TCP client
connection and each accepted server connection, including reconnects. Empty
text disables it. Whitespace-only text sends those spaces. Incoming data is
read immediately; this is send-only configuration, not authentication,
negotiation, or a wait for an acknowledgement.

Applying a Velocity TCP feed clears any previous handshake text and restores
Use escapes to on. Velocity does not supply a greeting through this automatic
mapping; configure one explicitly afterward if the receiver needs it.

The greeting is UTF-8, independent of payload format, and is written before
locally published replay records. No newline or other delimiter is appended.
Each accepted peer has its own greeting and readiness state. A write failure
closes that connection and reports a content-free error. Disconnect cancels a
pending greeting. A positive `connectTimeoutMs` bounds the greeting write;
server peers each receive that timeout, while a headless client uses the
remaining connection deadline.

**Use escapes** defaults to enabled. Supported Java-style escapes are `\b`,
`\t`, `\n`, `\f`, `\r`, `\\`, `\"`, `\'`, `\uXXXX`, and octal escapes.
Unicode escapes may contain repeated `u` characters; surrogate pairs must be
valid. Octal escapes consume at most three digits when the first digit is
`0`–`3`, otherwise at most two. Unknown or incomplete escapes are errors.
With escapes disabled, backslashes are literal. The decoded UTF-8 limit is
1 MiB. Entered text is additionally limited to 1,048,576 UTF-16 code units;
escaped text may reach that input limit before the decoded byte limit.
Include `\r\n` or `\n` explicitly if the peer needs a terminator.

Loaded raw text, including CRLF, is preserved until edited. The multiline
editor uses LF when a user edits actual line breaks; use escaped `\r\n` with
**Use escapes** enabled when editing CRLF bytes. Leading and trailing spaces
are never trimmed. Summary, clipboard summary, and startup diagnostics hide
the greeting. Launch configuration exports contain its exact text, so protect
those files if the greeting contains credentials. Command-line arguments may
also be visible in shell history or process listings. Masked summaries and
diagnostics do not encrypt the greeting.
TCP is unsecure; handshake text is transmitted without encryption.

## Formats and framing

Choose Delimited (CSV), JSON, GeoJSON, or Esri JSON. Delimited preserves the
existing logical CSV record. Structured choices convert each record using the
header, generated field names, and optional geometry settings described in
[Data formats](data-formats.md).

Each payload is UTF-8 and newline-terminated. TCP does not preserve message
boundaries: one record may arrive in fragments, or several records may arrive
in one read. Receivers must buffer the byte stream and extract complete
newline-separated logical payloads.

Each TCP payload is limited to 1 MiB. The Simulator rejects a larger converted
record before sending it, and receivers reset an incomplete record that grows
beyond the same bound instead of buffering without limit. A complete oversized
record received from another sender is preserved as raw text with a size
warning so diagnostics do not silently discard it.

XML is not a TCP format choice. It remains supported by HTTP and WebSocket.

## UI controls

Open **Settings** and use these TCP-specific sections:

| Section | Control | Behavior |
|---|---|---|
| Basics | Format | Selects Delimited (CSV), JSON, GeoJSON, or Esri JSON. |
| Basics | Address family | Auto, IPv4, or IPv6; does not rewrite Host. |
| Advanced | Handshake text | Optional UTF-8 greeting, empty by default, sent once before replay on each new TCP connection. |
| Advanced | Use escapes | Interpret supported Java-style escapes; enabled by default. |
| Advanced | CSV header row | Uses the first logical CSV record as field names and does not publish it. Off by default. |
| Advanced | X field | Optional X-coordinate field. Configure it together with Y. |
| Advanced | Y field | Optional Y-coordinate field. Configure it together with X. |
| Advanced | WKID | Spatial reference for generated point geometry. Defaults to 4326. |

Connection type, host, port, file selection, replay rate, and playback actions
remain in the main connection surface.

## Tooltip reference

The following text matches the TCP controls:

| Control | Tooltip |
|---|---|
| Handshake text label and control | Optional TCP greeting sent as UTF-8 once on each new client connection or accepted server connection, including reconnects. Blank sends nothing. Whitespace is preserved; no newline is appended and no reply is awaited. Decoded maximum: 1 MiB. |
| Use escapes label and control | `Interpret Java-style escapes in the TCP greeting (enabled by default): \r\n sends CRLF; \t, \b, \f, \\, escaped quotes, \uXXXX, and octal escapes are supported. When off, backslashes are sent literally. Whitespace is preserved; malformed escapes are rejected without displaying the greeting.` |
| Address family label and initial selector | Choose Auto, IPv4, or IPv6 for TCP. Auto preserves system address selection. Explicit IPv6 listeners accept IPv6 only. |
| Auto | Auto - preserve the operating system and Node.js TCP address selection. This is the default. |
| Host input and label, client | Destination address: enter a reachable peer IP address or DNS name matching the selected address family. Do not use 0.0.0.0 or :: as a destination. |
| Host input and label, server Auto | Local bind address: 127.0.0.1 or ::1 is same-machine only. A local LAN IP restricts listening to that interface. Use 0.0.0.0 for all local IPv4 interfaces or :: for the system IPv6 wildcard when remote peers or multiple interfaces need access. Auto preserves system listen behavior. Wildcard binds expand network exposure; firewall rules still apply. |
| Host input and label, server IPv4 | Local bind address: 127.0.0.1 accepts same-machine traffic only. A local LAN IP restricts listening to that interface. Use 0.0.0.0 to listen on all local IPv4 interfaces for remote peers or multiple interfaces. This expands network exposure; firewall rules still apply. |
| Host input and label, server IPv6 | Local bind address: ::1 accepts same-machine traffic only. A local IPv6 address restricts listening to that interface. Use :: to listen on all local IPv6 interfaces for remote peers or multiple interfaces. Explicit IPv6 listeners accept IPv6 only. This expands network exposure; firewall rules still apply. |
| IPv4 | IPv4 - use IPv4 addresses and resolve hostnames to IPv4. |
| IPv6 | IPv6 - use IPv6 addresses and resolve hostnames to IPv6. Explicit IPv6 listeners accept IPv6 only. |
| Format label | Choose how each logical CSV record is encoded for TCP. |
| Format | TCP payload format. The Simulator converts each logical record from the loaded CSV file before sending it. Delimited (CSV) preserves the existing comma-delimited workflow. |
| Delimited (CSV) | Delimited (CSV) - send each logical CSV record as UTF-8 text terminated by a newline. This is the default and preserves existing replay behavior. |
| JSON | JSON - convert each CSV record to a JSON object using the header row or generated field names. |
| GeoJSON | GeoJSON - convert each CSV record to a GeoJSON Feature. Configure X and Y fields to create point geometry, or leave them empty for null geometry. |
| Esri JSON | Esri JSON - convert each CSV record to an Esri JSON feature with attributes. Configure X and Y fields to create point geometry. |
| CSV header row | Treat the first logical CSV record as field names and do not send it as an event. Leave off to preserve the existing behavior and generate field_1, field_2, and similar names for structured formats. |
| X field label | Optional CSV field used as the point X coordinate. |
| X field | Optional CSV field containing the point X coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. GeoJSON requires WKID 4326. |
| Y field label | Optional CSV field used as the point Y coordinate. |
| Y field | Optional CSV field containing the point Y coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. |
| WKID label | Spatial reference WKID used for generated point geometry. |
| WKID | Spatial reference WKID for generated point geometry. GeoJSON requires 4326; Esri JSON includes the configured WKID. |

## Headless and Launch Config

Set `protocol=tcp` and choose `tcpFormat`. Omitting `tcpFormat` selects
`delimited`, including for existing Launch Config files.

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 tcpFormat=geo-json
```

The CSV header, coordinate mapping, and WKID controls are also honored by
headless and Launch Config workflows when configured.

For a local IPv6 receiver:

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=::1 port=5565 tcpAddressFamily=ipv6
```

For a receiver expecting a one-time line greeting:

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 'tcpHandshakeText=HELLO\r\n' tcpHandshakeUseEscapes=true
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Connection is refused | Confirm the server is listening at the selected host and port; optionally use `connectWaitForServer=true`. |
| Host does not match the family | Correct Host or Address family; the selector does not rewrite addresses. Check DNS records and IPv6 availability on both hosts. |
| A server run advances before a client connects | Set `waitForClient=true`. |
| Records are partial or combined | Implement newline framing over the TCP byte stream. |
| Structured conversion fails | Validate the source CSV, header choice, field mappings, and WKID. |
| Receiver reports an unexpected schema | Match its fields to the header or deterministic generated names. |

## Related documentation

| Document | Purpose |
|---|---|
| [Data formats](data-formats.md) | Shared payload choices, CSV conversion, geometry, and compatibility. |
| [UDP transport](udp.md) | Datagram roles, limits, controls, and troubleshooting. |
| [Protocol settings and presets](connection-presets.md) | The connection surface and paired local presets. |
| [Headless mode](headless.md) | No-UI replay workflows and completion artifacts. |
| [Command-line reference](command-line.md) | TCP options and common replay parameters. |
