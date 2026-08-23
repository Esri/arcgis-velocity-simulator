# Protocol settings and presets

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The connection panel holds the settings every connection needs, and
**Protocol Settings** holds everything specific to the selected
protocol. Connection presets pre-fill both at once for a paired local test
between the ArcGIS Velocity Simulator and the ArcGIS Velocity Logger.

This guide is written for users configuring a connection and for developers
changing the panel. It covers the panel layout, Protocol Settings,
the twelve paired presets, and the Custom and Custom (modified) states.

## Table of contents

- [The connection panel](#the-connection-panel)
- [The Protocol Settings window](#the-protocol-settings-window)
- [What a preset is](#what-a-preset-is)
- [The twelve paired presets](#the-twelve-paired-presets)
- [What each preset fills](#what-each-preset-fills)
- [Custom and Custom (modified)](#custom-and-custom-modified)
- [Minimal local test with the Logger](#minimal-local-test-with-the-logger)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Related documentation](#related-documentation)

## The connection panel

The panel shows only what is true of every connection, in this order:

1. **File** — the file to replay.
2. **Setup** — the paired preset and **Modified** badge, plus **Settings**.
3. **Mode** — the connection type, which is the protocol and the role.
4. **Connection** — the host and the port.
5. **Lines / ms** — the replay rate.
6. **Connect**, **Disconnect**, **Play/Pause**, and **Step**.

TCP and UDP have no settings of their own. **Settings** remains available for
the read-only Summary, while its count stays hidden. A compact warning alert
appears only when the current values need attention.

## The Protocol Settings window

**Settings** opens a dedicated, resizable window that holds every control
belonging to the selected protocol. It is independently movable and
resizable — including taller than the main application window — and it
remembers its size and position the next time it opens. The window's title
tracks the selection, for example `WebSocket Client settings`, and the button
carries a concise configured state count when values differ from their
defaults, such as `2`. Connection warnings remain visible beneath the toolbar.

Open it with the button or with `Cmd+Shift+P` on macOS and `Ctrl+Shift+P` on
Windows and Linux. Selecting **Settings** or pressing the shortcut again while
the window is already open brings it back into focus rather than opening a
second one or closing it. Closing the main application window also closes it.

### Sections

Protocol Settings offers only the sections that hold a control for the current
protocol and role:

| Protocol | Basics | Security | Advanced |
|---|---|---|---|
| HTTP | Format, HTTP path | TLS, CA/cert/key paths, Allow unverified | — |
| WebSocket | Format, WS path | TLS, CA/cert/key paths, Allow unverified | Subscribe, Ignore 1st msg, Headers |
| gRPC | Serialization, RPC type | TLS, CA/cert/key paths, Allow unverified | Header path key and value, for a client |
| XMPP | Conversation, domain, account, destination or room, Copy Client Settings | STARTTLS, CA/cert/key paths, Allow unverified, Allow remote | Timeouts, ping interval, reconnect delay |

A fourth section, **Summary**, is always offered and holds the read-only
connection summary. TCP and UDP have no protocol settings, so only **Summary**
is offered and the panel says where the connection fields live.

The section list is a tablist. It is a left rail at normal width and a top
segmented control in compact view, and the same keys work in both: `Arrow` keys
move between sections and wrap around, `Home` selects the first section, and
`End` selects the last. A single tab stop leads into the rail, so `Tab` moves
into the section rather than through every section name.

### Editing, reverting, and closing

Edits take effect in the application as you make them, but nothing reaches the
network until you select **Connect**.

| Action | Result |
|---|---|
| **Done** | Closes Protocol Settings and keeps the edits. |
| **Revert changes** | Restores every field to the value it held when Protocol Settings was opened, and keeps it open. It is enabled only while something still differs from those values. |
| **Reset to preset** | Reapplies the preset the fields were modified from. It is enabled only while the fields derive from a modified preset. |
| `Esc` | Closes Protocol Settings and keeps the edits, exactly like **Done**. |

Closing the window from its own title bar behaves exactly like **Done**, and
focus returns to the **Settings** button when Protocol Settings closes.

### Connection state

| State | Protocol Settings |
|---|---|
| Disconnected | Every control is editable. |
| Connecting | It opens, every control is read-only, and the banner reads `Connecting. Disconnect to change these settings.` The shared preset, connection type, host, and port are locked with it. |
| Connected | It opens on the read-only **Summary** section with the banner `Connected. Disconnect to change these settings.` |

While an XMPP server is connected, **Copy Client Settings** and **Include
password** stay available, because that is the only state in which the bound
address and the generated identity are known. Everything else is locked.

No field required to connect is hidden. If validation fails while Protocol
Settings is closed, it opens on the section holding the offending control, the
control is revealed and focused, an assertive banner names the problem, and the
same message is written to the status log. The banner is added to the control's
`aria-describedby` rather than replacing existing descriptions.

## What a preset is

A preset is a named bundle of connection field values. Selecting one **only
pre-fills editable fields**. A preset never:

- connects or disconnects,
- starts or stops playback,
- selects a file,
- saves a password or any other secret,
- changes the application startup defaults or the persisted configuration.

Every field stays editable after a preset is applied, and every preset writes
the complete connection field set, so optional fields that the preset does not
use are reset to their documented defaults. Two consecutive preset selections
therefore always produce the same result, with no leftovers from the previous
protocol.

Preset definitions live in `src/connection-presets.js` and are shared by the
renderer and the tests. The identifiers and labels are a cross-application
contract: the ArcGIS Velocity Logger exposes the same twelve identifiers and
labels with the roles inverted, so both applications are configured by picking
the same entry by name.

## The twelve paired presets

Each label names which application listens. In this repository:

- **Logger Server / Simulator Client** selects a Simulator `*-client`
  connection type. The Simulator connects to the Logger.
- **Simulator Server / Logger Client** selects a Simulator `*-server`
  connection type. The Logger connects to the Simulator.

| Identifier | Label | Simulator mode | Endpoint |
|---|---|---|---|
| `local-tcp-logger-server` | Local TCP — Logger Server / Simulator Client | TCP Client | 127.0.0.1:5565 |
| `local-tcp-simulator-server` | Local TCP — Simulator Server / Logger Client | TCP Server | 127.0.0.1:5565 |
| `local-udp-logger-server` | Local UDP — Logger Server / Simulator Client | UDP Client | 127.0.0.1:5565 |
| `local-udp-simulator-server` | Local UDP — Simulator Server / Logger Client | UDP Server | 127.0.0.1:5565 |
| `local-grpc-logger-server` | Local gRPC — Logger Server / Simulator Client | gRPC Client | 127.0.0.1:5565 |
| `local-grpc-simulator-server` | Local gRPC — Simulator Server / Logger Client | gRPC Server | 127.0.0.1:5565 |
| `local-http-logger-server` | Local HTTP — Logger Server / Simulator Client | HTTP Client | 127.0.0.1:8080 |
| `local-http-simulator-server` | Local HTTP — Simulator Server / Logger Client | HTTP Server | 127.0.0.1:8080 |
| `local-ws-logger-server` | Local WebSocket — Logger Server / Simulator Client | WebSocket Client | 127.0.0.1:8080 |
| `local-ws-simulator-server` | Local WebSocket — Simulator Server / Logger Client | WebSocket Server | 127.0.0.1:8080 |
| `local-xmpp-logger-server` | Local XMPP — Logger Server / Simulator Client | XMPP Client | 127.0.0.1:5222 |
| `local-xmpp-simulator-server` | Local XMPP — Simulator Server / Logger Client | XMPP Server | 127.0.0.1:5222 |

## What each preset fills

| Protocol | Values |
|---|---|
| TCP, UDP | Host `127.0.0.1`, port `5565`. |
| gRPC | Host `127.0.0.1`, port `5565`, Text serialization, Client Streaming, TLS off. |
| HTTP | Host `127.0.0.1`, port `8080`, Delimited (CSV), path `/`, TLS off. |
| WebSocket | Host `127.0.0.1`, port `8080`, Delimited (CSV), path `/`, TLS off, no subscription message, first message kept. |
| XMPP (both) | Host `127.0.0.1`, port `5222`, domain `localhost`, Direct conversation, Required STARTTLS. |
| XMPP client variant | Username `simulator`, password intentionally empty, resource `velocity-simulator`, destination `velocity-logger@localhost`, Allow unverified on. |
| XMPP server variant | External account `velocity-logger`, external password intentionally empty, Allow remote off, empty destination so every signed-in stream receives each line. |

The XMPP passwords are intentionally left empty. A present-but-empty password
is accepted end to end for both PLAIN and SCRAM-SHA-1, so a local pairing needs
no shared secret. See [XMPP transport](xmpp.md#empty-passwords) for the full
behavior.

The XMPP client preset is the only place where the certificate-verification
bypass is enabled automatically, because the paired Logger presents an
ephemeral self-signed certificate on loopback. Every other **Allow unverified**
control stays off until you turn it on. See
[TLS and SSL security](tls.md#explicit-certificate-verification-bypass).

## Custom and Custom (modified)

- **Custom** is the startup default. Selecting it keeps the current connection
  fields exactly as they are — nothing is filled and nothing is reset.
- Editing any populated connection or protocol field after applying a preset
  switches the displayed state to **Custom (modified)**. Your edit is kept; only
  the indicator changes. A small **Modified** badge appears next to the dropdown
  and the tooltip names the preset the fields started from.
- Selecting the same preset again restores its values.

Command-line prepopulation (`npm start -- protocol=… mode=…`) fills the same
fields without marking the state as modified, because it is not a manual edit.
The same is true of a feed applied from the
[ArcGIS Velocity sign-in and feed picker](velocity-login.md).

A preset never opens Protocol Settings. It pre-fills the fields
wherever they live, whether Protocol Settings is open or closed, and reports
what it did in the status log. When a preset turns a certificate-verification
bypass on, it also says so and sends Protocol Settings to **Security** the
next time it opens, so a warning-level control is never enabled out of sight.

## Minimal local test with the Logger

Start the Logger first, then the Simulator.

1. In the Logger, select the preset **Local XMPP — Logger Server / Simulator
   Client**, then select **Connect**.
2. In the Simulator, select the preset with the same name, choose the FAA
   sample file, then select **Connect** and **Play**.

The equivalent command line uses empty passwords and no other options.

**Terminal 1 — Logger:**

```bash
npm start -- protocol=xmpp mode=server ip=127.0.0.1 xmppExternalUsername=simulator xmppExternalPassword=
```

**Terminal 2 — Simulator:**

```bash
npm start -- filename=/Users/hano4470/Backup/data/faa.csv protocol=xmpp mode=client ip=127.0.0.1 xmppUsername=simulator xmppPassword= xmppDestination=velocity-logger@localhost xmppAllowUnverifiedTls=true
```

`xmppAllowUnverifiedTls=true` lets the Simulator accept the Logger's automatic
self-signed certificate while STARTTLS still encrypts the stream. The bypass
applies to any host the Simulator connects to, so leave it off outside local
testing.

## UI controls

| Control | Description |
|---|---|
| Preset | Pre-fills the connection fields for a paired local Simulator and Logger test. Defaults to Custom. |
| Modified badge | Appears after a populated field is edited; names the preset the fields started from. |
| Settings | Opens Protocol Settings and carries the configured state. |
| Summary | Opens the read-only Summary section and carries the warning count. |
| Section tabs | Basics, Security, and Advanced, offered only where the section holds a control. |
| Done | Closes Protocol Settings and keeps the edits. |
| Revert changes | Restores the values the fields held when Protocol Settings was opened. |
| Reset to preset | Reapplies the preset the fields were modified from. Enabled only for a modified preset. |

## Tooltip reference

These strings are produced by `describeConnectionPreset()` in
`src/connection-presets.js` and applied by `renderer.js`.

| Element | Tooltip |
|---|---|
| Preset (label) | `Pre-fills the connection fields for a paired local Simulator and Logger test.` |
| Preset (Custom) | `Custom` / `Keeps the current connection fields exactly as they are. Choose a paired preset to pre-fill a local Simulator and Logger test.` / `Preset: pre-fills the connection fields for a paired local Simulator and Logger test. It only fills editable fields — it never connects, starts playback, selects a file, or saves a secret.` |
| Preset (applied) | `<label>` / `<preset summary>` / `Preset: pre-fills the connection fields for a paired local Simulator and Logger test. It only fills editable fields — it never connects, starts playback, selects a file, or saves a secret.` |
| Preset (modified) | `Custom (modified)` / `These fields started from "<label>" and were edited. Select the preset again to restore its values.` / `Preset: pre-fills the connection fields for a paired local Simulator and Logger test. It only fills editable fields — it never connects, starts playback, selects a file, or saves a secret.` |
| Modified badge | `Modified` / `These fields started from "<label>" and were edited. Select the preset again to restore its values.` |
| Settings | `Protocol Settings (Cmd/Ctrl+Shift+P)` / `Open the <mode> settings: <n> of <total> changed from their defaults.` |
| Basics tab | `Basics` / `The settings this protocol needs before it can send data.` |
| Security tab | `Security` / `TLS, certificate verification, and certificate paths for this protocol.` |
| Advanced tab | `Advanced` / `Optional settings that most connections leave at their defaults.` |
| Summary tab | `Summary` / `Every connection setting in one read-only list, with warnings first. Passwords are never shown.` |
| Close | `Close Protocol Settings and keep your edits (Esc)` |
| Done | `Keep your edits and close Protocol Settings. Nothing connects until you select Connect.` |
| Revert changes | `Restore the values this dialog opened with. Fields outside the dialog are untouched.` |
| Reset to preset | `Restore every field of the preset these settings started from. Available only after a preset is applied and edited.` |

Protocol Settings holds the following controls for each protocol:

| Protocol | Contents |
|---|---|
| HTTP | `format, HTTP path, TLS, and certificates` |
| WebSocket | `format, WS path, TLS, certificates, subscription message, and headers` |
| gRPC | `serialization, RPC type, header path, TLS, and certificates` |
| XMPP | `conversation, domain, account, destinations, STARTTLS, and timings` |

## Related documentation

| | Guide | Purpose |
|---|-------|---------|
| 🧾 | [Connection summary and protocol settings](connection-summary.md) | The read-only description of the current connection, its warnings, and how it is copied. |
| 💬 | [XMPP transport](xmpp.md) | Client and server roles, conversations, accounts, and STARTTLS policies. |
| 🔒 | [TLS and SSL security](tls.md) | Certificate types, trust stores, and the explicit verification bypass. |
| ⌨️ | [Command-line reference](command-line.md) | Every parameter, its values, default, and example. |
| ⚙️ | [Configuration](configuration.md) | Persisted App Config and Launch Config keys. |
