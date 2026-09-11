# TCP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator publishes CSV-first source records over a TCP byte
stream in client or server mode. This guide is for users configuring a TCP feed
and developers implementing a compatible receiver. Read [Data
formats](data-formats.md) for the shared conversion and schema rules.

## Table of contents

- [Roles and defaults](#roles-and-defaults)
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

## Troubleshooting

| Symptom | Check |
|---|---|
| Connection is refused | Confirm the server is listening at the selected host and port; optionally use `connectWaitForServer=true`. |
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
