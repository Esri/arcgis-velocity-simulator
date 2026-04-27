# Command-Line Reference

The ArcGIS Velocity Simulator supports both normal UI startup and true headless execution.

## Default Behavior

When you launch the app with **no parameters**, it starts in the normal **UI mode** and preserves saved UI behavior from configuration, including the saved compact/full view.

```bash
npm start
```

To run without the UI, launch headless mode explicitly:

```bash
npm run start:headless -- filename=./data.csv
```

You can also use the regular launcher and pass `runMode=headless` (or `runMode=silent`):

```bash
npm start -- runMode=headless filename=./data.csv
```

## In-App Command Line Interface Dialog Reference

Press `F3` while the app is open to view the dedicated **Command Line Interface** dialog. You can also open it from **Help → Command Line Interface** or from the main window context menu. The dialog is generated from the same metadata used by terminal help output and this markdown guide, so the in-app table and the CLI docs stay aligned.

The Command Line Interface dialog supports:

- **Search filtering** across parameter names, defaults, supported values, examples, and descriptive purpose text
- **Quick filter chips** for All, Required, Optional, Headless-only, and Help-related parameters
- **Sortable columns** for all visible parameter fields
- **Copy example commands** directly from the examples list
- **Copy/export visible rows** in `TSV`, `CSV`, `Markdown`, or `JSON`
- **Keyboard shortcuts**: `Ctrl+F` / `Cmd+F` or `/` to focus the filter, and `Escape` to close the dialog

If you prefer a terminal-first workflow, the `help`, `help-detailed`, `help-table-narrow`, `help-table-wide`, and `help-wide` launch options below expose the same parameter catalog in text form.

Unknown CLI parameters are treated as startup errors. If you pass an unsupported `name=value` parameter, an unsupported bare flag like `--bogus`, or a bare positional argument without `name=value` syntax (e.g. `npm start -- hhh`), the app logs a clear console error, prints the help text, and exits gracefully without launching the UI or headless runner.

**Inapplicable parameters in the correct mode are warnings, not errors.** When a headless-only parameter (e.g. `port=6000`, `protocol=udp`, `logLevel=debug`) is passed in UI mode, the app logs a `CLI warning:` line per parameter explaining why it has no effect, then continues to launch normally. The same applies in headless mode for parameters that don't apply to the selected sub-configuration (e.g. `connectRetryIntervalMs` when `connectWaitForServer=false`).

## Required vs Optional Parameters

### Required in headless mode

- `filename` - always required once headless mode is selected

### Required only to switch from normal launch into headless mode

- `runMode=headless` or `runMode=silent` - required when using the normal app launcher instead of `npm run start:headless`

### Optional in headless mode

All other parameters are optional because they have defaults.

## Parameter Reference

The table below mirrors the in-app Command Line Interface dialog columns so terminal help, the dialog, and this guide use the same terminology.

