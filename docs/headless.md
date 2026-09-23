# Headless mode

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The ArcGIS Velocity Simulator can run without creating application windows by
launching with `runMode=headless` (or `runMode=silent`). A headless session
loads a file, establishes the network transport, streams records, and exits when
the run completes, which makes it suitable for schedulers, continuous
integration jobs, and unattended soak tests.

This guide is written for users and developers automating replay sessions. It
covers the quick-start command, the headless parameter set, worked examples for
each transport, the launch-configuration file workflow, and the completion
artifact written by `doneFile`. When no command-line parameters are provided,
the app starts in the normal UI mode instead and preserves the saved compact or
full view.

## Table of contents

- [Quick start](#quick-start)
- [Help output](#help-output)
- [Supported parameters](#supported-parameters)
- [Examples](#examples)
- [Config file support](#config-file-support)
- [Done file output](#done-file-output)
- [Notes](#notes)
- [Related documentation](#related-documentation)

## Quick start

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 linesPerInterval=1 intervalMs=1000 autoConnect=true autoStart=true loop=false exitOnComplete=true stdout=true
```

## Help output

```bash
npm run help:cli
```

That command prints the compact ASCII-table help without the example column.

Other layouts:

```bash
npm start -- --help-detailed      # full detailed parameter-by-parameter text
npm run help:cli:wide             # wide ASCII table
npm run help:cli:narrow           # narrow ASCII table
npm start -- --help-wide          # compact ASCII-table help with example column
```

Bare-flag and `=true` forms are equivalent, e.g. `help-detailed=true` or
`--help-detailed`.

Unknown CLI parameters are treated as startup errors. When an unsupported
parameter or bare positional argument is provided, the app logs a clear console
error, prints the help text, and exits gracefully without starting the run.

Inapplicable parameters for the current mode are **warnings, not errors**: they
are logged with an explanation and the run continues normally.

If multiple help layouts are requested together, `help-table-narrow` wins, then
`help-table-wide`, then `help-detailed`, then `help-wide`, then `help`.

While the UI is open, you can also press `F3` to open the dedicated Command Line
Interface dialog and browse the same command-line catalog interactively. The
dialog adds quick category chips, sortable columns, search, and visible-row
copy/export actions.

## Supported parameters

For the complete command-line reference, including required/optional rules, the
Command Line Interface dialog workflow, and default values for every parameter,
see [Command-line reference](command-line.md).

### Parameters at a glance

This condensed table uses the same column structure as [Command-line
reference](command-line.md) so the headless guide and the full command-line
reference stay aligned.

| Name | Supported Values | Default | Required in Headless Mode | Example | Purpose |
| --- | --- | --- | --- | --- | --- |
| `autoConnect` | `true`, `false` | `true` | No | `autoConnect=false` | Connect automatically before streaming begins. |
| `autoStart` | `true`, `false` | `true` | No | `autoStart=false` | Start streaming immediately after initialization. |
| `config` | `path`, `omitted` | `(none)` | No | `config=./docs/examples/launch-config.server.sample.json` | Optional JSON launch-config file. CLI values override config-file values. |
| `connectRetryIntervalMs` | `integer >= 1` | `1000` | No | `connectRetryIntervalMs=3000` | Milliseconds between connection retry attempts when `connectWaitForServer=true`. Has no effect when `connectWaitForServer=false`. |
| `connectTimeoutMs` | `integer >= 0` | `0` | No | `connectTimeoutMs=5000` | Timeout for connect/bind operations and recipient waiting. |
| `connectWaitForServer` | `true`, `false` | `false` | No | `connectWaitForServer=true` | In client mode, retry the connection when the server is unavailable instead of failing immediately. Also reconnects automatically if the server is restarted mid-run. Use `connectTimeoutMs` for a deadline and `connectRetryIntervalMs` to tune the retry interval. Ignored in server mode. |
| `doneFile` | `path`, `omitted` | `(none)` | No | `doneFile=./logs/run.done.json` | Optional JSON success/failure artifact for schedulers and CI. |
| `endLine` | `integer >= startLine`, `null/omitted` | `(none)` | No | `endLine=500` | 1-based inclusive end line for the replay window. Defaults to the end of the file. |
| `exitOnComplete` | `true`, `false` | `true` | No | `exitOnComplete=false` | Exit after a completed headless run when applicable. |
| `explain` | `true`, `false` | `true` | No | `explain=false` | Print a detailed startup explanation showing the resolved run mode, active parameters, defaults, and warnings. In both UI and headless modes, this includes a configuration section and a "Behavior Summary" section. Enabled by default; set to false to suppress. |
| `filename` | `absolute-or-relative-path` | `(none)` | Yes | `filename=./data.csv` | Input CSV/TXT file to replay. |
| `help` | `true`, `false` | `false` | No | `help=true` | Print a compact ASCII-table parameter summary (name, values, default, purpose) without the example column and exit. Also available as `h=true`, `--help`, and `-h`. |
| `help-detailed` | `true`, `false` | `false` | No | `help-detailed=true` | Print full detailed CLI help with all parameter details and exit without running the app. |
| `help-table-narrow` | `true`, `false` | `false` | No | `help-table-narrow=true` | Print CLI help in a narrower ASCII-table layout for smaller terminals, then exit. |
| `help-table-wide` | `true`, `false` | `false` | No | `help-table-wide=true` | Print CLI help in a wide ASCII-table layout for larger terminals, then exit. |
| `help-wide` | `true`, `false` | `false` | No | `help-wide=true` | Print a compact ASCII-table parameter summary (name, values, default, example, purpose) and exit without running the app. |
| `ip` | IP address or hostname | `127.0.0.1` | No | `ip=192.168.1.25` | Bind address for server mode or destination address for client mode. See [TCP transport](tcp.md) and [UDP transport](udp.md) for IPv6 family selection. |
| `linesPerInterval` | `integer >= 1` | `1` | No | `linesPerInterval=5` | Number of lines processed during each scheduler tick. |
| `logFile` | `path`, `omitted` | `(none)` | No | `logFile=./logs/run.log` | Optional file path for persisted headless logs. |
| `logLevel` | `error`, `warn`, `info`, `debug` | `info` | No | `logLevel=debug` | Minimum log level written to stdout/logFile in headless mode. |
| `loop` | `true`, `false` | `false` | No | `loop=true` | Restart from `startLine` after reaching `endLine`. |
| `maxLines` | `integer >= 1`, `null/omitted` | `(none)` | No | `maxLines=1000` | Optional cap on successfully processed lines. |
| `mode` | `server`, `client` | `server` | No | `mode=client` | Choose whether the simulator binds locally or connects outward. |
| `onError` | `exit`, `continue`, `pause` | `exit` | No | `onError=continue` | Choose how send failures are handled: exit, continue, or pause. |
| `port` | `1-65535` | `5565` | No | `port=6000` | Target or bind port. |
| `protocol` | `tcp`, `udp`, `grpc`, `http`, `ws`, `xmpp` | `tcp` | No | `protocol=xmpp` | Choose the network transport for headless replay. XMPP overrides the role/port defaults to client/5222 only after it is selected. |
| `grpcHeaderPath` | `string` | `replace.with.dedicated.uid` | No | `grpcHeaderPath=my.feed.uid` | Value sent as the gRPC endpoint header path. Injected as gRPC metadata on every outgoing call. Only applies when `protocol=grpc` and `mode=client`. |
| `grpcHeaderPathKey` | `string` | `grpc-path` | No | `grpcHeaderPathKey=grpc-path` | Key name for the gRPC endpoint header path metadata entry. Only applies when `protocol=grpc` and `mode=client`. |
| `runId` | `string`, `omitted` | `(none)` | No | `runId=nightly-01` | Optional identifier added to logs and done-file output. |
| `runMode` | `ui`, `headless`, `silent` | `ui` | Only when using the normal launcher to enter headless mode | `runMode=headless` | Select startup mode. No parameters means normal UI mode and restores saved UI behavior from configuration, including compact/full view. |
| `grpcSerialization` | `protobuf`, `kryo`, `text` | `protobuf` | No | `grpcSerialization=text` | gRPC feature serialization format. Only applies when `protocol=grpc`. |
| `startLine` | `integer >= 1` | `1` | No | `startLine=100` | 1-based inclusive start line for the replay window. |
| `stdout` | `true`, `false` | `true` | No | `stdout=false` | Enable or disable console log output during headless runs. |
| `tcpFormat` | `delimited`, `json`, `geo-json`, `esri-json` | `delimited` | No | `tcpFormat=json` | TCP payload format for each logical CSV record. |
| `udpFormat` | `delimited`, `json`, `geo-json`, `esri-json` | `delimited` | No | `udpFormat=geo-json` | UDP payload format; each record must fit in one datagram. |
| `waitForClient` | `true`, `false` | `false` | No | `waitForClient=true` | In server mode, wait for at least one recipient before advancing through the file. Ignored in client mode. |

Transports use the following protocol-specific settings. All are optional:

| Transport | Parameters | Defaults / behavior |
|---|---|---|
| TCP | `tcpFormat`, `tcpInputHasHeader`, `tcpXField`, `tcpYField`, `tcpWkid` | Delimited, no header row, no geometry mapping, WKID 4326. TCP publishes newline-separated logical payloads. |
| UDP | `udpFormat`, `udpInputHasHeader`, `udpXField`, `udpYField`, `udpWkid` | Delimited, no header row, no geometry mapping, WKID 4326. UDP publishes one complete payload per datagram, with a 65,507-byte UTF-8 maximum. |
| HTTP | `httpFormat`, `httpPolling`, `httpPath`, `httpTls`, `httpTlsCaPath`, `httpTlsCertPath`, `httpTlsKeyPath`, `httpAllowUnverifiedTls` | `delimited`, polling off, `/`, TLS on, system CA/no client identity, verification on. Formats are `delimited`, `json`, `esri-json`, `geo-json`, and `xml`. Client mode sends POST requests; server mode broadcasts to SSE watchers or serves the latest payload to GET-based pollers. |
| WebSocket | `wsFormat`, `wsPath`, `wsTls`, `wsTlsCaPath`, `wsTlsCertPath`, `wsTlsKeyPath`, `wsAllowUnverifiedTls`, `wsSubscriptionMsg`, `wsIgnoreFirstMsg`, `wsHeaders` | `delimited`, `/`, TLS on, system CA/no client identity, verification on, no subscription, do not ignore the first message, and no custom headers. Client mode sends text frames; server mode broadcasts to connected sockets. |

XMPP adds the following grouped settings; the full descriptions and cross-field
requirements are in [Command-line reference](command-line.md):

| Area | Parameters | Defaults / rules |
|---|---|---|
| Address | `xmppDomain`, `xmppResource` | `localhost`, `velocity-simulator`; the network host is the shared `ip` key (there is no `xmppHost`) and is independent of `xmppDomain`. |
| TLS | `xmppTlsPolicy`, `xmppTlsCaPath`, `xmppTlsCertPath`, `xmppTlsKeyPath`, `xmppAllowUnverifiedTls` | Required; client OS/custom CA; server cert/key pair or automatic self-signed; the bypass is an explicit opt-in that applies to any host. |
| Client auth | `xmppUsername`, `xmppPassword` | Both required in client role; password whitespace is significant and is never trimmed. |
| Server auth | `xmppExternalUsername`, `xmppExternalPassword`, `xmppAllowRemote` | Account values are paired; the account may not canonically collide with the reserved `velocity-simulator` identity; remote bind is opt-in. |
| Conversation | `xmppConversation`, `xmppDestination`, `xmppRoom`, `xmppNickname`, `xmppRoomPassword` | Direct; destinations are bare JIDs; room is required for MUC. |
| Timing | `xmppConnectTimeoutMs`, `xmppReplyTimeoutMs`, `xmppPingIntervalMs`, `xmppReconnectDelayMs` | 30000 / 15000 / 60000 / 60000 ms; every one is a positive integer, so zero is rejected rather than treated as "disabled" or "wait forever" |

### Headless required vs optional

- **Required in headless mode**: `filename`
- **Required only when switching into headless via the normal launcher**: `runMode=headless` or `runMode=silent`
- **Optional in headless mode**: all other parameters (defaults are applied automatically)

### IP default and address behavior

The default `ip` value is **`127.0.0.1`**.

- Use **`127.0.0.1`** for loopback/local-only testing on the same machine.
- Use **`0.0.0.0`** in **server mode** when you want the simulator to listen on all interfaces so other machines can connect.

That is why the default remains `127.0.0.1`, while some server-mode examples use
`ip=0.0.0.0`.

## Examples

### TCP client replay

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 linesPerInterval=1 intervalMs=500 loop=false exitOnComplete=true stdout=true
```

Add `tcpFormat=json`, `tcpFormat=geo-json`, or `tcpFormat=esri-json` to convert
logical CSV records. For a header-based spatial schema, also set
`tcpInputHasHeader=true`, `tcpXField=<name>`, `tcpYField=<name>`, and
`tcpWkid=4326`. The header record defines the schema and is not sent.
When `tcpInputHasHeader` is omitted or false, the first record remains an event
and structured formats use deterministic generated field names.

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 tcpFormat=geo-json tcpInputHasHeader=true tcpXField=longitude tcpYField=latitude tcpWkid=4326
```

### TCP client that waits for the server and reconnects after restarts

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 connectWaitForServer=true connectRetryIntervalMs=1000 connectTimeoutMs=0 loop=true stdout=true
```

> `connectTimeoutMs=0` means wait indefinitely for the server to come up (or come back). `loop=true` keeps the file replaying continuously so the simulator stays running across server restarts.

### TCP server that starts sending immediately (default)

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 linesPerInterval=1 intervalMs=1000
```

### TCP server that waits for the first consumer

```bash
npm run start:headless -- filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 waitForClient=true connectTimeoutMs=30000 linesPerInterval=1 intervalMs=1000
```

### Batch a subset of the file and write completion output

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=127.0.0.1 port=5565 startLine=100 endLine=200 maxLines=50 doneFile=./run.done.json logFile=./run.log runId=batch-100-200
```

Set `udpFormat` to choose the payload conversion. Each logical record becomes
one complete datagram; oversize records are rejected before send.

```bash
npm run start:headless -- filename=./data.csv protocol=udp mode=client ip=127.0.0.1 port=5565 udpFormat=esri-json udpInputHasHeader=true udpXField=x udpYField=y udpWkid=3857
```

Omitting `udpInputHasHeader`, coordinate fields, and `udpWkid` preserves the
header as an event, generates deterministic names for a structured payload,
uses null geometry, and defaults WKID to 4326.

For a Velocity UDP feed, use client mode and `udpAppendNewline=true` with
Delimited payloads. For a generic paired Logger client, server mode can use
`waitForClient=true`. See [UDP transport](udp.md) for the custom registration
convention and Velocity framing requirements.

For a local IPv6 pair, set `ip=::1` and the protocol's family option,
`tcpAddressFamily=ipv6` or `udpAddressFamily=ipv6`. This does not change file
conversion, replay controls, or completion artifacts. Full option values and
defaults are in the [Command-line reference](command-line.md).

### gRPC client with default header path

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=protobuf
```

### gRPC client with custom header path key and value

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=protobuf grpcHeaderPathKey=grpc-path grpcHeaderPath=my.feed.dedicated.uid
```

### gRPC server (receives features, no header path needed)

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 grpcSerialization=protobuf
```

### HTTP client POST replay

```bash
npm run start:headless -- filename=./data.csv protocol=http mode=client ip=127.0.0.1 port=8080 httpTls=false httpPath=/receiver/feed-id httpFormat=geo-json
```

For HTTPS, leave `httpTls=true` and optionally provide `httpTlsCaPath`,
`httpTlsCertPath`, and `httpTlsKeyPath`. Use
`httpAllowUnverifiedTls=true` only as an explicit client-side testing bypass.

### HTTP server broadcasting to an SSE watcher

```bash
npm run start:headless -- filename=./data.csv protocol=http mode=server ip=0.0.0.0 port=8080 httpTls=false httpPath=/stream waitForClient=true
```

`waitForClient=true` waits for a `GET /stream` request whose
`Accept` header includes `text/event-stream`; inbound POST requests are observed
but are not persistent broadcast recipients.

### WebSocket client with subscription and headers

```bash
npm run start:headless -- filename=./data.csv protocol=ws mode=client ip=127.0.0.1 port=8080 wsTls=false wsPath=/feed wsFormat=json wsSubscriptionMsg=subscribe:feed1 wsIgnoreFirstMsg=true 'wsHeaders={"X-Client":"simulator"}'
```

### WebSocket server waiting for a consumer

```bash
npm run start:headless -- filename=./data.csv protocol=ws mode=server ip=0.0.0.0 port=8080 wsTls=false wsPath=/feed waitForClient=true
```

### XMPP client publishing to destination JIDs

`protocol=xmpp` defaults the role to `client` and the port to `5222`, so `mode`
and `port` only need to be given when you want something else:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp ip=xmpp.example.com xmppDomain=example.com xmppUsername=simulator xmppPassword=change-me xmppDestination=feed@example.com
```

### XMPP server publishing into a room, waiting for an occupant

The built-in server binds loopback unless `xmppAllowRemote=true`. With
`waitForClient=true` the replay holds until a receiver has actually entered the
room, so nothing is consumed while there is nobody to receive it:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp mode=server port=5222 xmppConversation=muc xmppRoom=traffic xmppRoomPassword=change-me xmppExternalUsername=receiver xmppExternalPassword=change-me waitForClient=true
```

Passwords supplied this way are held in memory only, with their whitespace
preserved exactly. They never appear in the status log, the log file, the done
file, or `explain=true` output, which prints `<redacted:NB>` markers instead.

A headless XMPP transport is registered with the transport manager before its
connect is awaited, so a connect that fails part-way — a refused STARTTLS
upgrade, a bad credential, a room that rejects the nickname — is still torn down
before the run reports its failure and writes the done file. See [XMPP
transport](xmpp.md) for the full transport reference.

## Config file support

Use `config=/path/to/file.json` to load parameters from JSON. CLI values
override config file values.

A ready-to-copy template is included in the [generic launch configuration
sample](examples/launch-config.sample.json).

Mode-specific and protocol-specific templates are also available:

- [server-mode launch configuration sample](examples/launch-config.server.sample.json)
- [client-mode launch configuration sample](examples/launch-config.client.sample.json)
- [XMPP launch configuration sample](examples/launch-config.xmpp.sample.json)

### Launch the sample templates

Use these commands as a starting point for scheduled jobs, cron tasks, or CI
workflows:

#### Generic template

```bash
npm run start:headless -- config=./docs/examples/launch-config.sample.json
```

#### Server-mode template

```bash
npm run start:headless -- config=./docs/examples/launch-config.server.sample.json
```

#### Client-mode template

```bash
npm run start:headless -- config=./docs/examples/launch-config.client.sample.json
```

#### XMPP template

```bash
npm run start:headless -- config=./docs/examples/launch-config.xmpp.sample.json
```

If you need to override a value without editing the file, append a CLI override
after `config=...`. For example:

```bash
npm run start:headless -- config=./docs/examples/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override
```

The config file may use either top-level keys or grouped sections:

```json
{
  "filename": "./data.csv",
  "runMode": "headless",
  "connection": {
    "ip": "0.0.0.0",
    "mode": "server",
    "port": 5565,
    "protocol": "tcp"
  },
  "output": {
    "doneFile": "./run.done.json",
    "logLevel": "info",
    "stdout": true
  },
  "streaming": {
    "endLine": 500,
    "intervalMs": 1000,
    "linesPerInterval": 1,
    "startLine": 1,
    "waitForClient": false
  }
}
```

## Done file output

When `doneFile=` is provided, the application writes a JSON file describing
either successful completion or failure.

Successful runs include the final summary, including `linesSent`, the active
line range, and the completion timestamp.

## Notes

- Headless mode does not create the splash screen or the main application window.
- In server mode, the simulation starts sending immediately by default without waiting for clients to connect. Data sent before any client connects is silently discarded.
- `waitForClient=true` prevents file advancement while no server-side recipients are available.
- For HTTP server mode, recipients are active SSE watchers. For WebSocket server mode, recipients are open WebSocket clients.
- `connectWaitForServer=true` (client mode only) retries the outbound connection at `connectRetryIntervalMs` intervals until the server accepts it. If the server is stopped and restarted during a run, the simulator detects the lost connection and reconnects automatically without failing the run.
- `connectTimeoutMs=0` means no deadline — the simulator will keep retrying indefinitely. Set a positive value (e.g. `connectTimeoutMs=60000`) to give up after a fixed period.
- `onError=continue` skips failed sends and continues with the next line.
- `onError=pause` stops the scheduler and leaves the process running until it is externally stopped.
- Unknown CLI parameters — including bare positional arguments without `name=value` syntax — abort startup immediately with a clear error, print the help text, and exit the app. Use `electron . help=true` to review the valid parameter set.
- Inapplicable parameters in the correct mode are **warnings, not errors**. Examples: `connectRetryIntervalMs` logs a warning and is ignored when `connectWaitForServer=false`; `waitForClient` logs a warning and is ignored in client mode; `connectWaitForServer` logs a warning and is ignored in server mode. The run continues normally.

## Related documentation

| Document | Purpose |
|----------|---------|
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and the launch configuration samples. |
| [Developer guide](developer-guide.md) | Repository structure, local development, tests, debugging, and extension points. |
| [TLS and SSL security](tls.md) | Certificate types, trust stores, mutual TLS, and the TLS Trust Badge. |
