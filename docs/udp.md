# UDP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator publishes CSV-first source records as UDP datagrams
in client or server mode. This guide is for users configuring a UDP feed and
developers implementing a compatible receiver. Read [Data
formats](data-formats.md) for shared conversion and schema rules.

## Table of contents

- [Roles and defaults](#roles-and-defaults)
- [Velocity feeds](#velocity-feeds)
- [Formats and datagrams](#formats-and-datagrams)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Headless and Launch Config](#headless-and-launch-config)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Roles and defaults

**UDP Client** sends datagrams to the selected remote address and port without
a handshake or acknowledgement. **UDP Server** binds the selected address and
learns recipient endpoints from inbound datagrams before publishing replayed
records to them. A paired Logger UDP client sends the literal
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
Velocity UDP feeds do not register recipients, and the Simulator UDP Client
never sends a registration or renewal datagram.

The shared default address is `127.0.0.1`, the default port is `5565`, and the
default format is Delimited. Local presets fill the paired role and address but
do not connect or start playback.

## Velocity feeds

Both **UDP Client** and **UDP Server** Velocity feeds receive datagrams.
Use **UDP Client** in the Simulator for either feed type. **Apply** selects that
role and the advertised data host and port; it never waits for registration.
The first outbound datagram is a replay payload, not a probe or handshake.

The advertised `hostName` is preferred over `hostname` and `host`. The owning
management API URL and `webContextURL` do not identify UDP data routing and are
never substituted for a missing UDP host. A UDP Client feed's hostname is its
Velocity-local bind address. If it is missing, wildcard (`0.0.0.0`), or
unreachable from the Simulator, configure UDP Client manually with a reachable
IPv4 host or DNS name and the feed port. Review firewall and forwarding rules.
IPv6 automatic configuration and XML payloads are not supported.

For Delimited feeds, **Apply** enables **Append LF**. UDP Server feeds require
LF-terminated records; without LF, records can remain buffered and subsequent
datagrams can be concatenated. LF also supports UDP Client feed sampling.
Structured formats do not need this terminator. The option is off by default
for generic connections and local application-pair presets.

## Formats and datagrams

Choose Delimited (CSV), JSON, GeoJSON, or Esri JSON. Delimited preserves the
complete logical CSV record. Structured choices convert it using the schema and
optional geometry settings described in [Data formats](data-formats.md).

The Simulator sends exactly one complete UTF-8 logical payload per datagram.
The absolute payload maximum is 65,507 bytes, including an enabled LF terminator.
Oversize payloads are rejected
before send, and one event is never split across datagrams. Practical network,
platform, and receiver limits may be lower.

XML is not a UDP format choice. It remains supported by HTTP and WebSocket.

## UI controls

Open **Settings** and use these UDP-specific sections:

| Section | Control | Behavior |
|---|---|---|
| Basics | Format | Selects Delimited (CSV), JSON, GeoJSON, or Esri JSON. |
| Advanced | CSV header row | Uses the first logical CSV record as field names and does not publish it. Off by default. |
| Advanced | Append LF | Appends LF to delimited payloads only. Off by default; enabled when applying a delimited Velocity UDP feed. |
| Advanced | X field | Optional X-coordinate field. Configure it together with Y. |
| Advanced | Y field | Optional Y-coordinate field. Configure it together with X. |
| Advanced | WKID | Spatial reference for generated point geometry. Defaults to 4326. |

Connection type, host, port, file selection, replay rate, and playback actions
remain in the main connection surface.

## Tooltip reference

The following text matches the UDP controls:

| Control | Tooltip |
|---|---|
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

## Related documentation

| Document | Purpose |
|---|---|
| [Data formats](data-formats.md) | Shared payload choices, CSV conversion, geometry, and compatibility. |
| [TCP transport](tcp.md) | Stream roles, framing, controls, and troubleshooting. |
| [Protocol settings and presets](connection-presets.md) | The connection surface and paired local presets. |
| [Headless mode](headless.md) | No-UI replay workflows and completion artifacts. |
| [Command-line reference](command-line.md) | UDP options and common replay parameters. |
| [Velocity sign-in](velocity-login.md) | Feed selection and automatic application. |
