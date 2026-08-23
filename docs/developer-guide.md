# Developer guide

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide is the working reference for changing the ArcGIS Velocity Simulator:
the repository layout, how to run the application locally, how to run targeted
and full test suites, how to check documentation links, how to attach a debugger
and read logs, how to extend the user interface and the transports, and the
checklist to run before opening a pull request.

It is written for developers. Node.js 18 or newer and a completed `npm install`
are assumed. Packaging and publishing are covered in
[Build and release](build-and-release.md).

## Table of contents

- [Repository structure](#repository-structure)
- [Local development](#local-development)
- [Testing](#testing)
- [Documentation checks](#documentation-checks)
- [Debugging](#debugging)
- [Logging](#logging)
- [Common failures](#common-failures)
- [Extending the application](#extending-the-application)
- [Validation checklist](#validation-checklist)
- [Related documentation](#related-documentation)

## Repository structure

| Path | Contents |
|------|----------|
| `src/` | Application source: main process, renderer, preload, dialogs, transports, and helper modules. |
| `src/themes/` | One CSS file per theme, loaded by `src/themes.css`. |
| `src/assets/` | Icons, screenshots, and packaging resources. |
| `src/proto/` | Protobuf definitions used by the gRPC transports. |
| `scripts/` | Build, prerequisite, signing, documentation, and release scripts. |
| `test/` | Node-only test suites and the `run-all-tests.js` runner. |
| `docs/` | Every maintained guide, plus `docs/examples/` launch configuration samples. |

Key modules:

| Module | Responsibility |
|--------|----------------|
| `src/main.js` | Application lifecycle, windows, menus, dialogs, file access, configuration, IPC handlers, headless bootstrap, and logging. |
| `src/renderer.js` | User interface state, controls, tooltips, themes, gesture and voice integration, and streaming controls. |
| `src/preload.js` | The context-isolated bridge; the renderer has no direct Node.js access and every channel is validated here. |
| `src/config.js` | Persisted application configuration: defaults, load, save, import, export, and merge. |
| `src/cli-options.js` | The single source of truth for command-line parameter metadata; feeds terminal help, the in-application reference dialog, and the documentation. |
| `src/simulation-engine.js` | Replay scheduling, line ranges, loops, `waitForClient`, error modes, and completion semantics, with no renderer dependency. |
| `src/transport-manager.js` | Owns TCP, UDP, HTTP, WebSocket, gRPC, and XMPP connections, tracks recipients in server mode, and raises status and connection events. |
| `src/grpc-transport.js`, `src/http-transport.js`, `src/ws-transport.js`, `src/xmpp-transport.js` | Per-protocol client and server transports behind a common `connect`/`send`/`disconnect`/`isConnected`/`hasRecipients` shape. |
| `src/xmpp-*.js` | XMPP protocol layers: constants, client core, server core, SASL, shared SCRAM-SHA-1 primitives, Multi-User Chat, accounts, and utilities. |
| `src/connection-presets.js` | The twelve paired Simulator and Logger connection presets shared with the sister repository; loaded by the renderer and by the tests. See [Protocol settings and presets](connection-presets.md). |
| `src/connection-summary.js` | The pure generator behind every read-only description of a connection: the warning-only alert, toolbar and status-bar Summary buttons, the read-only Summary section, and the configured-state count. No DOM access, so it runs unchanged in Node. See [Connection summary](connection-summary.md). |
| `src/tls-utils.js`, `src/format-utils.js`, `src/tooltip-utils.js` | Shared TLS, payload formatting, and custom tooltip helpers used by every transport or view that needs them. `tls-utils.js` owns the single client certificate-verification decision (`resolveClientTlsVerification()`). `tooltip-utils.js` owns title migration and the stationary pointer-intent behavior shared by every custom tooltip. |
| `src/velocity-*.js` | ArcGIS Velocity sign-in, token handling, and the feed picker. |
| `src/run-logger.js` | The `RunLogger` used for console and log-file output in both modes. |

Shared logic belongs in a shared module. When behavior is needed by more than
one transport or view, extract it — `src/tls-utils.js` and `src/format-utils.js`
are the reference examples.

## Local development

```bash
npm install
npm start                                        # user interface
npm run start:headless -- filename=./data.csv    # no-UI replay
npm run help:cli                                 # command-line help
```

Command-line parameters are passed after `--`, for example
`npm start -- port=6000 protocol=udp`. Every parameter, its default, and whether
it requires headless mode are listed in the
[command-line reference](command-line.md).

The renderer never gets Node.js access: add capabilities by exposing a validated
channel in `src/preload.js` and handling it in `src/main.js`. File paths chosen
by the user are resolved in the main process, and the renderer receives only the
parsed result.

## Testing

Tests run under plain Node.js — no Electron display environment is required — so
`npm install` followed by `npm test` validates a change.

```bash
npm test                     # every suite through test/run-all-tests.js
node test/config.test.js     # a single suite directly
```

| Command | Suite | Covers |
|---------|-------|--------|
| `npm run test:config` | `config.test.js` | Configuration file input and output, defaults, error handling, and the XMPP launch configuration mappings. |
| `npm run test:cli` | `cli-options.test.js` | Parsing, defaults, validation, and help modes. |
| `npm run test:engine` | `simulation-engine.test.js` | Replay scheduling, ranges, `waitForClient`, and error modes. |
| `npm run test:headless-runner` | `headless-runner.test.js` | The headless entry path, help short-circuiting, and engine handoff. |
| `npm run test:transport-manager` | `transport-manager.test.js` | HTTP/WebSocket client/server delivery, recipient waiting, formats, paths, and explicit TLS verification bypass. |
| `npm run test:help` | `help.test.js` | Help dialog filters, sorting, copy and export, shortcuts, and theme behavior. |
| `npm run test:renderer` | `renderer.test.js` | User interface logic, DOM manipulation, and state changes. |
| `npm run test:preload` | `preload.test.js` | The inter-process bridge and channel validation. |
| `npm run test:about` | `about.test.js` | About dialog rendering and version display. |
| `npm run test:grpc` | `grpc-transport.test.js` | Protobuf, Kryo, and Text serialization; client sends; server `Watch` pushes; disconnect and header paths; and teardown after the peer disappears. |
| `npm run test:http` | `http-transport.test.js` | HTTP client and server lifecycles, POST delivery, recovery after a transient request failure, and the Server-Sent Events subscription rules. |
| `npm run test:ws` | `ws-transport.test.js` | WebSocket client and server lifecycles, subscription messages, bounded teardown with a connected client, immediate rebinding on the same port, and bind-conflict reporting. |
| `npm run test:main` | `main-process.test.js` | The main-process transport lifecycle wiring: awaited disconnect teardown, teardown failures that still finalize state, and the WebSocket send promise. |
| `npm run test:xmpp` | `xmpp-core.test.js` | Stream negotiation and clean close, STARTTLS Required, Preferred, and Disabled, SASL PLAIN and SCRAM-SHA-1, resource binding and conflict policies, IQ error rules, direct chat and undeliverable-message errors, atomic Multi-User Chat join, nickname change, and leave, XEP-0199 ping, basic XEP-0198, reconnect and rejoin, and the size, rate-limit, and loopback bounds. |
| `npm run test:xmpp-transport` | `xmpp-transport.test.js` | Both roles end to end: Direct and Room conversations, STARTTLS policies with automatic self-signed and custom certificates, custom certificate authorities and loopback bypass, the Required pre-SASL abort, per-connection TLS metadata under Preferred, positive-only timings, reserved-identity collisions, certificate and key pairing, exact untrimmed password comparison, recipient readiness and partial-connect cleanup, body and destination limits, bare-JID enforcement, and the Copy Client Settings keys with their password guard. |
| `npm run test:xmpp-secrets` | `xmpp-secrets.test.js` | Proves that no credential reaches standard output or error, the console, diagnostic descriptors, or event payloads during a full STARTTLS, SCRAM-SHA-1, PLAIN, and password-protected room session. |
| `npm run test:presets` | `connection-presets.test.js` | The shared preset contract and its Simulator role mapping, applying every preset without connecting, Custom and Custom (modified), the Protocol Settings sections, empty XMPP passwords, and the explicit certificate-verification controls. |
| `npm run test:summary` | `connection-summary.test.js` | The summary generator: all twelve protocol and mode combinations, secret redaction, warning ordering, effective HTTP and WebSocket URLs, preset state, and the configured-state count. |
| `npm run test:protocol-settings` | `protocol-settings.test.js` | The Protocol Settings dialog: its DOM nesting and preserved control ids, tablist semantics and keyboard navigation, live editing with Revert and Reset, connected and connecting locking, the summary surfaces, and the shortcut wiring. |
| `npm run test:tls` | `tls-verification.test.js` | Client certificate verification stays on by default across gRPC, HTTP, and WebSocket, and is bypassed only through the explicit `allowUnverifiedTls`, `httpAllowUnverifiedTls`, and `wsAllowUnverifiedTls` options. |
| `npm run test:xmpp-parity` | `xmpp-parity.test.js` | The Simulator and Logger contract in `AGENTS.md`: the client default, the deliberate `xmppDestination` and `xmppLocalJid` asymmetry, the shared option vocabulary and timing defaults, the shared `ip` host override, port 5222, and the absence of non-canonical aliases. |
| `npm run test:prereqs-check` | `check-build-prereqs.test.js` | Prerequisite detection and the machine-readable `--json` output. |
| `npm run test:prereqs-install` | `install-prereqs.test.js` | The installer plan, dry-run output, and per-host behavior. |

`run-all-tests.js` also runs `external-sign.test.js`, `sign-lock.test.js`,
`format-utils.test.js`, `velocity-auth-utils.test.js`, and
`tooltip-utils.test.js`. Any suite can be run directly with `node`; a
non-zero exit code means failure.

### Manual checks

Some behavior cannot be reached by the Node-only suites.

`@xmpp/client` is ESM-only and is loaded through Node's `require(esm)` support,
so the packaged Electron runtime must be verified whenever an `@xmpp/*` package
is upgraded:

```bash
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e "require('./src/xmpp-transport.js'); console.log('ok')"
```

The command must print `ok` and exit 0. See
[XMPP transport](xmpp.md#dependency-note) for the underlying constraint.

| Check | Command | Expected result |
|-------|---------|-----------------|
| Help layouts | `npm run help:cli`, `npm run help:cli:wide`, `npm run help:cli:narrow` | Each prints without errors and exits 0. |
| Launcher help | `npm start -- help=true`, `npm start -- -h`, `npm start -- help-table-wide=true`, `npm start -- help-table-narrow=true` | Same output as the matching script. |
| User interface launch | `npm start` | The window opens with the saved theme, size, position, and view, and the startup explanation is printed. |
| Invalid parameters | `npm start -- mysteryOption=true`, `npm start -- hhh` | A clear error plus help, then exit. |
| Ignored parameters | `npm start -- port=6000 protocol=udp` | The interface launches and one warning per ignored parameter is logged. |
| Headless session | `npm run start:headless -- filename=./data.csv` | The file streams and the process exits cleanly. |
| Reference dialog | `F3` in the running application | The dialog lists every parameter; search, quick chips, active pills, sortable columns, copy, and export all respond. |
| Tooltips | Hold the pointer nearly stationary over a new control | The custom tooltip appears after the intent delay with the expected icon, color, and wrapping; movement, interaction, focus alone, and modal dialogs do not open it. |

## Documentation checks

```bash
npm run docs:check-links
```

`scripts/check-doc-links.js` scans the root `README.md` and every file under
`docs/` recursively, and fails on a broken relative link or heading anchor. Run
it after any documentation change, together with `npm test` and
`git diff --check`.

The durable authoring rules — file naming, the guide skeleton, navigation,
tables of contents, link style, tooltip fidelity, and terminology — live in
[`AGENTS.md`](../AGENTS.md).

## Debugging

| Command | Purpose | Ports |
|---------|---------|-------|
| `npm run debug-main` | Main process only. | 9229 |
| `npm run debug-main-brk` | Main process, breaking on start. | 9229 |
| `npm run debug-renderer` | Renderer only. | 9222 |
| `npm run debug-both` | Both processes. | 9229, 9222 |
| `npm run debug-both-brk` | Both processes, breaking on start. | 9229, 9222 |
| `npm run debug-verbose` | Both processes with verbose Electron logging. | 9229, 9222 |

To attach Chrome DevTools to the renderer, run `npm run debug-renderer` and open
`chrome://inspect` or `http://localhost:9222`. For the main process, run
`npm run debug-main` and inspect `localhost:9229` from `chrome://inspect`.
Visual Studio Code configurations are pre-defined in `.vscode/launch.json`:
Debug Main, Debug Renderer, Debug Both, Launch and Debug Main, and Launch and
Debug Both.

Inside the running application, `Cmd+Option+I` or `Ctrl+Shift+I` opens DevTools
directly. The Help menu and the context menu also offer two checkboxes:

- **Toggle Developer Tools (`F12`)** reflects the true open or closed state of DevTools however it was opened, and both menus stay in sync.
- **Inspect Element Mode (`F11`)** enters pick mode; the cursor becomes a crosshair and clicking a control jumps to its element in the DevTools Elements panel. DevTools opens automatically if needed. Press `Escape` or toggle the entry again to cancel; closing DevTools externally cancels pick mode and clears both checkboxes.

Headless runs never create a window, so attach to the main process only:

```bash
electron --inspect-brk=9229 . runMode=headless \
  filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 logLevel=debug

npm run debug-main -- runMode=headless filename=./data.csv \
  protocol=tcp mode=client ip=127.0.0.1 port=5565 logLevel=debug
```

Useful while debugging a headless run: `logLevel=debug` for verbose
diagnostics, `logFile=<path>` to mirror them to a file, `doneFile=<path>` to
inspect the JSON summary, and `exitOnComplete=true` to exit when the file
finishes streaming. Headless exit codes are `0` for success, `1` for a
configuration error, and `2` for a runtime error.

The headless engine supports TCP, UDP, HTTP, WebSocket, gRPC, and XMPP in both
roles where the protocol has a meaningful client/server role. HTTP client sends
POST requests and subscribes to SSE for inbound data; HTTP server replay
recipients are SSE watchers. WebSocket client sends text frames and supports
subscription, first-message suppression, custom headers, authentication tokens,
and TLS settings; WebSocket server recipients are open sockets. These paths use
`http-transport.js` and `ws-transport.js` directly rather than maintaining
headless-specific network implementations.

## Logging

All network-facing operations log through the shared `RunLogger` instance in
`src/main.js` using the `velocityLog(level, message)` helper, with the levels
`error`, `warn`, `info`, and `debug`. Prefix each message with a context tag such
as `[Auth]`, `[API]`, `[Token]`, `[Transport]`, or `[Startup]`, log the operation
on entry and its outcome on completion, and never log a password.

Output goes to both the console and a log file in either mode. The level
defaults to `info` and is set with `logLevel=<level>`; the file defaults to
`./logs/velocity-simulator-YYYYMMDDTHHMMSS.log` and is overridden with
`logFile=<path>`. Entries use the format `[timestamp] [LEVEL] [message]`.

The packaged application writes its logs to:

- **macOS**: `~/Library/Logs/arcgis-velocity-simulator/`
- **Windows**: `%APPDATA%\arcgis-velocity-simulator\logs\`
- **Linux**: `~/.config/arcgis-velocity-simulator/logs/`

## Common failures

| Symptom | Cause and fix |
|---------|---------------|
| A module fails to resolve. | Dependencies are missing or stale. Run `npm install`. |
| A test or script fails with a syntax error on start. | The host Node.js is older than 18, or the file has an error. Check with `node -c src/main.js`. |
| The application exits immediately on launch. | Trace the startup sequence with `npm run debug-main-brk`. |
| The debugger will not attach. | The inspector port is busy. Check with `lsof -i :9229` and stop the stale Electron inspector process by its process ID. |
| A transport cannot bind or connect. | The port is in use. Check with `lsof -i :<port>` or `netstat -an \| grep <port>`. |
| A theme does not apply. | Run `npm run debug-renderer` and inspect the CSS custom properties on `body` in the Elements tab; the theme class is applied in `renderer.js`. |
| A file will not load. | Run `npm run debug-renderer` and read the Console tab, which logs the file name, size, line count, and CSV parse errors. |
| Gesture or voice control does nothing. | Camera or microphone permission is missing. In the renderer console, run `navigator.mediaDevices.getUserMedia({ video: true }).then(() => console.log('ok')).catch(console.error);`. |
| Memory or frame-rate problems. | Profile the renderer with the DevTools Performance tab, or log `process.memoryUsage().rss` periodically from the main process. |
| `npm run docs:check-links` reports a broken target. | A guide was renamed or a heading changed. Fix the link or the anchor and re-run. |

## Extending the application

### Adding a control and its tooltip

1. Add the control to `src/index.html` inside the appropriate `.aligned-group`, following the markup of a nearby working control.
2. Give it a meaningful `data-tooltip` and `aria-label`, plus `data-tooltip-icon` and `data-tooltip-kind` where they add clarity. Write newlines in attributes as `&#10;`.
3. Text inputs and `<select>` dropdowns in an `.aligned-group` need an explicit `text-align: left` override in `src/style.css`; the default right alignment is for numeric and port inputs.
4. Give every `<option>` its own `title`, and keep a `<select>` tooltip in sync with the selected value using the existing `*_TOOLTIPS` objects and `update*Tooltip()` functions in `src/renderer.js`.
5. State-dependent tooltips are set in `src/renderer.js` alongside the icon or label swap, never hard-coded in HTML.
6. Record the exact tooltip string in the guide that owns the control, and update `src/help.html`.
7. Persist the value through `src/config.js` if it belongs in App Config, or through the launch configuration mapping in `src/main.js` if it belongs in Launch Config.

### Adding a protocol setting

1. Add the control to the section it belongs to inside `#protocol-settings-dialog` in `src/index.html`: **Basics** for what is sent and where, **Security** for TLS, certificates, and who may connect, **Advanced** for what most connections leave alone. Keep the existing `.control-group aligned-group` markup so the row aligns with its neighbors.
2. Show and hide it from the protocol's visibility function in `src/renderer.js`. A section with no visible control is dropped from the tablist automatically, so nothing else has to change.
3. Never lock the control by hand: `updateProtocolSettingsMode()` locks every control inside the dialog through one scoped query.
4. Map the field in `CONNECTION_PRESET_CONTROLS` in `src/connection-presets.js` and add its documented default to `PROTOCOL_SETTING_FIELDS` in `src/connection-summary.js`, then emit its row from the protocol function that owns it. A secret must go through `describeSecret()`.
5. Record the tooltip in the owning transport guide and in `src/help.html`, then extend `test/protocol-settings.test.js` and `test/connection-summary.test.js`.

### Adding a transport

1. Add the protocol's options to `src/cli-options.js` so terminal help, the reference dialog, and the documentation stay in sync.
2. Implement the transport with the shared `connect`, `send`, `disconnect`, `isConnected`, and `hasRecipients` surface, reusing `src/tls-utils.js` and `src/format-utils.js` instead of duplicating logic.
3. Register it in `src/transport-manager.js`, adding it to `OBJECT_TRANSPORT_PROTOCOLS` when its connection handle is a transport object rather than a raw socket. Register the transport before awaiting `connect()` so a partial connect is still torn down.
4. In server mode, call the recipient-waiter resolution when a receiver becomes genuinely reachable so `waitForClient=true` headless runs release at the right moment.
5. Add the controls, tooltips, and persistence described above, placing every protocol-specific control inside the Protocol Settings dialog and leaving host, port, and mode in the panel.
6. Add a test suite under `test/` and list it in `test/run-all-tests.js` and in the `package.json` scripts.
7. Write the transport guide in `docs/`, with its controls, tooltip reference, and troubleshooting, then update `src/help.html`, the [command-line reference](command-line.md), [Configuration](configuration.md), [Headless mode](headless.md), the samples in `docs/examples/`, and both documentation indexes.

### Adding a theme

1. Create `src/themes/theme-<name>.css` following the structure of an existing theme file, defining the same CSS custom properties for `body.theme-name` and `[data-theme="theme-name"]`.
2. Add an `@import` for it in `src/themes.css`, which also holds the dark-theme fallback in `:root`.
3. Add the menu entry in `src/main.js` and include the name in the theme class-removal pattern in `src/renderer.js`.
4. List the theme in [Configuration](configuration.md).

Special cases already in the tree: `theme-light.css` also defines `:root`
fallbacks, `theme-system.css` uses `prefers-color-scheme` media queries, and
`theme-high-contrast.css` adds extra rules to keep button contrast accessible.
If a theme file fails to load, the dark fallback keeps the application usable.

## Validation checklist

Run before opening a pull request:

1. `npm test` — every suite passes.
2. `npm run docs:check-links` — no broken link or anchor.
3. `git diff --check` — no whitespace errors.
4. Targeted suites for the area changed, for example `npm run test:xmpp-transport` for XMPP work.
5. `npm start` — hover any new or changed control and confirm the tooltip text matches the documentation character for character.
6. Documentation for the changed behavior updated in the same change, including `src/help.html` and the tooltip reference tables.
7. For dependency changes affecting `@xmpp/*`, the Electron module load check in [Manual checks](#manual-checks).

## Related documentation

| Document | Purpose |
|----------|---------|
| [Build and release](build-and-release.md) | Prerequisites, packaging, signing, and the release commands. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Headless mode](headless.md) | No-UI replay sessions, parameters, and the completion artifact. |
| [Configuration](configuration.md) | App Config and Launch Config settings, themes, storage locations, and reset steps. |
| [Protocol settings and presets](connection-presets.md) | The connection panel, the Protocol Settings dialog, and the paired presets. |
| [Connection summary and protocol settings](connection-summary.md) | The summary generator, its surfaces, and how to add a row. |
