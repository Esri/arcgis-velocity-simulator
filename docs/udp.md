# UDP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator publishes CSV-first records as UDP datagrams to an
explicit receiving endpoint. This guide is for users configuring UDP playback
and developers implementing a compatible receiver. Read [Data
formats](data-formats.md) for shared conversion, header, and schema rules.

## Table of contents

- [Roles and endpoints](#roles-and-endpoints)
- [Address family](#address-family)
- [Velocity feeds](#velocity-feeds)
- [Formats and datagrams](#formats-and-datagrams)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Headless and launch configuration](#headless-and-launch-configuration)
- [Obsolete settings](#obsolete-settings)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Roles and endpoints

Both **UDP Client** and **UDP Server** publish only to main **Host** and **Port**.
Start a receiver listening on that endpoint before replaying:

| Application and role | Direction | Endpoint |
|---|---|---|
| Simulator UDP Client | Publishes. | Main Host and Port are the destination; the operating system assigns the local port. |
| Simulator UDP Server | Publishes. | Main Host and Port are the destination; Advanced Local host and Local port configure the sender bind. |
| Logger UDP Client | Receives. | Advanced Local host and Local port configure the receiver; connection-row Host and Port are unused. |
| Logger UDP Server | Receives. | Main Host and Port configure the local receiver bind. |
| Velocity UDP Client feed | Receives. | Its local receiving host and stable local port. |
| Velocity UDP Server feed | Receives. | Its advertised listening host and port. |
| Velocity UDP Client output | Publishes. | Its configured destination hostname and port. |
| Velocity UDP Server output | Publishes. | Its deployment-advertised destination host and port, which may be fixed. |

UDP has no registration exchange, acknowledgement, or connection handshake.
The Simulator sends no preliminary marker, learns no recipient from incoming
traffic, and never adds a destination because another endpoint sent it data.
Every received datagram is payload, including text that resembles an old
registration marker.

The default destination is `127.0.0.1:5565`, payload format is Delimited, and
UDP address family is IPv4. A UDP Server publisher binds `127.0.0.1:0` by
default. In the paired Logger, the receiving endpoint uses a stable port such
as `5565`; sender and receiver therefore do not compete for the same local
port. Both existing UDP preset identifiers and labels are unchanged, and both
now configure ordinary endpoint-based delivery.

**Ready** describes the open local socket, not a connected remote peer or proof
of delivery. A successful send callback confirms local completion only.
Connection controls are read-only while connecting or active. Disconnect
unlocks the controls and restores the editable section if Summary was selected
automatically for the active connection.

## Address family

Protocol Settings **Basics** offers **IPv4** (default) and **IPv6**. DNS
resolution uses only the selected family; a literal of the other family is
rejected. IPv6 sockets accept IPv6 only, and IPv4-mapped IPv6 addresses are not
supported.

Use `::1` for IPv6 loopback. A UDP Server publisher may use `::` for an
intentional all-interface IPv6 **Local host** bind, or `0.0.0.0` for all local
IPv4 interfaces. Neither wildcard is a destination. Main Host must identify
the receiving machine, not this sender's wildcard bind.

Raw IPv6 and bracketed host-only literals such as `[::1]` are accepted;
enter the port separately. The address-family selector does not rewrite host
values. Configure Local host to match the family when using UDP Server.

## Velocity feeds

Apply selects Simulator UDP Client for both feed types, using their receiving
endpoint rather than inferring direction from the connector label.

The UDP Client fields are `udp-client.localHost` and `udp-client.localPort`.
The old remote publisher `hostname` and `port` are not substituted for missing
local endpoint metadata. A blank or wildcard local host can be valid for a
receiver's bind, but cannot be used as a routable destination: configure the
Simulator manually with a reachable address of the receiving machine.

Apply does not require or return a UDP connection-mode setting. Explicit
obsolete registration metadata is rejected with a clear unsupported message.
The management API URL and `webContextURL` are never used to guess a UDP data
endpoint. A deployed receiver that still requires a registration protocol is
not supported by these direct-only publishing paths.

Apply treats Velocity UDP Server feeds as IPv4-only. The mapper accepts
IPv6 local endpoint metadata for UDP Client feeds, but installed service,
operating-system, firewall, and routing support must be checked independently.
Application capability does not certify a deployed endpoint.

## Formats and datagrams

Choose Delimited (CSV), JSON, GeoJSON, or Esri JSON. The Simulator sends one
complete UTF-8 payload per datagram and does not split a record or reassemble
across datagrams. The absolute payload cap is 65,507 bytes, including any
terminator; practical platform and network limits may be lower.

**Append LF** defaults to on for delimited payloads only. It appends LF when
the payload does not already end with LF; existing LF or CRLF endings are
preserved. Set `udpAppendNewline=false` to send the original delimited bytes.
Explicit false remains false when loading configurations. Structured formats
are unchanged regardless of this setting. XML is not a Simulator UDP format.

The Simulator **CSV header row** setting consumes the first source record when
on; when off, that record is sent as data. A receiver's header setting must
match the actual transmitted records. See [Fields and geometry](data-formats.md#fields-and-geometry).
LF framing can be required by a receiving delimited parser or sampler; the
Simulator does not repair remote sampling or schema-derivation failures.

## UI controls

There is no UDP Direct/Registered selector. Open **Settings** for these controls:

| Section | Control | Behavior |
|---|---|---|
| Basics | Format | Delimited, JSON, GeoJSON, or Esri JSON. |
| Basics | Address family | IPv4 or IPv6. |
| Advanced | Local host | UDP Server publisher bind interface; default `127.0.0.1`. |
| Advanced | Local port | UDP Server publisher bind port; default `0`. |
| Advanced | CSV header row | Consume the first logical source record as field names; off by default. |
| Advanced | Append LF | Ensure one trailing LF for delimited payloads; on by default. |
| Advanced | X field and Y field | Optional paired point-coordinate mappings. |
| Advanced | WKID | Geometry spatial reference; default 4326. |

Host and Port remain the destination in the main connection row. Local bind
controls apply only to UDP Server. **Done** keeps edits, **Revert changes**
restores the opening values, and **Reset to preset** restores a modified preset.
Delayed edits from a detached window are rejected while controls are locked.

## Tooltip reference

These strings match the current controls:

| Control | Tooltip |
|---|---|
| UDP Server connection type | UDP Server - sends datagrams to the specified destination using a separate local bind. Connectionless; no handshake or acknowledgment. |
| UDP Client connection type | UDP Client - sends UDP datagrams to the specified host and port. Connectionless; no handshake or acknowledgment. |
| Selected UDP Server | UDP Server - sends datagrams to the specified destination using a separate local bind. |
| Selected UDP Client | UDP Client - sends UDP datagrams to the specified host and port. |
| Inverse local UDP preset | Local UDP - Simulator Server / Logger Client. The Simulator binds UDP 127.0.0.1:0 and sends datagrams to the Logger receiving on 127.0.0.1:5565. |
| Local host label and control | Local UDP publisher interface, separate from the receiving destination. Loopback is local-only; choose another interface explicitly for remote traffic. |
| Local port label and control | Local UDP publisher port, separate from the receiving destination port. Use 0 for an ephemeral sender port. |
| Address family label and initial selector | Choose IPv4 or IPv6 for UDP. The host must match the selected family. IPv6 sockets accept IPv6 only. |
| IPv4 | IPv4 - use IPv4 addresses and resolve hostnames to IPv4. This is the default. |
| IPv6 | IPv6 - use IPv6 addresses and resolve hostnames to IPv6. IPv4-mapped addresses are not supported. |
| Host input and label, both roles | Destination address: enter a reachable peer IP address or DNS name matching the selected address family. Do not use 0.0.0.0 or :: as a destination. |
| Format label and initial selector | UDP payload format. Each converted CSV record is sent as one complete UTF-8 datagram and must fit within 65,507 bytes. |
| Selected Delimited format | UDP Format: Delimited (CSV). Send each logical CSV record as UTF-8 text. This is the default and preserves the existing replay workflow. |
| Selected JSON format | UDP Format: JSON. Convert each logical CSV record to a JSON object using the header row or generated field names. |
| Selected GeoJSON format | UDP Format: GeoJSON. Convert each logical CSV record to an RFC 7946 Feature. Set X and Y fields for point geometry, or leave them empty for null geometry. |
| Selected Esri JSON format | UDP Format: Esri JSON. Convert each logical CSV record to an Esri JSON feature with attributes and optional point geometry. |
| Delimited option | Delimited (CSV) - send each logical CSV record as one UTF-8 datagram. This is the default and preserves existing replay behavior. |
| JSON option | JSON - convert each CSV record to one JSON object per datagram. |
| GeoJSON option | GeoJSON - convert each CSV record to one GeoJSON Feature per datagram. Configure X and Y fields to create point geometry. |
| Esri JSON option | Esri JSON - convert each CSV record to one Esri JSON feature per datagram. Configure X and Y fields to create point geometry. |
| CSV header row | Treat the first logical CSV record as field names and do not send it as an event. Leave off to preserve the existing behavior and generate field_1, field_2, and similar names for structured formats. |
| Append LF | Append LF to each delimited UDP payload. Required by Velocity UDP feeds; ignored for structured formats. The LF counts toward the 65,507-byte datagram limit. |
| X field | Optional CSV field containing the point X coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. GeoJSON requires WKID 4326. |
| Y field | Optional CSV field containing the point Y coordinate. Set both X and Y for GeoJSON or Esri JSON point geometry. |
| WKID | Spatial reference WKID for generated point geometry. GeoJSON requires 4326; Esri JSON includes the configured WKID. |

## Headless and launch configuration

For a receiver listening on `127.0.0.1:5565`:

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=127.0.0.1 port=5565
```

The alternate publishing role supports a separately configured local bind:

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=server ip=127.0.0.1 port=5565 udpLocalHost=127.0.0.1 udpLocalPort=0
```

Neither command waits for inbound registration. `waitForClient` cannot verify
that the configured UDP receiver is available. For IPv6, select
`udpAddressFamily=ipv6` and use matching destination/local addresses.

## Obsolete settings

`udpConnectionMode` and `udpRegistrationIntervalMs` are unsupported, including
an old `udpConnectionMode=direct` value. Remove these keys and review the
receiving destination and local bind explicitly. The application does not
migrate old publisher/receiver endpoint meanings or silently restore a
registration mode. Configurations containing only the current endpoint options
are valid without a mode key.

## Troubleshooting

| Symptom | Check |
|---|---|
| Ready but the receiver has no records | Check the receiver's listening port, actual destination, firewall, and routing; local send success does not prove delivery. |
| A local port is already occupied | Use port `0` for the publisher where supported, or select an available local interface/port. One receiving application must own the destination port. |
| Obsolete registration option rejected | Remove the unsupported keys and configure current local and receiving endpoints explicitly. |
| A wildcard endpoint cannot be applied | Enter a routable receiving address manually; never use the management API host as a guess. |
| A delimited sample is incomplete | Check LF and the actual transmitted header before reviewing the remote sampler's diagnostics. |
| A record exceeds the limit | Reduce the complete encoded payload, including LF, below the applicable datagram limit. |
| Host and family do not match | Correct the literal/DNS family and the local bind for IPv6. |

## Related documentation

| Guide | Purpose |
|---|---|
| [Data formats](data-formats.md) | CSV conversion, header handling, geometry, and framing. |
| [TCP transport](tcp.md) | Stream roles and optional greetings. |
| [Protocol settings and presets](connection-presets.md) | Connection controls and paired local presets. |
| [Headless mode](headless.md) | No-UI replay and completion artifacts. |
| [Command-line reference](command-line.md) | Current option values and defaults. |
| [Velocity sign-in](velocity-login.md) | Endpoint selection and application. |