| Name | Supported Values | Default | Required in Headless Mode | Example | Purpose |
| --- | --- | --- | --- | --- | --- |
| `autoConnect` | `true`, `false` | `true` | No | `autoConnect=false` | Connect automatically before streaming begins. |
| `autoStart` | `true`, `false` | `true` | No | `autoStart=false` | Start streaming immediately after initialization. |
| `config` | `path`, `omitted` | `(none)` | No | `config=./docs/launch-config.server.sample.json` | Optional JSON launch-config file. CLI values override config-file values. |
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
| `protocol` | `tcp`, `udp`, `grpc` | `tcp` | No | `protocol=udp` | Choose the network transport for headless replay. See [GRPC.md](GRPC.md) for gRPC details. |
| `grpcHeaderPath` | `string` | `replace.with.dedicated.uid` | No | `grpcHeaderPath=my.feed.uid` | Value sent as the gRPC endpoint header path. Injected as gRPC metadata on every outgoing call. Only applies when `protocol=grpc` and `mode=client`. See [GRPC.md](GRPC.md). |
| `grpcHeaderPathKey` | `string` | `grpc-path` | No | `grpcHeaderPathKey=grpc-path` | Key name for the gRPC endpoint header path metadata entry. Only applies when `protocol=grpc` and `mode=client`. See [GRPC.md](GRPC.md). |
| `runId` | `string`, `omitted` | `(none)` | No | `runId=nightly-01` | Optional identifier added to logs and done-file output. |
| `runMode` | `ui`, `headless`, `silent` | `ui` | Only when using the normal launcher to enter headless mode | `runMode=headless` | Select startup mode. No parameters means normal UI mode and restores saved UI behavior from configuration, including compact/full view. |
| `grpcSerialization` | `protobuf`, `kryo`, `text` | `protobuf` | No | `grpcSerialization=text` | gRPC feature serialization format. `protobuf` uses the Velocity external GrpcFeed protocol with typed Any-wrapped attributes. `kryo` uses the internal GrpcFeatureService protocol with raw bytes. `text` uses the internal protocol with plain UTF-8 text. Only applies when `protocol=grpc`. See [GRPC.md](GRPC.md). |
| `grpcSendMethod` | `stream`, `unary` | `stream` | No | `grpcSendMethod=unary` | gRPC RPC type for client-mode sending. `stream` (default) uses a Client Streaming RPC — multiplexes all messages over a single persistent HTTP/2 stream for higher throughput. `unary` uses a Unary RPC — sends each message as a discrete request/response round-trip, easier to trace and debug. Only applies when `protocol=grpc` and `mode=client`. See [GRPC.md](GRPC.md#send-methods-rpc-types). |
| `startLine` | `integer >= 1` | `1` | No | `startLine=100` | 1-based inclusive start line for the replay window. |
| `stdout` | `true`, `false` | `true` | No | `stdout=false` | Enable or disable console log output during headless runs. |
| `waitForClient` | `true`, `false` | `false` | No | `waitForClient=true` | In server mode, wait for at least one recipient before advancing through the file. When false (the default), data is sent immediately and lines are advanced even if no client is connected. Ignored in client mode. |

## IP Address Behavior

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

## Aliases and Shortcuts

- `runMode=silent` is treated the same as `runMode=headless`
- `rateMs` is accepted as an alias for `intervalMs`
- `h=true`, `--help`, `-h`, and `help=true` print the compact ASCII-table help without the example column and exit without running the app
- `--help-detailed` and `help-detailed=true` print the full detailed parameter-by-parameter help
- `--help-table-wide` and `help-table-wide=true` print the wide table help layout
- `--help-table-narrow` and `help-table-narrow=true` print the narrow table help layout
- `--help-wide` and `help-wide=true` print the compact ASCII-table help with the example column
- Unknown `name=value` parameters, unknown bare flags, and bare positional arguments all abort startup with an error, print the help text, and exit the app
- Headless-only parameters supplied in UI mode (e.g. `port`, `protocol`, `logLevel`) are **not** errors; a `CLI warning:` line is logged per parameter explaining why it is ignored, and the app continues to launch normally
- In headless mode, `connectRetryIntervalMs` is warned and ignored when `connectWaitForServer=false`; `waitForClient` is warned and ignored in client mode; `connectWaitForServer` is warned and ignored in server mode
- If multiple help layouts are requested together, `help-table-narrow` wins, then `help-table-wide`, then `help-detailed`, then `help-wide`, then `help`

## Help Layout Parameters

The simulator supports five terminal help layouts:

| Layout | Supported Forms | Typical Use |
| --- | --- | --- |
| Help (`help`) | `npm run help:cli`, `--help`, `-h`, `h=true`, `help=true` | Compact wrapped columns for name, values, default, and purpose. Best quick-scan default. |
| Detailed (`help-detailed`) | `--help-detailed`, `help-detailed=true` | Full parameter-by-parameter text block with all details. |
| Narrow table | `npm run help:cli:narrow`, `--help-table-narrow`, `help-table-narrow=true` | ASCII table in a narrower column set — best for smaller terminals. |
| Wide table | `npm run help:cli:wide`, `--help-table-wide`, `help-table-wide=true` | ASCII table covering all fields — best for large terminals. |
| Wide (`help-wide`) | `--help-wide`, `help-wide=true` | Compact wrapped columns for name, values, default, example, and purpose. |

### Help Layout Precedence

If more than one help layout is requested in the same launch:

1. `help-table-narrow` wins
2. `help-table-wide` is next
3. `help-detailed` is next
4. `help-wide` is next
5. `help` is used only when no higher-priority layout is requested

This allows mixed commands such as `npm start -- help=true help-table-narrow=true` to still produce a predictable result.

## Usage Examples

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

Sends features to a gRPC server using the Velocity external GrpcFeed protocol. The ArcGIS Velocity Logger (in gRPC server mode) or the Velocity platform can receive the data:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=protobuf
```

### Headless gRPC server (Protobuf serialization — pushes to Logger client)

Hosts a gRPC server that pushes data to observer clients via the `Watch` RPC. The ArcGIS Velocity Logger in gRPC Client mode subscribes and receives features in real time:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=server ip=0.0.0.0 port=50051 grpcSerialization=protobuf waitForClient=true
```

### Headless gRPC client (Text serialization)

Uses the internal GrpcFeatureService protocol with plain UTF-8 text payloads — useful for simple human-readable testing:

```bash
npm run start:headless -- filename=./data.csv protocol=grpc mode=client ip=127.0.0.1 port=50051 grpcSerialization=text
```

### Headless batch using a config file

```bash
npm run start:headless -- config=./docs/launch-config.server.sample.json
```

### Headless batch using a config file plus overrides

```bash
npm run start:headless -- config=./docs/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override
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

## Related Files

- [`HEADLESS.md`](./HEADLESS.md) - Headless mode guide and config-template launch examples
- [`CONFIG.md`](./CONFIG.md) - Configuration guide including headless launch-config support
- [`launch-config.sample.json`](./launch-config.sample.json) - Generic headless config template
- [`launch-config.server.sample.json`](./launch-config.server.sample.json) - Server-mode sample template
- [`launch-config.client.sample.json`](./launch-config.client.sample.json) - Client-mode sample template

