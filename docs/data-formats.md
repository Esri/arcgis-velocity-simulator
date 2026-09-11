# Data formats

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator reads CSV-first source files and can publish each
logical record as Delimited (CSV), JSON, GeoJSON, or Esri JSON over TCP and
UDP. This guide is for users configuring payloads and developers integrating a
receiver. It owns the concepts shared by the TCP and UDP format controls.

## Table of contents

- [Three different formats](#three-different-formats)
- [Payload formats](#payload-formats)
- [CSV records and conversion](#csv-records-and-conversion)
- [Fields and geometry](#fields-and-geometry)
- [Transport framing](#transport-framing)
- [Examples](#examples)
- [Compatibility and limitations](#compatibility-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Three different formats

Keep these choices separate:

| Choice | Meaning |
|---|---|
| Input format | The Simulator source is a CSV or text file interpreted as logical CSV records. |
| Payload format | `tcpFormat` or `udpFormat` determines what the Simulator publishes for each source record. |
| Capture or export format | The Logger's capture and export choice controls saved output, not the payload accepted from the Simulator. |

gRPC serialization is also separate. Protobuf, Kryo, and Text describe the
gRPC wire contract and are not TCP or UDP payload formats.

## Payload formats

| UI choice | Option value | Payload for each logical CSV record |
|---|---|---|
| Delimited (CSV) | `delimited` | The complete logical CSV record as UTF-8 text. This is the default. |
| JSON | `json` | One complete JSON object whose properties are the mapped fields. |
| GeoJSON | `geo-json` | One GeoJSON Feature with properties and either Point or null geometry. |
| Esri JSON | `esri-json` | One Esri JSON feature with attributes and optional point geometry. |

XML remains available for the existing HTTP and WebSocket format selectors,
but TCP and UDP do not currently offer XML. RSS, GeoRSS, Shapefile, and Parquet
are not generic socket payload formats.

## CSV records and conversion

The Simulator parses logical CSV records rather than treating every physical
file line as a separate event. Quoted fields, escaped quotes, and newlines
embedded in a quoted field remain part of the same record.

Delimited preserves the logical record and the existing CSV-first replay
behavior. Structured formats parse the record into typed field values and
build an object or feature. Conversion rejects malformed CSV, invalid field or
geometry mappings, and a UDP payload that exceeds the datagram limit before
the record is sent.

Boolean and finite numeric values are inferred conservatively. Integer values
outside JavaScript's safe range and values with more than 15 significant
digits remain strings so conversion cannot silently change an identifier or
high-precision measurement. Values that would underflow or use subnormal
floating-point representation, leading-zero values, dates, and negative zero
also remain strings.

All user interface, headless, and Launch Config workflows use Delimited when
the protocol-specific option is absent. Existing configurations therefore keep
their current behavior.

## Fields and geometry

The **CSV header row** setting controls schema selection:

- Off, the default, preserves backward compatibility. Structured payloads use
  deterministic names such as `field_1`, `field_2`, and `field_3`.
- On, the first logical CSV record supplies the field names and is not sent as
  an event.

**X field** and **Y field** are optional, but they must be configured together
to produce point geometry. With neither mapping, GeoJSON uses null geometry and
Esri JSON contains attributes without generated point geometry.

**WKID** defaults to `4326`. GeoJSON point coordinates require WKID 4326.
Esri JSON includes the configured WKID in generated geometry.

## Transport framing

TCP is a byte stream. The Simulator terminates each logical payload with a
newline, but the network may fragment one payload across reads or coalesce
several payloads into one read. A TCP receiver must buffer bytes and frame
newline-separated records; it must not assume one socket read equals one event.
Each TCP payload is limited to 1 MiB so senders and receivers apply the same
bounded record size. A complete oversized inbound record is retained with a
warning; an incomplete record that exceeds the bound is reset.

UDP preserves datagram boundaries. The Simulator sends exactly one complete
logical payload per datagram. A payload must be no more than 65,507 UTF-8 bytes,
and there is no cross-datagram reassembly. Practical network, platform, and
receiver limits may be lower, so smaller datagrams are more portable.

## Examples

Given a source file with a header:

```text
id,name,x,y
7,"Station, North",-117.2,34.1
```

Enable **CSV header row** and select JSON to publish:

```json
{"id":7,"name":"Station, North","x":-117.2,"y":34.1}
```

Select GeoJSON, set **X field** to `x`, **Y field** to `y`, and leave WKID at
4326 to publish a feature shaped as follows:

```json
{"type":"Feature","geometry":{"type":"Point","coordinates":[-117.2,34.1]},"properties":{"id":7,"name":"Station, North","x":-117.2,"y":34.1}}
```

Select Esri JSON with the same mappings to publish a feature with an
`attributes` object and point geometry carrying the configured spatial
reference.

## Compatibility and limitations

The receiving endpoint must be configured for the same payload format and
framing. ArcGIS Velocity feed schema and geometry settings must agree with the
field names and values the Simulator emits.

The Logger preserves the raw received payload. It may report validation
warnings, but choosing a Logger capture or export format does not convert the
incoming TCP or UDP payload.

TCP and UDP support Delimited, JSON, GeoJSON, and Esri JSON. XML support for
these two transports is deferred; use HTTP or WebSocket when an XML payload is
required.

## Troubleshooting

| Symptom | Check |
|---|---|
| The header appears as an event | Enable **CSV header row** for a structured format. |
| Generated names such as `field_1` appear | Enable **CSV header row**, or configure the receiver for the deterministic generated names. |
| Geometry is null or absent | Set both **X field** and **Y field**, and confirm both values are valid coordinates. |
| GeoJSON conversion is rejected | Set WKID to `4326` and verify the coordinate mappings. |
| TCP records appear joined or partial | Buffer the TCP byte stream and split complete newline-terminated payloads. |
| UDP send is rejected | Reduce the record size below 65,507 UTF-8 bytes and account for any lower receiver or network limit. |
| CSV conversion fails | Check quoting, escaped quotes, column counts, header names, and coordinate mappings. |

## Related documentation

| Document | Purpose |
|---|---|
| [TCP transport](tcp.md) | TCP roles, controls, stream framing, headless use, and troubleshooting. |
| [UDP transport](udp.md) | UDP roles, controls, datagram limits, headless use, and troubleshooting. |
| [HTTP and HTTPS transport](http.md) | HTTP formats, request behavior, paths, and TLS. |
| [WebSocket transport](websocket.md) | WebSocket formats, message behavior, paths, and TLS. |
| [gRPC transport](grpc.md) | The separate gRPC serialization choices and service contracts. |
| [Command-line reference](command-line.md) | Every option, supported value, default, and example. |
