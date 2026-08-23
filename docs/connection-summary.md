# Connection summary and protocol settings

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

ArcGIS Velocity Simulator keeps the shared connection fields inline and moves
every protocol-specific control into a **Protocol Settings** dialog. A single
connection summary is generated from those values and shown on three surfaces,
so the endpoint the Simulator is about to publish to — and any risk it carries —
is always readable without hovering anything. This guide is for users
configuring a connection and for developers changing the settings surface; it
assumes a running app.

## Table of contents

- [What stays inline and what moves into the dialog](#what-stays-inline-and-what-moves-into-the-dialog)
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

## What stays inline and what moves into the dialog

The connection row holds only the fields that every protocol shares:

| Inline | Moved into Protocol Settings |
|---|---|
| File selection, then Preset and the **Modified** badge. | gRPC serialization, RPC type, and endpoint header. |
| Connection type. | HTTP format and path. |
| Host and Port. | WebSocket format, path, subscription message, **Skip 1st**, and headers. |
| **Connect**, **Disconnect**, **Play/Pause**, and **Step**. | XMPP domain, conversation, account, destination, room, remote binding, and timing. |
| File selection, the lines and interval rate fields, and the playback actions. | TLS toggles or the STARTTLS policy, certificate paths, and **Allow unverified**. |

No control is duplicated: each one exists once, in exactly one place, and keeps
the element identifier it always had. The dialog is a native in-window
`<dialog>` nested inside the connection controls, so it renders in the browser
top layer instead of a separate window while still taking part in the connection
row's event handling.

## Opening Protocol Settings

Select **Protocol Settings…** in the connection row, or press
`Cmd/Ctrl+Shift+P`. The button carries a chip that always reports the
configured state of the selected protocol:

- `TCP · no protocol settings` — the protocol has nothing to configure.
- `HTTP · defaults` — every HTTP setting is at its documented default.
- `HTTP · 2 changed` — two HTTP settings differ from their documented defaults.
- `HTTP · 2 changed · 1 warning` — a warning is appended to the count, never
  substituted for it, so a bypass never hides the settings that were changed.

The chip is persistent: it stays visible and current while disconnected,
connecting, and connected, and it turns into a warning chip whenever the summary
reports a warning. The dialog title tracks the selected protocol and mode — for
example `WebSocket Client settings` — and its subtitle states the composed
endpoint, such as `Publishing to wss://example.com:9443/stream`.

## Sections

The dialog groups the selected protocol's controls into sections, presented as a
left rail on a wide window and as a compact segmented tab strip below roughly
760 pixels. Sections that hold nothing for the selected protocol and mode are
not offered:

| Section | Holds | Offered for |
|---|---|---|
| Basics | Format, path, serialization, RPC type, XMPP domain, conversation, account, and room fields. | gRPC, HTTP, WebSocket, XMPP. |
| Security | TLS or the STARTTLS policy, certificate verification, the CA, certificate, and key paths, and XMPP **Allow remote**. | gRPC, HTTP, WebSocket, XMPP. |
| Advanced | gRPC endpoint header, WebSocket subscription message, **Skip 1st**, headers, and the XMPP timing values. | gRPC Client, WebSocket, XMPP. |
| Summary | Every connection setting as a read-only list, warnings first. | Every mode. |

TCP and UDP have no protocol settings at all, so only **Summary** is offered and
the panel explains where the connection fields live. HTTP has no Advanced
settings, and a gRPC Server has none either because the endpoint header applies
to client mode only.

Sections use `tablist`, `tab`, and `tabpanel` semantics with a roving tab stop:
only the selected tab is in the tab order, `←`, `→`, `↑`, and `↓` move between
sections, and `Home` and `End` jump to the first and last section.

## Editing model

Edits apply live to the underlying controls, so **Connect** always uses what is
on screen. The dialog records a snapshot of every value it opened with, which
gives the footer three explicit choices:

| Footer action | Effect |
|---|---|
| **Done** | Closes the dialog and keeps every edit. Nothing connects. |
| **Revert changes** | Restores the values the dialog opened with, including the preset state, and leaves the dialog open. Enabled only while something differs from the snapshot. |
| **Reset to preset** | Re-applies the preset the fields started from. Enabled only when the preset state is **Custom (modified)**. |

`Esc` and the close control behave exactly like **Done**: the dialog closes,
the edits are kept, and focus returns to the control that opened it.

Editing a populated field inside the dialog switches the preset display to
**Custom (modified)**, exactly as editing an inline field does. Applying a
preset while the dialog is closed still fills every field, updates the title,
subtitle, and chip, and never opens the dialog. When a preset turns on an
explicit certificate bypass, the dialog pre-selects **Security** so the
warning-valued setting is the first thing shown the next time it opens. See
[Connection presets](connection-presets.md).

## Read-only states

| State | Behavior |
|---|---|
| Disconnected or error | Everything is editable. |
| Connecting or disconnecting | Every control is disabled and a banner explains why. The shared preset, connection type, host, and port are locked with it, so a connection cannot be re-pointed while it is being made. Sections stay navigable. |
| Connected | The dialog opens directly in read-only summary mode with only the **Summary** section offered. |

The read-only banner reads `Connected. Disconnect to change these settings.`
while connected and `Connecting. Disconnect to change these settings.` while a
connection is being established.

Locking is applied by querying the dialog rather than by listing controls, so
every protocol control is locked — including the HTTP, WebSocket, and gRPC
fields that were previously left editable during a live connection. The two
XMPP server actions are the deliberate exception: **Copy Client Settings** and
**Include password** stay available exactly while an XMPP Server is connected,
because the settings they copy only exist once the server is listening. See
[XMPP transport](xmpp.md).

## Validation

Validation failures are announced in an assertive banner at the top of the
dialog (`role="alert"`, `aria-live="assertive"`). A failed **Connect**:

1. opens the Protocol Settings dialog;
2. selects the section that owns the offending control;
3. moves focus to that control;
4. sets `aria-invalid="true"` and adds the banner id to `aria-describedby`
   without discarding the descriptions already there, so a hover tooltip and the
   banner can describe the control at the same time;
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

One generator, `src/connection-summary.js`, produces the summary shown on all
three surfaces, so they can never disagree:

| Surface | Shows | Opens |
|---|---|---|
| Inline summary card | The first three rows, warnings first, with **Show all** and **Copy**. | Below the connection row, in full view only; compact view hides it. |
| Status-bar summary button | `HTTP Server · https://127.0.0.1:8443/`, with a `⚠` mark when a warning applies. | In the status bar, left of the lines-sent counter. |
| Read-only Summary section | Every row, warnings first. | Inside the Protocol Settings dialog. |

None of these is hover-only. The card exposes real buttons, and the status-bar
entry is a button that opens the full summary when selected or when `Enter` is
pressed; hovering only previews the same line as a tooltip.

**Copy** places the summary on the clipboard as plain text. The copied text
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
| `format` | Format | HTTP, WebSocket. |
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

Warning rows are generated before every other row and repeated at the top of the
inline card, so a risky configuration cannot be scrolled past. An explicit
certificate-verification bypass always leads, because it applies to every host
rather than only to loopback. The card gains a red rule, the chip switches to
its warning style, and the status-bar entry turns red and gains a `⚠` mark. See
[TLS and SSL security](tls.md#explicit-certificate-verification-bypass).

## Keyboard

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Open Protocol Settings | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Open or focus the connection summary | `Cmd+Shift+I` | `Ctrl+Shift+I` |
| Move between sections | `←` `→` `↑` `↓` | `←` `→` `↑` `↓` |
| First or last section | `Home` / `End` | `Home` / `End` |
| Close and keep edits | `Escape` | `Escape` |

Both shortcuts work while a connection field has focus, and both reveal the
connection row first when it is hidden. Compact view hides the inline summary
card, so there `Cmd+Shift+I` / `Ctrl+Shift+I` opens the Summary section of
Protocol Settings directly and returns focus to the status-bar summary button
when the dialog closes.

## UI controls

| Control | Description |
|---|---|
| Protocol Settings… | Opens the dialog for the selected protocol. Carries the configured-state chip. |
| Basics, Security, Advanced, Summary | Section tabs. Only sections with content for the selected protocol and mode are offered. |
| Done | Closes the dialog and keeps the edits. |
| Revert changes | Restores the values the dialog opened with. |
| Reset to preset | Re-applies the preset the fields started from. |
| Close (✕) | Same as Done. |
| Show all | Opens the read-only Summary section. |
| Copy | Copies the summary as text, with secrets redacted. |
| Status-bar summary | Opens the read-only Summary section. |

## Tooltip reference

These strings match `src/index.html` and `src/renderer.js` exactly. The Protocol
Settings tooltip and the status-bar summary tooltip are rebuilt by
`renderConnectionSummary()` as the connection changes; the values below show
their structure.

| Element | Tooltip |
|---|---|
| Protocol Settings… | Protocol Settings (Cmd/Ctrl+Shift+P)<br>---<br>Open the &lt;mode&gt; settings: &lt;n&gt; of &lt;total&gt; changed from their defaults.<br>Preset, connection type, host, and port stay in this row. |
| Basics | Basics<br>The settings this protocol needs before it can send data. |
| Security | Security<br>TLS, certificate verification, and certificate paths for this protocol. |
| Advanced | Advanced<br>Optional settings that most connections leave at their defaults. |
| Summary | Summary<br>Every connection setting in one read-only list, with warnings first. Passwords are never shown. |
| Close (✕) | Close Protocol Settings and keep your edits (Esc) |
| Done | Keep your edits and close Protocol Settings. Nothing connects until you select Connect. |
| Revert changes | Restore the values this dialog opened with. Fields outside the dialog are untouched. |
| Reset to preset (available) | Restore every field of "&lt;preset label&gt;", the preset these settings started from. |
| Reset to preset (unavailable) | Restore every field of the preset these settings started from. Available only after a preset is applied and edited. |
| Show all | Show every connection setting, with warnings first, in a read-only summary. |
| Copy | Copy the connection summary as text. Passwords are never copied. |
| Status-bar summary | Connection summary<br>---<br>&lt;mode&gt; · &lt;headline&gt;<br>Select or press Enter to open the full read-only summary. Hovering only previews this line. |

## Related documentation

- [Connection presets](connection-presets.md)
- [Keyboard shortcuts](keyboard-shortcuts.md)
- [TLS and SSL security](tls.md)
- [XMPP transport](xmpp.md)
- [Developer guide](developer-guide.md)
