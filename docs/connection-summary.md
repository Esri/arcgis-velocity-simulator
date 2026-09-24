# Connection summary and protocol settings

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator keeps the shared connection fields inline and moves
every protocol-specific control into **Protocol Settings**, a dedicated
resizable window. A single connection summary is generated from those values
and shown in its read-only Summary section. Any warning stays visible in the
panel without requiring hover or an extra click. This guide is for users
configuring a connection and for developers changing the settings surface; it
assumes a running app.

## Table of contents

- [What stays inline and what moves into Protocol Settings](#what-stays-inline-and-what-moves-into-protocol-settings)
- [Opening Protocol Settings](#opening-protocol-settings)
- [Sections](#sections)
- [Editing model](#editing-model)
- [Read-only states](#read-only-states)
- [Validation](#validation)
- [The connection summary](#the-connection-summary)
- [What the summary reports](#what-the-summary-reports)
- [Secrets](#secrets)
- [Warnings](#warnings)
- [Keyboard](#keyboard)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Related documentation](#related-documentation)

## What stays inline and what moves into Protocol Settings

The connection row holds only the fields that every protocol shares:

| Inline | Moved into Protocol Settings |
|---|---|
| File selection, then the **Setup** toolbar: Preset, **Modified**, and Settings. | TCP and UDP format, CSV header row, coordinate fields, and WKID. |
| Connection type. | gRPC serialization, RPC type, and endpoint header. |
| Host and Port. | HTTP format and path. |
| **Connect**, **Disconnect**, **Play/Pause**, and **Step**. | WebSocket format, path, subscription message, **Skip 1st**, and headers. |
| File selection, the lines and interval rate fields, and the playback actions. | XMPP domain, conversation, account, destination, room, remote binding, timing, TLS or STARTTLS, certificate paths, and **Allow unverified**. |

No control is duplicated: each one exists once, in exactly one place, and keeps
the element identifier it always had. The authoritative copy of every control
is a native in-document `<dialog>` nested inside the connection controls; the
running application mirrors that element into its own dedicated, resizable
window rather than rendering it in the main document, so it can be moved and
resized independently of the main application window — including taller than
it — while every edit still reaches the connection row's preset and validation
handling.

## Opening Protocol Settings

Select **Settings** in the **Setup** toolbar, or press
`Cmd/Ctrl+Shift+P`. The button carries a compact numeric chip when settings
differ from the documented defaults:

- No chip — the protocol has nothing to configure, or every setting is at its
  documented default.
- `2` — two settings differ from their documented defaults.

Connection warnings remain visible beneath the toolbar. The configured-state
badge stays current while disconnected, connecting, and connected. The window's
title tracks the selected protocol and mode — for example
`WebSocket Client settings` — and its subtitle states the composed endpoint,
such as `Publishing to wss://example.com:9443/stream`.

Selecting **Settings** or pressing the shortcut again while Protocol Settings
is already open brings its window back into focus; neither ever closes it.
Closing the window — from its own title bar, **Done**, the close control, or
`Esc` — keeps every edit.

## Sections

Protocol Settings groups the selected protocol's controls into sections,
presented as a left rail when the window is wide and as a compact segmented
tab strip below roughly 760 pixels. Sections that hold nothing for the
selected protocol and mode are not offered:

| Section | Holds | Offered for |
|---|---|---|
| Basics | Format, path, serialization, RPC type, XMPP domain, conversation, account, and room fields. | TCP, UDP, gRPC, HTTP, WebSocket, XMPP. |
| Security | TLS or the STARTTLS policy, certificate verification, the CA, certificate, and key paths, and XMPP **Allow remote**. | gRPC, HTTP, WebSocket, XMPP. |
| Advanced | TCP and UDP CSV schema and geometry, gRPC endpoint header, WebSocket subscription message, **Skip 1st**, headers, and XMPP timing values. | TCP, UDP, gRPC Client, WebSocket, XMPP. |
| Summary | Every connection setting as a read-only list, warnings first. | Every mode. |

TCP and UDP offer Basics, Advanced, and Summary. HTTP has no Advanced settings,
and a gRPC Server has none either because the endpoint header applies to client
mode only.

Sections use `tablist`, `tab`, and `tabpanel` semantics with a roving tab stop:
only the selected tab is in the tab order, `←`, `→`, `↑`, and `↓` move between
sections, and `Home` and `End` jump to the first and last section.

## Editing model

Edits apply live to the underlying controls, so **Connect** always uses what is
on screen. Protocol Settings records a snapshot of every value it opened with,
which gives the footer three explicit choices:

| Footer action | Effect |
|---|---|
| **Done** | Closes Protocol Settings and keeps every edit. Nothing connects. |
| **Revert changes** | Restores the values Protocol Settings opened with, including the preset state, and leaves it open. Enabled only while something differs from the snapshot. |
| **Reset to preset** | Re-applies the preset the fields started from. Enabled only when the preset state is **Custom (modified)**. |

`Esc` and the close control behave exactly like **Done**, and so does closing
the window from its own title bar: Protocol Settings closes, the edits are
kept, and focus returns to the control that opened it.

Editing a populated field inside Protocol Settings switches the preset display
to **Custom (modified)**, exactly as editing an inline field does. Applying a
preset while Protocol Settings is closed still fills every field, updates the
title, subtitle, and chip, and never opens it. When a preset turns on an
explicit certificate bypass, Protocol Settings pre-selects **Security** so the
warning-valued setting is the first thing shown the next time it opens. See
[Connection presets](connection-presets.md).

## Read-only states

| State | Behavior |
|---|---|
| Disconnected or error | Everything is editable. |
| Connecting or disconnecting | Every control is disabled and a banner explains why. The shared preset, connection type, host, and port are locked with it, so a connection cannot be re-pointed while it is being made. Sections stay navigable. |
| Connected | Protocol Settings opens directly in read-only summary mode with only the **Summary** section offered. |

The read-only banner reads `Connected. Disconnect to change these settings.`
while connected and `Connecting. Disconnect to change these settings.` while a
connection is being established.

Locking is applied by querying the authoritative controls rather than by
listing them, so every protocol control is locked — including the HTTP,
WebSocket, and gRPC fields that were previously left editable during a live
connection. The two XMPP server actions are the deliberate exception: **Copy
Client Settings** and **Include password** stay available exactly while an
XMPP Server is connected, because the settings they copy only exist once the
server is listening. See
[XMPP transport](xmpp.md).

## Validation

Validation failures are announced in an assertive banner at the top of
Protocol Settings (`role="alert"`, `aria-live="assertive"`). A failed
**Connect**:

1. opens Protocol Settings;
2. selects the section that owns the offending control;
3. moves focus to that control;
4. sets `aria-invalid="true"` and adds the banner id to `aria-describedby`
   without discarding the descriptions already there;
5. writes the same message to the status log.

Correcting the field clears `aria-invalid` and removes only the banner's own
`aria-describedby` token, leaving any tooltip description in place.

Two rules apply to every TLS-capable transport: a certificate and its private
key must be provided together, and XMPP keeps its own required-field rules for
domain, account, and room values. Passwords are never required — an empty
password is a valid credential for a local pairing. Leaving both the certificate
and the key empty is valid for a server: it uses an automatic self-signed
certificate.

## The connection summary

One generator, `src/connection-summary.js`, produces both summary surfaces, so
they can never disagree:

| Surface | Shows | Opens |
|---|---|---|
| Warning alert | The warning count and highest-priority warning; hidden when no warning applies. | Beneath the Setup toolbar. |
| Read-only Summary section | Every row, warnings first, plus **Copy summary**. | Inside Protocol Settings. |

Neither surface is hover-only. Open Protocol Settings and select its Summary tab.

**Copy summary** places the summary on the clipboard as plain text. The copied text
starts with
`ArcGIS Velocity Simulator — connection summary`, then the mode and state, then one
`Label: value` line per row.

## What the summary reports

Row keys are a cross-application contract shared with the ArcGIS Velocity
Logger wherever the roles overlap. The Simulator sends data, so it reports
`xmppDestination` — the bare JIDs each replayed line is delivered to — where the
Logger reports the identity it receives on.

| Row key | Label | Reported for |
|---|---|---|
| `unverifiedCertificate` | Certificate verification | A TLS client with the bypass on. |
| `opportunisticTls` | STARTTLS | XMPP with the Preferred policy. |
| `unsecureTransport` | Encryption | gRPC, HTTP, WebSocket, or XMPP without TLS. |
| `remoteBind` | Remote binding | An XMPP Server with **Allow remote** on. |
| `serverCertificateIncomplete` | Server certificate | A TLS server given a certificate without its key, or the reverse. |
| `connection` | Connection | Every mode. |
| `endpoint` | Listening on, or Publishing to | Every mode. |
| `status` | Status | Every mode. |
| `preset` | Preset | Every mode. |
| `tls` | TLS, or TLS policy | Every mode. |
| `certificateVerification` | Certificate verification | Every mode in which encryption applies. |
| `certificateAuthority` | CA certificate | TLS-capable modes. |
| `certificate` | Certificate, or Server certificate | TLS-capable modes. |
| `certificateKey` | Private key | TLS-capable modes. |
| `grpcSerialization` | Serialization | gRPC. |
| `grpcRpcType` | RPC type | gRPC. |
| `grpcEndpointHeader` | Endpoint header | gRPC Client. |
| `format` | Format | TCP, UDP, HTTP, WebSocket. |
| `csvHeader` | CSV header row | TCP, UDP. |
| `udpAppendNewline` | Append LF | UDP publishing; see [UDP transport](udp.md). |
| `tcpAddressFamily` | Address family | TCP Auto, IPv4, or IPv6. |
| `tcpHandshakeText` | Handshake text | TCP only; Empty or Set (hidden), including whitespace-only values. |
| `tcpHandshakeUseEscapes` | Use escapes | TCP greeting escape interpretation, enabled by default. |
| `udpAddressFamily` | Address family | UDP IPv4 or IPv6. |
| `expectedDestination` | Expected destination | Shared UDP output-routing metadata when supplied; separate from the local bind endpoint. |
| `pointFields` | Point fields | TCP, UDP. |
| `wkid` | Geometry WKID | TCP, UDP. |
| `path` | Path | HTTP, WebSocket. |
| `wsSubscriptionMessage` | Subscription message | WebSocket. Presence only. |
| `wsSkipFirstMessage` | Skip first message | WebSocket. |
| `wsHeaders` | Upgrade headers | WebSocket. Presence only. |
| `xmppDomain` | Domain | XMPP. |
| `xmppConversation` | Conversation | XMPP. |
| `xmppAccount` | Username | XMPP Client. |
| `xmppPassword` | Password | XMPP Client. |
| `xmppResource` | Resource | XMPP Client. |
| `xmppDestination` | Destination | XMPP in a direct conversation. |
| `xmppExternalAccount` | External user | XMPP Server. |
| `xmppExternalPassword` | External password | XMPP Server. |
| `xmppAllowRemote` | Allow remote | XMPP Server. |
| `xmppRoom` | Room | XMPP in Multi-User Chat. |
| `xmppNickname` | Nickname | XMPP in Multi-User Chat. |
| `xmppRoomPassword` | Room password | XMPP in Multi-User Chat. |
| `xmppTiming` | Timing | XMPP. |

Each row carries `key`, `label`, `value`, `group`, `kind`, `severity`, `secret`,
`isDefault`, and `detail`. The groups are `Security`, `Connection`, `Protocol`,
and `Session`; the kinds are `warning`, `state`, `endpoint`, `preset`,
`security`, `setting`, and `secret`.

A server that is given neither a certificate nor a key reports
`Automatic self-signed certificate` and `Automatic self-signed key`, because
that is a supported local-testing configuration. Only a half-configured pair —
one of the two provided — raises a warning.

The endpoint row is a composed URL wherever a URL exists:
`https://127.0.0.1:8443/receiver/feed` for HTTP, `wss://[::1]:8443/stream` for
WebSocket — IPv6 literals are bracketed — and `host:port` for TCP, UDP, gRPC,
and XMPP. A blank host or port is reported as `Not set` rather than guessed.

## Secrets

A password-like value is never placed in a row, a tooltip, the clipboard, or a
log. This covers the XMPP account, external, and room passwords, and it also
covers the two WebSocket fields documented as carriers of credentials — the
subscription message and the upgrade headers — because either may hold a token
or an `Authorization` value. The summary reports exactly one of three strings:

| Reported | Meaning |
|---|---|
| `Set (hidden)` | A value is present. Its content is never shown. |
| `Empty` | The field is deliberately empty, which XMPP accepts as a valid credential. |
| `Not set` | The field does not apply, or an optional secret such as a room password is unused. |

## Warnings

Warning rows are generated before every other row, and the highest-priority
warning remains visible beneath the Setup toolbar. An explicit
certificate-verification bypass always leads, because it applies to every host
rather than only to loopback. The warning alert and Settings chip switch to
their warning style. See
[TLS and SSL security](tls.md#explicit-certificate-verification-bypass).

## Keyboard

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Open Protocol Settings | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Move between sections | `←` `→` `↑` `↓` | `←` `→` `↑` `↓` |
| First or last section | `Home` / `End` | `Home` / `End` |
| Close and keep edits | `Escape` | `Escape` |

The Protocol Settings shortcut works while a connection field has focus, and
pressing it again while the window is already open focuses that window rather
than closing it. Select the Summary tab to inspect the effective connection.
Protocol Settings opens in its own resizable window: drag any edge or corner
to resize it, independently of the main application window and taller than it
if needed, and it remembers its size and position the next time it opens.

## UI controls

| Control | Description |
|---|---|
| Settings | Opens Protocol Settings for the selected protocol. Carries the configured-state chip; compact view hides the chip. |
| Basics, Security, Advanced, Summary | Section tabs. Only sections with content for the selected protocol and mode are offered. |
| Done | Closes Protocol Settings and keeps the edits. |
| Revert changes | Restores the values Protocol Settings opened with. |
| Reset to preset | Re-applies the preset the fields started from. |
| Close (✕) | Same as Done. |
| Copy summary | Copies the summary as text, with secrets redacted. |

## Tooltip reference

These strings match `src/index.html` and `src/renderer.js` exactly. The Protocol
Settings tooltip is rebuilt by `renderConnectionSummary()` as the connection
changes; the values below show its structure.

Visual tooltips appear only after the pointer remains nearly stationary for
about 900 ms. Moving, clicking, typing, scrolling, or dragging cancels them, and
they do not appear from focus alone or while a modal dialog is open. Focused
controls still expose the same text as a non-visual accessible description.

| Element | Tooltip |
|---|---|
| Settings | Protocol Settings (Cmd/Ctrl+Shift+P)<br>---<br>Open the &lt;mode&gt; settings: &lt;n&gt; of &lt;total&gt; changed from their defaults. |
| Basics | Basics<br>The settings this protocol needs before it can send data. |
| Security | Security<br>TLS, certificate verification, and certificate paths for this protocol. |
| Advanced | Advanced<br>Optional settings that most connections leave at their defaults. |
| Summary | Summary<br>Every connection setting in one read-only list, with warnings first. Passwords are never shown. |
| Close (✕) | Close Protocol Settings and keep your edits (Esc) |
| Done | Keep your edits and close Protocol Settings. Nothing connects until you select Connect. |
| Revert changes | Restore the values this dialog opened with. Fields outside the dialog are untouched. |
| Reset to preset (available) | Restore every field of "&lt;preset label&gt;", the preset these settings started from. |
| Reset to preset (unavailable) | Restore every field of the preset these settings started from. Available only after a preset is applied and edited. |
| Copy summary | Copy the connection summary as text. Passwords are never copied. |

## Related documentation

- [Connection presets](connection-presets.md)
- [Data formats](data-formats.md)
- [TCP transport](tcp.md)
- [UDP transport](udp.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [TLS and SSL security](tls.md)
- [XMPP transport](xmpp.md)
- [Developer guide](developer-guide.md)
