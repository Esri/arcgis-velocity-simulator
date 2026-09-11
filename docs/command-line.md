# Command-line reference

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The ArcGIS Velocity Simulator supports both normal UI startup and true headless
execution. This reference lists every command-line parameter, its supported
values, its default, whether it is required in headless mode, and a worked
example.

It is written for users and developers who script the Simulator or drive it from
a terminal. The same parameter metadata is surfaced in the in-app Command Line
Interface dialog (`F3`), so this guide and the dialog always agree.

## Table of contents

- [Default behavior](#default-behavior)
- [In-app Command Line Interface dialog reference](#in-app-command-line-interface-dialog-reference)
- [Required vs optional parameters](#required-vs-optional-parameters)
- [Parameter reference](#parameter-reference)
- [Connection presets and the command line](#connection-presets-and-the-command-line)
- [IP address behavior](#ip-address-behavior)
- [Aliases and shortcuts](#aliases-and-shortcuts)
- [Help layout parameters](#help-layout-parameters)
- [Typo suggestions](#typo-suggestions)
- [Usage examples](#usage-examples)
- [Related documentation](#related-documentation)

## Default behavior

When you launch the app with **no parameters**, it starts in the normal **UI
mode** and preserves saved UI behavior from configuration, including the saved
compact/full view.

```bash
npm start
```

To run without the UI, launch headless mode explicitly:

```bash
npm run start:headless -- filename=./data.csv
```

You can also use the regular launcher and pass `runMode=headless` (or
`runMode=silent`):

```bash
npm start -- runMode=headless filename=./data.csv
```

## In-app Command Line Interface dialog reference

Press `F3` while the app is open to view the dedicated **Command Line
Interface** window. You can also open it from **Help → Command Line Interface**
or from the main window context menu. This non-modal reference window uses
native close, minimize, and maximize controls, focuses its existing instance,
and restores its last size and position within the current display. The window
is generated from the same metadata used by terminal help output and this
markdown guide, so the in-app table and the CLI docs stay aligned.

The Command Line Interface dialog supports:

- **Search filtering** across parameter names, defaults, supported values, examples, and descriptive purpose text
- **Quick filter chips** for All, Required, Optional, Headless-only, and Help-related parameters
- **Sortable columns** for all visible parameter fields
- **Copy example commands** directly from the examples list
- **Copy/export visible rows** in `TSV`, `CSV`, `Markdown`, or `JSON`
- **Keyboard shortcuts**: `Ctrl+F` / `Cmd+F` or `/` to focus the filter, and `Escape` to close the dialog

If you prefer a terminal-first workflow, the `help`, `help-detailed`,
`help-table-narrow`, `help-table-wide`, and `help-wide` launch options below
expose the same parameter catalog in text form.

Unknown CLI parameters are treated as startup errors. If you pass an unsupported
`name=value` parameter, an unsupported bare flag like `--bogus`, or a bare
positional argument without `name=value` syntax (e.g. `npm start -- hhh`), the
app logs a clear console error and exits gracefully without launching the UI or
headless runner. For close misspellings, the error includes a `Did you mean
...?` suggestion selected with Levenshtein edit distance. Unknown-parameter
errors also show how to open help (for example `electron . help=true` or
`--help`) but do **not** dump the full help table because that output is too
verbose.

**Inapplicable parameters in the correct mode are warnings, not errors.** When a
headless-only parameter (e.g. `port=6000`, `protocol=udp`, `logLevel=debug`) is
passed in UI mode, the app logs a `CLI warning:` line per parameter explaining
why it has no effect, then continues to launch normally. The same applies in
headless mode for parameters that don't apply to the selected sub-configuration
(e.g. `connectRetryIntervalMs` when `connectWaitForServer=false`).

## Required vs optional parameters

### Required in headless mode

- `filename` - always required once headless mode is selected

### Required only to switch from normal launch into headless mode

- `runMode=headless` or `runMode=silent` - required when using the normal app launcher instead of `npm run start:headless`

### Optional in headless mode

All other parameters are optional because they have defaults.

## Parameter reference

The table below mirrors the in-app Command Line Interface dialog columns so
terminal help, the dialog, and this guide use the same terminology.

| Name | Supported Values | Default | Required in Headless Mode | Example | Purpose |
| --- | --- | --- | --- | --- | --- |
| `allowUnverifiedTls` | `true`, `false` | `false` | No | `allowUnverifiedTls=true` | Explicitly accept an unverified gRPC server certificate in client mode. The connection stays encrypted, but the server identity is not checked and the bypass applies to any host, not only localhost. Server mode is unaffected. Only applies when `protocol=grpc`, `mode=client`, and `useTls=true`. See [TLS and SSL security](tls.md#explicit-certificate-verification-bypass). |
| `autoConnect` | `true`, `false` | `true` | No | `autoConnect=false` | Connect automatically before streaming begins. |
| `autoStart` | `true`, `false` | `true` | No | `autoStart=false` | Start streaming immediately after initialization. |
| `config` | `path`, `omitted` | `(none)` | No | `config=./docs/examples/launch-config.server.sample.json` | Optional JSON launch-config file. CLI values override config-file values. |
| `connectRetryIntervalMs` | `integer >= 1` | `1000` | No | `connectRetryIntervalMs=3000` | Milliseconds to wait between connection retry attempts when `connectWaitForServer=true`. Has no effect when `connectWaitForServer=false`. |
| `connectTimeoutMs` | `integer >= 0` | `0` | No | `connectTimeoutMs=5000` | Timeout for connect/bind operations and recipient waiting. |
| `connectWaitForServer` | `true`, `false` | `false` | No | `connectWaitForServer=true` | In client mode, retry the connection when the server is not yet available (or after a server restart) instead of failing immediately. Use `connectTimeoutMs` to set an overall deadline and `connectRetryIntervalMs` to tune the retry interval. Ignored in server mode. |
| `doneFile` | `path`, `omitted` | `(none)` | No | `doneFile=./logs/run.done.json` | Optional JSON success/failure artifact for schedulers and CI. |
| `endLine` | `integer >= startLine`, `null/omitted` | `(none)` | No | `endLine=500` | 1-based inclusive end line for the replay window. Defaults to the end of the file. |
| `exitOnComplete` | `true`, `false` | `true` | No | `exitOnComplete=false` | Exit after a completed headless run when applicable. |
| `explain` | `true`, `false` | `true` | No | `explain=false` | Print a detailed startup explanation showing the resolved run mode, active parameters, defaults, and warnings about ignored parameters. In both UI and headless modes, this includes a "UI Configuration" or "Headless Configuration" section and a "Behavior Summary" section. Enabled by default; set to false to suppress. |
| `filename` | `absolute-or-relative-path` | `(none)` | Yes | `filename=./data.csv` | Input CSV/TXT file to replay. |
| `help` | `true`, `false` | `false` | No | `help=true` | Print a compact ASCII-table parameter summary (name, values, default, purpose) without the example column and exit without running the app. Also available as `h=true`, `--help`, and `-h`. |
| `help-detailed` | `true`, `false` | `false` | No | `help-detailed=true` | Print full detailed CLI help with all parameter details (default, required, values, example, purpose) and exit without running the app. |
| `help-table-narrow` | `true`, `false` | `false` | No | `help-table-narrow=true` | Print CLI help in a narrower ASCII-table layout for smaller terminals, then exit. |
| `help-table-wide` | `true`, `false` | `false` | No | `help-table-wide=true` | Print CLI help in a wide ASCII-table layout for larger terminals, then exit. |
| `help-wide` | `true`, `false` | `false` | No | `help-wide=true` | Print a compact ASCII-table parameter summary (name, values, default, example, purpose) and exit without running the app. |
| `httpAllowUnverifiedTls` | `true`, `false` | `false` | No | `httpAllowUnverifiedTls=true` | Explicitly accept an unverified HTTPS server certificate in client mode. The connection stays encrypted, but the server identity is not checked and the bypass applies to any host, not only localhost. Server mode is unaffected. Only applies when `protocol=http`, `mode=client`, and `httpTls=true`. See [TLS and SSL security](tls.md#explicit-certificate-verification-bypass). |
| `httpFormat` | `json`, `delimited`, `esri-json`, `geo-json`, `xml` | `delimited` | No | `httpFormat=geo-json` | HTTP payload format and outgoing `Content-Type`. Only applies when `protocol=http`. |
| `httpPolling` | `true`, `false` | `false` | No | `httpPolling=true` | HTTP Server: serve the latest replay payload to ordinary GET requests at `httpPath`. Use for a GET-based HTTP Poller feed. |
| `httpPath` | `string` | `/` | No | `httpPath=/receiver/feed-id` | Exact HTTP POST, health-check, and SSE path. In client mode it is appended to the target URL; in server mode other paths return 404. A missing leading slash is added. |
| `httpTls` | `true`, `false` | `true` | No | `httpTls=false` | Use HTTPS when true or unsecure HTTP when false. Client mode uses the system/Node trust store by default; server mode uses the configured certificate/key or the shared auto-generated self-signed identity. |
| `httpTlsCaPath` | `path`, `omitted` | `(none)` | No | `httpTlsCaPath=./certs/ca.pem` | Custom CA certificate PEM for HTTPS. In client mode, leaving it empty uses the system/Node trust store. |
| `httpTlsCertPath` | `path`, `omitted` | `(none)` | No | `httpTlsCertPath=./certs/server.pem` | HTTPS client mTLS or server identity certificate PEM. Pair it with `httpTlsKeyPath`. |
| `httpTlsKeyPath` | `path`, `omitted` | `(none)` | No | `httpTlsKeyPath=./certs/server-key.pem` | Private key PEM corresponding to `httpTlsCertPath`. |
| `intervalMs` | `integer >= 1` | `1000` | No | `intervalMs=250` | Delay in milliseconds between scheduler ticks. |
| `ip` | `IPv4-or-host-bind-address` | `127.0.0.1` | No | `ip=192.168.1.25` | Bind address for server mode or destination address for client mode. Default `127.0.0.1` is loopback/local-only. |
| `linesPerInterval` | `integer >= 1` | `1` | No | `linesPerInterval=5` | Number of lines processed during each scheduler tick. |
| `logFile` | `path`, `omitted` | `(none)` | No | `logFile=./logs/run.log` | Optional file path for persisted headless logs. |
| `logLevel` | `error`, `warn`, `info`, `debug` | `info` | No | `logLevel=debug` | Minimum log level written to stdout/logFile in headless mode. |
| `loop` | `true`, `false` | `false` | No | `loop=true` | Restart from `startLine` after reaching `endLine`. |
| `maxLines` | `integer >= 1`, `null/omitted` | `(none)` | No | `maxLines=1000` | Optional cap on successfully processed lines. |
| `mode` | `server`, `client` | `server` | No | `mode=client` | Choose whether the simulator binds locally or connects outward. |
| `onError` | `exit`, `continue`, `pause` | `exit` | No | `onError=continue` | Choose how send failures are handled: exit, continue, or pause. |
| `port` | `1-65535` | `5565` | No | `port=6000` | Target or bind port. |
| `protocol` | `tcp`, `udp`, `grpc`, `http`, `ws`, `xmpp` | `tcp` | No | `protocol=udp` | Choose the network transport for headless replay. See [gRPC transport](grpc.md), [HTTP and HTTPS transport](http.md), [WebSocket transport](websocket.md), and [XMPP transport](xmpp.md) for protocol details. When `protocol=xmpp`, the role defaults to `client` and the port defaults to `5222` unless `mode` or `port` is given explicitly. |
| `grpcHeaderPath` | `string` | `replace.with.dedicated.uid` | No | `grpcHeaderPath=my.feed.uid` | Value sent as the gRPC endpoint header path. Injected as gRPC metadata on every outgoing call. Only applies when `protocol=grpc` and `mode=client`. See [gRPC transport](grpc.md). |
| `grpcHeaderPathKey` | `string` | `grpc-path` | No | `grpcHeaderPathKey=grpc-path` | Key name for the gRPC endpoint header path metadata entry. Only applies when `protocol=grpc` and `mode=client`. See [gRPC transport](grpc.md). |
| `runId` | `string`, `omitted` | `(none)` | No | `runId=nightly-01` | Optional identifier added to logs and done-file output. |
| `runMode` | `ui`, `headless`, `silent` | `ui` | Only when using the normal launcher to enter headless mode | `runMode=headless` | Select startup mode. No parameters means normal UI mode and restores saved UI behavior from configuration, including compact/full view. |
| `grpcSerialization` | `protobuf`, `kryo`, `text` | `protobuf` | No | `grpcSerialization=text` | gRPC feature serialization format. `protobuf` uses the Velocity external GrpcFeed protocol with typed Any-wrapped attributes. `kryo` uses the internal GrpcFeatureService protocol with raw bytes. `text` uses the internal protocol with plain UTF-8 text. Only applies when `protocol=grpc`. See [gRPC transport](grpc.md). |
| `grpcSendMethod` | `stream`, `unary` | `stream` | No | `grpcSendMethod=unary` | gRPC RPC type for client-mode sending. `stream` (default) uses a Client Streaming RPC — multiplexes all messages over a single persistent HTTP/2 stream for higher throughput. `unary` uses a Unary RPC — sends each message as a discrete request/response round-trip, easier to trace and debug. Only applies when `protocol=grpc` and `mode=client`. See [gRPC transport](grpc.md#send-methods-rpc-types). |
| `startLine` | `integer >= 1` | `1` | No | `startLine=100` | 1-based inclusive start line for the replay window. |
| `stdout` | `true`, `false` | `true` | No | `stdout=false` | Enable or disable console log output during headless runs. |
| `tcpFormat` | `delimited`, `json`, `geo-json`, `esri-json` | `delimited` | No | `tcpFormat=json` | TCP payload format. The Simulator converts each logical CSV record before sending it; Delimited preserves the existing newline-terminated CSV behavior. Only applies when `protocol=tcp`. See [Data formats](data-formats.md) and [TCP transport](tcp.md). |
| `tcpInputHasHeader` | `true`, `false` | `false` | No | `tcpInputHasHeader=true` | Treat the first logical CSV record as TCP field names and do not send it as an event. When false, structured formats use deterministic names such as `field_1` and `field_2`. |
| `tcpXField` | field name, `omitted` | `(none)` | No | `tcpXField=longitude` | Optional CSV field used as the point X coordinate for TCP GeoJSON or Esri JSON conversion. Set it together with `tcpYField`. |
| `tcpYField` | field name, `omitted` | `(none)` | No | `tcpYField=latitude` | Optional CSV field used as the point Y coordinate for TCP GeoJSON or Esri JSON conversion. Set it together with `tcpXField`. |
| `tcpWkid` | `integer >= 1` | `4326` | No | `tcpWkid=4326` | Spatial reference WKID for generated TCP point geometry. GeoJSON requires 4326; Esri JSON includes the configured WKID. |
| `udpFormat` | `delimited`, `json`, `geo-json`, `esri-json` | `delimited` | No | `udpFormat=geo-json` | UDP payload format. Each converted logical CSV record is one complete UTF-8 datagram and must not exceed 65,507 bytes. Only applies when `protocol=udp`. See [Data formats](data-formats.md) and [UDP transport](udp.md). |
| `udpInputHasHeader` | `true`, `false` | `false` | No | `udpInputHasHeader=true` | Treat the first logical CSV record as UDP field names and do not send it as an event. When false, structured formats use deterministic names such as `field_1` and `field_2`. |
| `udpXField` | field name, `omitted` | `(none)` | No | `udpXField=longitude` | Optional CSV field used as the point X coordinate for UDP GeoJSON or Esri JSON conversion. Set it together with `udpYField`. |
| `udpYField` | field name, `omitted` | `(none)` | No | `udpYField=latitude` | Optional CSV field used as the point Y coordinate for UDP GeoJSON or Esri JSON conversion. Set it together with `udpXField`. |
| `udpWkid` | `integer >= 1` | `4326` | No | `udpWkid=4326` | Spatial reference WKID for generated UDP point geometry. GeoJSON requires 4326; Esri JSON includes the configured WKID. |
| `waitForClient` | `true`, `false` | `false` | No | `waitForClient=true` | In server mode, wait for at least one recipient before advancing through the file. When false (the default), data is sent immediately and lines are advanced even if no client is connected. Ignored in client mode. |
| `wsAllowUnverifiedTls` | `true`, `false` | `false` | No | `wsAllowUnverifiedTls=true` | Explicitly accept an unverified WSS server certificate in client mode. The connection stays encrypted, but the server identity is not checked and the bypass applies to any host, not only localhost. Server mode is unaffected. Only applies when `protocol=ws`, `mode=client`, and `wsTls=true`. See [TLS and SSL security](tls.md#explicit-certificate-verification-bypass). |
| `wsFormat` | `json`, `delimited`, `esri-json`, `geo-json`, `xml` | `delimited` | No | `wsFormat=json` | WebSocket message format and associated content type. Only applies when `protocol=ws`. |
| `wsHeaders` | JSON string, `omitted` | `(none)` | No | `wsHeaders={"X-Client":"simulator"}` | Client-only JSON object of custom HTTP headers included in the WebSocket upgrade request. |
| `wsIgnoreFirstMsg` | `true`, `false` | `false` | No | `wsIgnoreFirstMsg=true` | Client-only: silently discard the first received frame, such as a subscription acknowledgement. |
| `wsPath` | `string` | `/` | No | `wsPath=/feed` | WebSocket upgrade path appended to the target address and enforced by server mode. A missing leading slash is added. |
| `wsSubscriptionMsg` | `string`, `omitted` | `(none)` | No | `wsSubscriptionMsg=subscribe:feed1` | Client-only text frame sent immediately after the WebSocket opens. |
| `wsTls` | `true`, `false` | `true` | No | `wsTls=false` | Use WSS when true or unsecure WS when false. Client mode uses the system/Node trust store by default; server mode uses the configured certificate/key or shared auto-generated self-signed identity. |
| `wsTlsCaPath` | `path`, `omitted` | `(none)` | No | `wsTlsCaPath=./certs/ca.pem` | Custom CA certificate PEM for WSS. In client mode, leaving it empty uses the system/Node trust store. |
| `wsTlsCertPath` | `path`, `omitted` | `(none)` | No | `wsTlsCertPath=./certs/server.pem` | WSS client mTLS or server identity certificate PEM. Pair it with `wsTlsKeyPath`. |
| `wsTlsKeyPath` | `path`, `omitted` | `(none)` | No | `wsTlsKeyPath=./certs/server-key.pem` | Private key PEM corresponding to `wsTlsCertPath`. |
| `xmppAllowRemote` | `true`, `false` | `false` | No | `xmppAllowRemote=true` | Allow the built-in XMPP server to bind a non-loopback address so remote clients can sign in. Left false the server binds loopback only. Only applies when `protocol=xmpp` and `mode=server`. See [XMPP transport](xmpp.md). |
| `xmppAllowUnverifiedTls` | `true`, `false` | `false` | No | `xmppAllowUnverifiedTls=true` | Explicitly accept an unverified XMPP server certificate. STARTTLS still encrypts the stream, but the server identity is not checked and the bypass applies to any host, not only localhost. Only applies when `protocol=xmpp` and `mode=client`. See [XMPP transport](xmpp.md) and [TLS and SSL security](tls.md#explicit-certificate-verification-bypass). |
| `xmppConnectTimeoutMs` | `integer >= 1` | `30000` | No | `xmppConnectTimeoutMs=30000` | Milliseconds to wait for the XMPP stream to negotiate, authenticate and bind before the attempt fails. Must be a positive integer; there is no wait-forever value. Only applies when `protocol=xmpp`. |
| `xmppConversation` | `direct`, `muc` | `direct` | No | `xmppConversation=muc` | Publish each line as one-to-one `direct` chat messages, or as `muc` groupchat messages in a Multi-User Chat room. Only applies when `protocol=xmpp`. See [XMPP transport](xmpp.md). |
| `xmppDestination` | comma-separated bare JIDs, `omitted` | `(none)` | Only when `protocol=xmpp`, `mode=client` and `xmppConversation=direct` | `xmppDestination=feed@example.com` | Bare destination JIDs (`user@domain`, no resource) that receive each replayed line. At most 20 comma-separated entries. In server mode this optionally restricts delivery to specific signed-in accounts instead of every stream. |
| `xmppDomain` | `string` | `localhost` | No | `xmppDomain=example.com` | XMPP domain served (server mode) or authenticated against (client mode). The network host stays the shared top-level `ip` option — there is no `xmppHost` key — so a client can connect to an IP address while authenticating against the real domain. |
| `xmppExternalPassword` | `string`, `empty`, `omitted` | `(none)` | Only when `protocol=xmpp` and `mode=server` | `xmppExternalPassword=change-me` | Password for the required external account the built-in XMPP server accepts. May be present but empty (`xmppExternalPassword=`) for relaxed local testing. Never written to a log or a done file. |
| `xmppExternalUsername` | `string`, `omitted` | `(none)` | Only when `protocol=xmpp` and `mode=server` | `xmppExternalUsername=receiver` | Username of the required external account the built-in XMPP server accepts, alongside the automatic simulator application identity. It must not canonically collide with the reserved `velocity-simulator` identity: the comparison uses the trimmed, lowercased local part, so case and domain variations collide too. |
| `xmppNickname` | `string` | `velocity-simulator` | No | `xmppNickname=simulator` | Room nickname used when entering a Multi-User Chat room. Must not contain `/` or `@`. Only applies when `xmppConversation=muc`. |
| `xmppPassword` | `string`, `empty`, `omitted` | `(none)` | Only when `protocol=xmpp` and `mode=client` | `xmppPassword=change-me` | Password for the XMPP account used in client mode. May be present but empty (`xmppPassword=`) for relaxed local testing. Whitespace is significant and is never trimmed, on the command line, in a launch-config file, or in the UI. Held in memory only and never written to a log or a done file. |
| `xmppPingIntervalMs` | `integer >= 1` | `60000` | No | `xmppPingIntervalMs=60000` | Interval between XEP-0199 keepalive pings on an idle client stream. Must be a positive integer; the keepalive cannot be switched off. Only applies when `protocol=xmpp` and `mode=client`. |
| `xmppReconnectDelayMs` | `integer >= 1` | `60000` | No | `xmppReconnectDelayMs=60000` | Milliseconds to wait after a dropped client stream before the automatic reconnect is attempted. Must be a positive integer; automatic reconnect cannot be switched off. A reconnect re-binds the resource and re-joins the room; stream resumption is not implemented, so nothing sent while the stream was down is replayed. Only applies when `protocol=xmpp` and `mode=client`. |
| `xmppReplyTimeoutMs` | `integer >= 1` | `15000` | No | `xmppReplyTimeoutMs=15000` | Milliseconds to wait for a reply to a request that expects one, such as a room entry confirmation or a ping result. Must be a positive integer; there is no wait-forever value. |
| `xmppResource` | `string` | `velocity-simulator` | No | `xmppResource=velocity-simulator` | Resource part requested at bind time, which distinguishes this stream from other sessions of the same account. Only applies when `protocol=xmpp` and `mode=client`. |
| `xmppRoom` | room name, `room@conference.domain`, `omitted` | `(none)` | Only when `xmppConversation=muc` | `xmppRoom=traffic` | Multi-User Chat room to publish into. A bare name is qualified with the conversation sub-domain of `xmppDomain`. |
| `xmppRoomPassword` | `string`, `omitted` | `(none)` | No | `xmppRoomPassword=change-me` | Password required to enter the room. In server mode this also protects the room against every other occupant. Held in memory only and never written to a log or a done file. |
| `xmppTlsCaPath` | `path`, `omitted` | `(none)` | No | `xmppTlsCaPath=./certs/ca.pem` | Custom CA certificate file (PEM) used to verify the XMPP server certificate. Leave empty to use the OS certificate store. Only applies when `protocol=xmpp` and `mode=client`. |
| `xmppTlsCertPath` | `path`, `omitted` | `(none)` | No | `xmppTlsCertPath=./certs/server.pem` | Server certificate file (PEM) presented during STARTTLS. When omitted the app generates an automatic self-signed certificate. Only applies when `protocol=xmpp` and `mode=server`. |
| `xmppTlsKeyPath` | `path`, `omitted` | `(none)` | No | `xmppTlsKeyPath=./certs/server-key.pem` | Private key file (PEM) matching the XMPP server certificate. Required whenever `xmppTlsCertPath` is set. Only applies when `protocol=xmpp` and `mode=server`. |
| `xmppTlsPolicy` | `required`, `preferred`, `disabled` | `required` | No | `xmppTlsPolicy=required` | STARTTLS policy. `required` refuses to authenticate over a plaintext stream, `preferred` upgrades when the peer offers it, and `disabled` does not require encryption (the server stops advertising STARTTLS; a client still accepts an upgrade a third-party server insists on). |
| `xmppUsername` | `username`, `user@domain`, `omitted` | `(none)` | Only when `protocol=xmpp` and `mode=client` | `xmppUsername=simulator@example.com` | Account used to sign in. A bare `user@domain` value overrides `xmppDomain` so a copied JID can be pasted directly. |

XMPP client mode requires `xmppUsername` and XMPP server mode requires
`xmppExternalUsername`. The matching password parameter must be present, but it
may be empty: `xmppPassword=` and `xmppExternalPassword=` are accepted for both
PLAIN and SCRAM-SHA-1 and keep a local Simulator/Logger pairing free of a
shared secret. Password whitespace is preserved exactly.

## Connection presets and the command line

The UI **Preset** dropdown pre-fills the same connection fields these parameters
set. A preset only fills editable fields: it never connects, starts playback,
selects a file, saves a secret, or changes startup defaults, and the equivalent
command line is always spelled out. See
[Connection presets](connection-presets.md) for the twelve paired Simulator and
Logger entries.

Passing connection parameters in UI mode prepopulates the same controls without
selecting a preset; the dropdown stays on **Custom**.

## IP address behavior

The default `ip` value is **`127.0.0.1`**.

- **`127.0.0.1`** = loopback / localhost only
  - use this for local testing on the same machine
  - this is the safest default
  - in **client** mode, it means “send to a service on this machine”
  - in **server** mode, it means “listen only on this machine”

- **`0.0.0.0`** = all local network interfaces
  - typically used in **server** mode
  - allows other machines on the network to connect to the simulator
  - use this only when you want the simulator to listen beyond localhost

Quick rule of thumb:

- Use `127.0.0.1` for local-only testing
- Use `0.0.0.0` for server-mode listening when remote clients should be allowed

## Aliases and shortcuts

- `runMode=silent` is treated the same as `runMode=headless`
- `rateMs` is accepted as an alias for `intervalMs`
- `h=true`, `--help`, `-h`, and `help=true` print the compact ASCII-table help without the example column and exit without running the app
- `--help-detailed` and `help-detailed=true` print the full detailed parameter-by-parameter help
- `--help-table-wide` and `help-table-wide=true` print the wide table help layout
- `--help-table-narrow` and `help-table-narrow=true` print the narrow table help layout
- `--help-wide` and `help-wide=true` print the compact ASCII-table help with the example column
- Unknown `name=value` parameters, unknown bare flags, and bare positional arguments all abort startup with an error and exit the app. Close misspellings include `Did you mean ...?` suggestions. Unknown-parameter errors show a help command instead of printing the full help table automatically.
- Headless-only parameters supplied in UI mode (e.g. `port`, `protocol`, `logLevel`) are **not** errors; a `CLI warning:` line is logged per parameter explaining why it is ignored, and the app continues to launch normally
- In headless mode, `connectRetryIntervalMs` is warned and ignored when `connectWaitForServer=false`; `waitForClient` is warned and ignored in client mode; `connectWaitForServer` is warned and ignored in server mode
- If multiple help layouts are requested together, `help-table-narrow` wins, then `help-table-wide`, then `help-detailed`, then `help-wide`, then `help`

## Help layout parameters

The simulator supports five terminal help layouts:

| Layout | Supported Forms | Typical Use |
| --- | --- | --- |
| Help (`help`) | `npm run help:cli`, `--help`, `-h`, `h=true`, `help=true` | Compact wrapped columns for name, values, default, and purpose. Best quick-scan default. |
| Detailed (`help-detailed`) | `--help-detailed`, `help-detailed=true` | Full parameter-by-parameter text block with all details. |
| Narrow table | `npm run help:cli:narrow`, `--help-table-narrow`, `help-table-narrow=true` | ASCII table in a narrower column set — best for smaller terminals. |
| Wide table | `npm run help:cli:wide`, `--help-table-wide`, `help-table-wide=true` | ASCII table covering all fields — best for large terminals. |
| Wide (`help-wide`) | `--help-wide`, `help-wide=true` | Compact wrapped columns for name, values, default, example, and purpose. |

### Help layout precedence

If more than one help layout is requested in the same launch:

1. `help-table-narrow` wins
2. `help-table-wide` is next
3. `help-detailed` is next
4. `help-wide` is next
5. `help` is used only when no higher-priority layout is requested

This allows mixed commands such as `npm start -- help=true
help-table-narrow=true` to still produce a predictable result.

## Typo suggestions

Unknown CLI parameter names and unknown help flags use **Levenshtein edit
distance** to choose `Did you mean ...?` suggestions when the misspelling is
close enough to a supported option.

Levenshtein distance is a formal edit-distance algorithm: it counts the minimum
number of single-character **insertions**, **deletions**, and **substitutions**
needed to transform one string into another. That is different from a
character-overlap heuristic, which only counts whether the misspelled input's
characters appear somewhere in a candidate option. Character overlap is fast,
but it ignores character order and can over-score unrelated options that happen
to share letters. Edit distance is the better CLI choice because typical
mistakes are missing letters, extra letters, swapped-adjacent letters counted as
two edits, or one wrong character.

| Approach | What it does | Pros | Cons | Used here? |
| --- | --- | --- | --- | --- |
| Exact allowlist validation | Checks whether the provided parameter exactly matches a supported parameter or alias. | Safe, deterministic, prevents unsupported options from being accepted. | No typo recovery by itself. | **Yes** — always used first to decide whether input is valid. |
| Character-overlap scoring | Counts shared characters between the typo and each candidate. | Very simple and shell-friendly. | Ignores order and edit operations; unrelated options with shared letters can score too high. | **No** — not used for app CLI suggestions. |
| Levenshtein edit distance | Counts insertions, deletions, and substitutions. | Predictable for CLI typos such as missing letters, extra letters, missing hyphens, and substitutions; dependency-free implementation. | Adjacent transpositions count as two edits. | **Yes** — used for `Did you mean ...?` suggestions in the app CLI. |
| Damerau-Levenshtein | Like Levenshtein, but adjacent transpositions count as one edit. | Slightly better for swapped adjacent letters. | More complex; current thresholds already handle common swapped-letter cases well enough. | No — considered but not needed. |
| Prefix/substring matching | Suggests candidates that start with or contain the typo. | Useful for autocomplete. | Poor fit for misspellings in the middle of a flag or parameter. | No |

The validation flow is: **exact allowlist check first**, then if the name is
unknown, **Levenshtein suggestion only when the edit distance is below a
conservative threshold**. Distant unknown parameters do not get a suggestion,
avoiding misleading output. Unknown-parameter startup errors stay concise: they
show the bad parameter, any `Did you mean ...?` suggestion, and a help command
such as `electron . help=true`; the full help table is only shown when you
explicitly request help.

Examples:

```text
Unknown CLI parameter: protocl. Did you mean 'protocol'? These parameters are not supported.
Unknown CLI parameter: filname. Did you mean 'filename'? These parameters are not supported.
Unknown CLI parameter: --help-detaled. Did you mean '--help-detailed'? These parameters are not supported.
```

## Usage examples

### Normal UI startup (default)

```bash
npm start
```

### UI startup with a file preloaded

```bash
npm start -- filename=./example-data.csv
```

### Minimal headless run

```bash
npm run start:headless -- filename=./data.csv
```

### Headless TCP client replay

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 linesPerInterval=1 intervalMs=500
```

### Headless TCP GeoJSON with a CSV header

The first logical record defines the field names and is not sent. Both
coordinate mappings are required together, and GeoJSON requires WKID 4326:

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 tcpFormat=geo-json tcpInputHasHeader=true tcpXField=longitude tcpYField=latitude tcpWkid=4326
```

### Headless UDP Esri JSON with point geometry

Each converted record is sent as one complete datagram. Esri JSON includes the
configured WKID:

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=127.0.0.1 port=5565 udpFormat=esri-json udpInputHasHeader=true udpXField=x udpYField=y udpWkid=3857
```

### Headless TCP client that waits for the server and reconnects after restarts

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 connectWaitForServer=true connectRetryIntervalMs=1000 connectTimeoutMs=0 loop=true
```

> Set `connectTimeoutMs=0` to wait indefinitely. Set `loop=true` to keep replaying after the connection is re-established.

### Headless TCP server (starts sending immediately)

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 linesPerInterval=1 intervalMs=500
```

### Headless TCP server that waits for a client

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 waitForClient=true connectTimeoutMs=30000
```

### Headless gRPC client (Protobuf serialization — default)

Sends features to an ArcGIS Velocity or ArcGIS GeoEvent Server receiver using
the configured gRPC service:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=protobuf
```

### Headless gRPC server (Protobuf serialization — pushes to a product client)

Hosts a gRPC server that pushes data via the `Watch` RPC to a compatible ArcGIS
Velocity or ArcGIS GeoEvent Server client:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 grpcSerialization=protobuf waitForClient=true
```

### Headless gRPC client (Text serialization)

Uses the internal GrpcFeatureService protocol with plain UTF-8 text payloads —
useful for simple human-readable testing:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=text
```

### Headless XMPP client (Direct conversation)

Signs in to an existing XMPP server and publishes each line to one or more
destination JIDs:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp ip=xmpp.example.com port=5222 xmppDomain=example.com xmppUsername=simulator xmppPassword=change-me xmppDestination=feed@example.com
```

### Headless XMPP server (Room conversation, waits for an occupant)

Hosts a loopback XMPP endpoint with one external account and a
password-protected room, and holds the replay until a receiver enters the room:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp mode=server port=5222 xmppConversation=muc xmppRoom=traffic xmppRoomPassword=change-me xmppExternalUsername=receiver xmppExternalPassword=change-me waitForClient=true
```

### Headless batch using a config file

```bash
npm run start:headless -- config=./docs/examples/launch-config.server.sample.json
```

### Headless batch using a config file plus overrides

```bash
npm run start:headless -- config=./docs/examples/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override
```

### Print CLI help (no example column)

```bash
npm start -- help=true
```

```bash
npm start -- --help
```

### Print detailed CLI help (full parameter details)

```bash
npm start -- help-detailed=true
```

```bash
npm start -- --help-detailed
```

### Print help-wide (with example column)

```bash
npm start -- help-wide=true
```

```bash
npm start -- --help-wide
```

### Print CLI help in a wide table layout

```bash
npm run help:cli:wide
```

```bash
npm start -- help-table-wide=true
```

```bash
npm start -- --help-table-wide
```

### Print CLI help in a narrower table layout

```bash
npm run help:cli:narrow
```

```bash
npm start -- help-table-narrow=true
```

```bash
npm start -- --help-table-narrow
```

### Invalid parameter example

```bash
npm start -- mysteryOption=true
```

Expected behavior:

- the app logs a clear CLI startup error to the console
- the error explains that the parameter is unsupported
- the error suggests `electron . help=true` to review valid parameters
- the help text is printed
- the process exits gracefully without launching the app

### Invalid positional argument example

```bash
npm start -- hhh
```

Expected behavior:

- the app logs a clear CLI startup error to the console
- the error explains that bare positional arguments are not supported and suggests `name=value` syntax
- the help text is printed
- the process exits gracefully without launching the app

### UI mode with headless-only parameters (warnings, not errors)

```bash
npm start -- logLevel=debug exitOnComplete=false onError=continue
```

Expected behavior:

- the app **does** launch in normal UI mode
- a `CLI warning:` line is logged to the console for each inapplicable parameter, e.g.:
  - `CLI warning: CLI parameter 'logLevel' is ignored in UI mode: only used by the headless logger; in UI mode all events are shown in the status log.`
  - `CLI warning: CLI parameter 'exitOnComplete' is ignored in UI mode: ...`
  - `CLI warning: CLI parameter 'onError' is ignored in UI mode: ...`
- the parameters have no effect on the UI session

### UI mode with connection presets

```bash
npm start -- protocol=grpc mode=client ip=mcstest492.esri.com port=7145 useTls=true grpcHeaderPath=dedicated.abc123
```

Expected behavior:

- the app launches in normal UI mode with connection fields prepopulated from the CLI presets
- the startup explanation includes a "UI Configuration" section listing the preset values and a "Behavior Summary" section describing the transport

## Related documentation

| Document | Purpose |
|----------|---------|
| [Headless mode](headless.md) | No-UI replay sessions, parameters, and the completion artifact. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and the launch configuration samples. |
| [TLS and SSL security](tls.md) | Certificate types, trust stores, mutual TLS, and the TLS Trust Badge. |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every shortcut, including the in-app dialog shortcuts. |
