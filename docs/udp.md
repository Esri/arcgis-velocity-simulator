# UDP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator publishes CSV-first source records as UDP datagrams
in client or server mode. This guide is for users configuring a UDP feed and
developers implementing a compatible receiver. Read [Data
formats](data-formats.md) for shared conversion and schema rules.

## Table of contents

- [Roles and defaults](#roles-and-defaults)
- [Address family](#address-family)
- [Velocity feeds](#velocity-feeds)
- [Formats and datagrams](#formats-and-datagrams)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Headless and Launch Config](#headless-and-launch-config)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Roles and defaults

**UDP Client** sends datagrams to the selected remote address and port without
a handshake or acknowledgement. **UDP Server** supports two explicit modes.
**Direct**, the default for new UI and CLI sessions, sends to the main Host and
Port destination and binds its own socket using **Local host** and **Local port**
in Advanced. Local port `0` chooses an ephemeral sender port; the receiver must
listen on the stable destination port. Incoming datagrams never change that
destination, and no registration or acknowledgement is required.

**Registered** preserves the custom recipient-learning publisher. In this mode,
main Host and Port are the local bind endpoint, and only the exact registration
marker adds a recipient. Ordinary incoming payloads do not register a receiver.
A paired Logger UDP client sends the literal
`UDP Client connected` registration datagram when it starts and renews it
every 30 seconds by default while connected. The Logger controls the renewal
interval; there is no Simulator registration-sender setting.
This is a custom application-pair convention,
not a UDP standard or a Velocity handshake. It lets a restarted Simulator
server relearn a still-running Logger client without waiting for a Logger
reconnect. Renewals stop when the Logger disconnects.

Registration and renewal are not acknowledgements, delivery confirmation, or
liveness checks. The Simulator filters the exact marker from payload records,
does not reply to it, and retains learned endpoints until the server disconnects.
Passive Velocity UDP feeds do not register recipients. Explicit Registered
feed configurations use the compatibility exchange. The Simulator UDP Client
never sends a registration or renewal datagram.

The shared default address is `127.0.0.1`, the default port is `5565`, and the
default format is Delimited. Local presets fill the paired role and address but
do not connect or start playback.

While a local UDP socket is open, the application shows **Ready** for direct
publishing and **Listening** for a Registered server. These are local lifecycle states, not evidence
that a remote peer is connected or has received a record. A successful send
callback is not a delivery acknowledgement. The existing playback controls
remain available and connection fields remain read-only until disconnected.

Saved UDP Server launch configurations without `udpConnectionMode` retain
Registered behavior when loaded. Set the mode explicitly to Direct to migrate,
then review both the destination and local bind fields before connecting.
The existing **Local UDP — Simulator Server / Logger Client** preset remains
explicitly Registered. New manually configured sessions default to Direct.
Logger Direct receivers use local port `5565` by default; Simulator Direct
publishers use local port `0`, so the pair can run on the same machine.

## Address family

Protocol Settings **Basics** offers **IPv4** (default) and **IPv6**. The
`udpAddressFamily` value controls the socket and DNS lookup family. DNS names
resolve only within that selected family, and a literal of the other family
is rejected before opening a socket. IPv6 sockets accept IPv6 only;
IPv4-mapped addresses are not supported.

Use `::1` for IPv6 loopback and `::` only for an intentional all-interface
IPv6 server bind. Wildcard addresses are not client destinations. Raw IPv6
and bracketed host-only literals such as `[::1]` are accepted, with the port
entered separately. Endpoints are displayed as `[host]:port`. Changing the
selector never rewrites Host; local presets still select IPv4 and `127.0.0.1`.
The custom registration convention works identically on either family.

## Velocity feeds

Both Velocity UDP feed types receive data, but their endpoint contracts differ.
A **UDP Server** feed is passive and maps to Simulator **UDP Client**. An
explicit **Direct UDP Client** feed maps to Simulator UDP Client using its
advertised local listening endpoint. An explicit **Registered UDP Client**
feed maps to Simulator UDP Server in Registered mode with a safe local bind
and separate advertised destination guidance. A Client feed without explicit
contract metadata cannot be applied automatically: choose the correct manual
mode after confirming how the feed receives. The management API URL is never
used to guess a data endpoint.

Direct sending begins with the replay payload, not a probe or handshake.

The advertised `hostName` is preferred over `hostname` and `host`. The owning
management API URL and `webContextURL` do not identify UDP data routing and are
never substituted for a missing UDP host. A UDP Client feed's hostname is its
Velocity-local bind address. If it is missing, wildcard (`0.0.0.0`), or
unreachable from the Simulator, configure UDP Client manually with a reachable
data host or DNS name, matching address family, and the feed port. Review
firewall and forwarding rules. XML payloads are not supported.

An advertised IPv6 literal selects IPv6 for a UDP Client feed. DNS names
default to IPv4 unless an address family is explicitly supplied; the
application does not assume that a hostname has an IPv6 route. Velocity UDP
Server feeds bind IPv4 only, so Apply rejects IPv6 for that type. UDP Client
feeds and both UDP output types have IPv6-capable addressing, but operating
system, deployment, and network configuration must also permit IPv6.
Socket support alone does not verify a deployed Velocity endpoint.

**Append LF** is enabled by default for delimited UDP publishing, including
generic connections, local application-pair presets, and **Apply** for
delimited feeds. This supports Velocity sampling and newline-framed receivers.
UDP Server feed delimited extraction requires LF-terminated records; without
LF, records can remain buffered and subsequent datagrams can be concatenated.
LF-terminated records are also compatible with UDP Client feeds.
Structured formats do not need this terminator and are unchanged.

## Formats and datagrams

Choose Delimited (CSV), JSON, GeoJSON, or Esri JSON. Delimited preserves the
complete logical CSV record. Structured choices convert it using the schema and
optional geometry settings described in [Data formats](data-formats.md).

The Simulator sends exactly one complete UTF-8 logical payload per datagram.
The absolute payload maximum is 65,507 bytes, including an enabled LF terminator.
Oversize payloads are rejected
before send, and one event is never split across datagrams. Practical network,
platform, and receiver limits may be lower.

With **Append LF** enabled, a delimited payload gets one trailing LF when it
does not already end with LF. Existing LF or CRLF endings are preserved rather
than doubled. Turn it off, or set `udpAppendNewline=false`, for a receiver that
needs the original datagram bytes. An explicitly saved `false` remains off;
an omitted setting uses the enabled default. The Logger preserves the received
datagram, including its terminator; it has no sending **Append LF** option.

XML is not a UDP format choice. It remains supported by HTTP and WebSocket.

## UI controls

Open **Settings** and use these UDP-specific sections:

| Section | Control | Behavior |
|---|---|---|
| Basics | Format | Selects Delimited (CSV), JSON, GeoJSON, or Esri JSON. |
| Basics | Address family | IPv4 or IPv6; does not rewrite Host. |
| Basics | UDP mode | Direct or Registered; shown for UDP Server publishing. |
| Advanced | Local host | Direct UDP Server local bind interface, default `127.0.0.1`. |
| Advanced | Local port | Direct UDP Server local bind port, default `0` (ephemeral). |
| Advanced | CSV header row | Uses the first logical CSV record as field names and does not publish it. Off by default. |
| Advanced | Append LF | Ensures a trailing LF for delimited payloads only. On by default; preserves an existing LF or CRLF ending. |
| Advanced | X field | Optional X-coordinate field. Configure it together with Y. |
| Advanced | Y field | Optional Y-coordinate field. Configure it together with X. |
| Advanced | WKID | Spatial reference for generated point geometry. Defaults to 4326. |

Connection type, host, port, file selection, replay rate, and playback actions
remain in the main connection surface.

## Tooltip reference

The following text matches the UDP controls:

| Control | Tooltip |
|---|---|
| UDP mode label and initial selector | Choose Direct configured endpoints or Registered compatibility pairing. No UDP mode confirms remote delivery. |
| Direct | Direct - use configured endpoints without registration or acknowledgment. |
| Registered | Registered - compatibility pairing using the existing UDP registration marker; not standard UDP behavior. |
| Local host label and control | Local UDP interface to bind in Direct mode. Loopback is local-only; choose another interface explicitly for remote traffic. |
| Local port label and control | Local UDP bind port in Direct mode. Receivers require a stable port; a publisher may use 0 for an ephemeral port. |
| Address family label and initial selector | Choose IPv4 or IPv6 for UDP. The host must match the selected family. IPv6 sockets accept IPv6 only. |
| IPv4 | IPv4 - use IPv4 addresses and resolve hostnames to IPv4. This is the default. |
| IPv6 | IPv6 - use IPv6 addresses and resolve hostnames to IPv6. IPv4-mapped addresses are not supported. |
| Host input and label, client | Destination address: enter a reachable peer IP address or DNS name matching the selected address family. Do not use 0.0.0.0 or :: as a destination. |
| Host input and label, server IPv4 | Local bind address: 127.0.0.1 accepts same-machine traffic only. A local LAN IP restricts listening to that interface. Use 0.0.0.0 to listen on all local IPv4 interfaces for remote peers or multiple interfaces. This expands network exposure; firewall rules still apply. |
| Host input and label, server IPv6 | Local bind address: ::1 accepts same-machine traffic only. A local IPv6 address restricts listening to that interface. Use :: to listen on all local IPv6 interfaces for remote peers or multiple interfaces. Explicit IPv6 listeners accept IPv6 only. This expands network exposure; firewall rules still apply. |
| Format label | Choose how each logical CSV record is encoded for UDP. |
| Format | UDP payload format. Each converted CSV record is sent as one complete UTF-8 datagram and must fit within 65,507 bytes. |
| Delimited (CSV) | Delimited (CSV) - send each logical CSV record as one UTF-8 datagram. This is the default and preserves existing replay behavior. |
| JSON | JSON - convert each CSV record to one JSON object per datagram. |
| GeoJSON | GeoJSON - convert each CSV record to one GeoJSON Feature per datagram. Configure X and Y fields to create point geometry. |
| Esri JSON | Esri JSON - convert each CSV record to one Esri JSON feature per datagram. Configure X and Y fields to create point geometry. |
| CSV header row | Treat the first logical CSV record as field names and do not send it as an event. Leave off to preserve the existing behavior and generate field_1, field_2, and similar names for structured formats. |
| Append LF | Append LF to each delimited UDP payload. Required by Velocity UDP feeds; ignored for structured formats. The LF counts toward the 65,507-byte datagram limit. |
| X field label | Optional CSV field used as the point X coordinate. |
| X field | Optional CSV field containing the point X coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. GeoJSON requires WKID 4326. |
| Y field label | Optional CSV field used as the point Y coordinate. |
| Y field | Optional CSV field containing the point Y coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. |
| WKID label | Spatial reference WKID used for generated point geometry. |
| WKID | Spatial reference WKID for generated point geometry. GeoJSON requires 4326; Esri JSON includes the configured WKID. |

## Headless and Launch Config

Set `protocol=udp` and choose `udpFormat`. Omitting `udpFormat` selects
`delimited`, including for existing Launch Config files.

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=127.0.0.1 port=5565 udpFormat=json
```

For a local IPv6 receiver, use `ip=::1 udpAddressFamily=ipv6` with the same
command. Existing launch configurations that omit the family remain IPv4.

The CSV header, coordinate mapping, and WKID controls are also honored by
headless and Launch Config workflows when configured. In server mode, use
`waitForClient=true` to hold the first replay record until a recipient
registers. This waiting mode is for the custom application-pair convention,
not for a Velocity UDP feed.

For a delimited Velocity feed, use the reachable data host and enable framing:

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=feed.example.com port=17009 udpFormat=delimited udpAppendNewline=true
```

## Troubleshooting

| Symptom | Check |
|---|---|
| A generic server has no recipients | Start the paired Logger UDP client; after a Simulator restart, allow up to the next renewal for rediscovery (30 seconds by default). Registration can be lost like any UDP datagram. For a Velocity feed, use Simulator UDP Client instead. |
| A delimited Velocity feed receives no records | Enable Append LF and verify the advertised host and port are reachable; a ready UDP socket does not confirm delivery. |
| A record exceeds the limit | Reduce it below 65,507 UTF-8 bytes and account for lower practical limits. |
| The receiver expects several datagrams per event | Reconfigure it for one complete event per datagram; there is no reassembly. |
| Structured conversion fails | Validate the source CSV, header choice, field mappings, and WKID. |
| Datagrams are missing or reordered | UDP has no delivery, ordering, or acknowledgement guarantee; use TCP when those properties are required. |
| Host does not match the family | Correct Host or Address family; check IPv6 availability and DNS records instead of assuming automatic fallback. |

## Related documentation

| Document | Purpose |
|---|---|
| [Data formats](data-formats.md) | Shared payload choices, CSV conversion, geometry, and compatibility. |
| [TCP transport](tcp.md) | Stream roles, framing, controls, and troubleshooting. |
| [Protocol settings and presets](connection-presets.md) | The connection surface and paired local presets. |
| [Headless mode](headless.md) | No-UI replay workflows and completion artifacts. |
| [Command-line reference](command-line.md) | UDP options and common replay parameters. |
| [Velocity sign-in](velocity-login.md) | Feed selection and automatic application. |
