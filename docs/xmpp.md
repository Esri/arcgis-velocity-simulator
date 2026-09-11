# XMPP transport

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The ArcGIS Velocity Simulator supports focused XMPP client-to-server messaging
in both **Client** and **Server** roles. It publishes each replayed CSV line as
either a direct `chat` message or an XEP-0045 Multi-User Chat (`groupchat`)
message. The intended receivers are ArcGIS Velocity XMPP feeds and ArcGIS
GeoEvent Server XMPP connectors, and any standards-compliant XMPP server works.

This guide is written for users configuring an XMPP session and for developers
extending the transport. It covers defaults, roles, conversation types, STARTTLS
and certificates, accounts and JID rules, every user-interface control with its
exact tooltip text, the command-line parameters, security bounds, and the
limitations this focused implementation deliberately keeps. XMPP defaults to
**Client** when `protocol=xmpp` is selected; the application-wide default
remains TCP Server.

## Table of contents

- [Defaults](#defaults)
- [Roles](#roles)
- [Conversations](#conversations)
- [STARTTLS and certificates](#starttls-and-certificates)
- [Authentication and normalization](#authentication-and-normalization)
- [Connection presets](#connection-presets)
- [Empty passwords](#empty-passwords)
- [SASL mechanisms](#sasl-mechanisms)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Minimal local UX test with Logger](#minimal-local-ux-test-with-logger)
- [CLI and headless mode](#cli-and-headless-mode)
- [Status and logging](#status-and-logging)
- [XEP support and focused-server limitations](#xep-support-and-focused-server-limitations)
- [Dependency note](#dependency-note)
- [Tests](#tests)
- [Security bounds](#security-bounds)
- [Error handling and message delivery](#error-handling-and-message-delivery)
- [Troubleshooting](#troubleshooting)
- [Scope and design intent](#scope-and-design-intent)
- [Related documentation](#related-documentation)

## Defaults

| Setting | Default |
|---|---|
| Role | Client |
| Port | 5222 |
| Domain | `localhost` |
| STARTTLS | Required |
| Conversation | Direct |
| Resource | `velocity-simulator` |
| Room nickname | `velocity-simulator` |
| Connect timeout (`xmppConnectTimeoutMs`) | 30,000 ms |
| Reply timeout (`xmppReplyTimeoutMs`) | 15,000 ms |
| Keepalive ping (`xmppPingIntervalMs`) | 60,000 ms |
| Reconnect delay (`xmppReconnectDelayMs`) | 60,000 ms |
| Maximum destinations | 20 unique bare JIDs |
| Maximum body | 65,536 UTF-8 bytes |

Every timing is a **positive integer** count of milliseconds. Zero is rejected
in the UI, on the command line, and in a launch-config file: it does not disable
the keepalive, it does not disable the automatic reconnect, and it does not wait
forever. A run that cannot make progress fails at a deadline instead of hanging.

The network host is the shared top-level `ip` option. There is no `xmppHost` key
anywhere in the app: `ip` is the address the client dials or the server binds,
and `xmppDomain` is the XMPP domain served or authenticated against. Selecting
XMPP resolves the role to Client and the port to 5222 when neither is given
explicitly; the application-wide defaults stay TCP Server on port 5565.

## Roles

### Client

The Simulator connects to the `ip` host and port, authenticates against the
separately configured `xmppDomain`, binds a resource, and sends data to one or
more direct destinations or one room. A username may be a local part or a bare
JID; a bare JID supplies the domain. Password whitespace is significant and is
preserved exactly.

A dropped stream is retried automatically after `xmppReconnectDelayMs` (60,000
ms by default), replacing the one-second retry the underlying xmpp.js stack
would otherwise use. A reconnect performs a full bind and room rejoin. Automatic
reconnect cannot be switched off.

### Server

The in-process server exposes a focused C2S endpoint. It has exactly two
possible identities:

- an internal `velocity-simulator@domain` service identity used to publish data; its random password stays in memory;
- one required external account configured for the receiving product.

The external account name is compared canonically against the reserved
application identity — trimmed, lowercased, local part only — so
`Velocity-Simulator`, `VELOCITY-SIMULATOR@example.com` and ` velocity-simulator
` are all refused before the server binds.

The server binds loopback by default. `xmppAllowRemote=true` is required for a
non-loopback bind. It has no registration, administration, persistence, or
federation surface.

## Conversations

### Direct

- Destinations must be bare JIDs (`user@domain`) with no resource.
- Entries are trimmed, case-canonicalized, deduplicated, and capped at 20 unique values.
- The client sends only `type=chat`, and inbound direct traffic is filtered to `type=chat` in both roles. A `normal`, `headline` or untyped message is never surfaced as replay data: the built-in server answers it with `<bad-request/>`, and the client simply does not report it, so an unrelated server notice can never look like traffic from the receiver.
- Server role sends to every bound external stream unless destinations restrict the list.
- A bare destination routes to the most recently bound resource. A full destination used internally routes to that exact resource.
- Missing recipients receive a stanza error; messages are never stored offline.

### Room (MUC)

- A bare room name such as `traffic` becomes `traffic@conference.<domain>`.
- The client requests `<history maxstanzas="0"/>`; the built-in room stores and replays no history.
- A room may have one optional password. Password whitespace is significant.
- Broadcasts include the sender. The occupant JID identifies the self echo, surfaced as `selfEcho: true`.
- First creation reports MUC status `201`; the joining client also receives status `110`.
- Disconnect removes occupancy. Automatic client reconnect performs a full bind and room rejoin.

## STARTTLS and certificates

| Policy | Client behavior | Built-in server behavior |
|---|---|---|
| Required | Aborts before SASL when STARTTLS is unavailable. | Advertises `<required/>`; rejects SASL before TLS |
| Preferred | Upgrades when offered; otherwise authenticates with SCRAM-SHA-1 over plaintext and reports the actual plaintext state. | Advertises STARTTLS and SCRAM-SHA-1 together |
| Disabled | Does not require encryption. | Does not advertise STARTTLS |

Under Required the client aborts **before SASL**: when the peer's stream
features do not offer STARTTLS, no `<auth/>` element is sent, so no credential
ever reaches the wire. The error names the pre-SASL abort so the cause is
unambiguous.

Client trust uses the OS certificate store by default. `xmppTlsCaPath` adds a
custom PEM CA. `xmppAllowUnverifiedTls=true` explicitly bypasses certificate
verification. **The bypass applies to any host, not only localhost.** STARTTLS
still encrypts the stream, but the server identity is not checked, so the
control is styled as a warning and is off by default. Nothing enables it
silently: the only automatic use is the **Local XMPP — Logger Server / Simulator
Client** connection preset, where the checkbox is visibly turned on after the
preset is applied. See
[TLS and SSL security](tls.md#explicit-certificate-verification-bypass) and
[Connection presets](connection-presets.md).

Server role accepts a matching PEM certificate/key path pair. When both are
omitted and TLS is enabled, the Simulator generates an in-memory self-signed
certificate. Inline and path certificate/key sources are each pair-validated —
including blank and whitespace-only paths — so an incomplete or mixed source
fails with an actionable error instead of silently falling back.

Every TLS report is per connection, never a restatement of a capability. Under
Preferred the server advertises STARTTLS, so its listen summary reads `tls=on, …
(offered; each stream reports its own state)`; a stream that never upgraded is
still reported as unencrypted in the inbound data metadata and in the
`authenticated` and `room` lifecycle details. The client side behaves the same
way: Preferred does not display TLS as active after a plaintext fallback.

See [TLS and SSL security](tls.md) for the shared certificate and badge model.

## Authentication and normalization

The server supports SASL PLAIN after TLS and SCRAM-SHA-1. It charges the
per-address authentication rate limit before SCRAM PBKDF2 work and does not
replace an active SASL exchange with a second `<auth/>`. Unknown accounts follow
a normal SCRAM challenge path so account existence is not disclosed.

Domains, account names, and bare JIDs are canonicalized to lowercase. This
prevents mixed-case delivery drops and prevents an external account from
shadowing the reserved service identity. Resource parts and room nicknames
remain distinct values.

Passwords and room passwords are never trimmed, logged, included in status
metadata, or written to completion files. Whitespace is part of the secret on
every path into the app — the UI password fields, the `xmppPassword` /
`xmppExternalPassword` / `xmppRoomPassword` command-line parameters, and
launch-config JSON — so `" secret "` authenticates as `" secret "` and never as
`"secret"`. CLI `explain` redacts them. Treat any launch-config file that
carries one as a secret.

The external account name is canonicalized the same way the account store
canonicalizes the reserved `velocity-simulator` identity, so a mixed-case name,
a padded name, or a name carrying a domain suffix cannot shadow the identity the
Simulator publishes as. The collision is reported by the command line, by the
transport factory, and by the account store.

## Connection presets

Two of the twelve shared connection presets configure XMPP for a paired local
test with the ArcGIS Velocity Logger:

| Preset | Simulator role | Values |
|--------|----------------|--------|
| Local XMPP — Logger Server / Simulator Client | XMPP Client | `127.0.0.1:5222`, domain `localhost`, Direct, Required STARTTLS, username `simulator`, empty password, resource `velocity-simulator`, destination `velocity-logger@localhost`, Allow unverified on. |
| Local XMPP — Simulator Server / Logger Client | XMPP Server | `127.0.0.1:5222`, domain `localhost`, Direct, Required STARTTLS, external account `velocity-logger`, empty external password, empty destination so every signed-in stream receives each line, Allow remote off. |

A preset only pre-fills editable fields: it never connects, starts playback,
selects a file, saves a secret, or changes startup defaults. The XMPP client
preset is the only place where **Allow unverified** is turned on automatically,
because the paired Logger presents an ephemeral self-signed certificate. See
[Connection presets](connection-presets.md).

The XMPP options live in Protocol Settings, grouped into three
sections: **Basics** holds the conversation, domain, account, destination, and
room fields; **Security** holds the STARTTLS policy, certificate paths, **Allow
unverified**, and **Allow remote**; **Advanced** holds the timing values.
Validation opens Protocol Settings on the section holding the offending control,
reveals and focuses it, and names the problem in an assertive banner as well as
in the status log.

## Empty passwords

An XMPP password may be **present but empty** in every path: the UI, the
command line, launch configuration, the transports, the client core, the account
store, and the `XMPP_EXTERNAL_USERNAME` / `XMPP_EXTERNAL_PASSWORD` environment
account. This keeps a local Simulator/Logger pairing free of a shared secret.

- Both SASL mechanisms accept an empty password: **PLAIN** (RFC 4616) and
  **SCRAM-SHA-1** (RFC 5802).
- A **missing** password is still an error. `xmppPassword=` supplies an empty
  string; omitting the parameter in a mode that needs it does not.
- Usernames, JIDs, domain, destination, room, and nickname remain required.
- Password whitespace is preserved exactly. A password of `" exact "` keeps both
  spaces; only usernames and other identifiers are trimmed.

```bash
npm start -- protocol=xmpp mode=server xmppExternalUsername=velocity-logger xmppExternalPassword=
npm start -- protocol=xmpp mode=client xmppUsername=simulator xmppPassword= xmppDestination=velocity-logger@localhost
```

## SASL mechanisms

The Simulator negotiates SASL as follows:

| Stream | Mechanism |
|--------|-----------|
| Secure (STARTTLS established) | The server's preferred mechanism, normally SCRAM-SHA-1. PLAIN is available. |
| Unsecure, TLS policy `required` or `preferred` | A non-PLAIN mechanism only. The connection fails rather than sending a password in the clear. |
| Unsecure, TLS policy `disabled` | A non-PLAIN mechanism when one is offered; otherwise PLAIN, because the unsecure stream was chosen deliberately. |

Server mode mirrors this: it offers PLAIN on a secure stream, or on an unsecure
stream only when its TLS policy is `disabled`, and it rejects PLAIN in every
other unsecure case.

The client SCRAM-SHA-1 mechanism lives in `src/xmpp-scram.js` and shares its key
derivation with the in-process server mechanism, so both sides of a local
pairing always agree. It replaces the bundled WebCrypto implementation, which
rejects the zero-length HMAC key produced by an empty password.

## UI controls

When XMPP is selected in the **Mode** dropdown, an **XMPP Settings…** button
appears in the compact **Setup** toolbar. It opens Protocol Settings,
which holds every XMPP-specific control, and it carries a concise configured
state, such as `Defaults` or `2 changed`. Connection warnings remain visible
beneath the toolbar. Open Settings
with the button or with `Cmd+Shift+P` on macOS and `Ctrl+Shift+P` on Windows
and Linux. Its
layout, sections, and the Done, Revert changes, and Reset to preset actions
are described in
[Protocol settings and presets](connection-presets.md#the-protocol-settings-window).

Host, port, and the connection mode stay in the panel, because they apply to
every protocol. Inside Protocol Settings, role-, conversation-, and
TLS-specific controls remain hidden until they apply. Text fields and selects
are left aligned.

| Control | Applies to | Purpose |
|---|---|---|
| Conversation | Both | Select Direct or Room (MUC). |
| Domain | Both | XMPP domain, independent of host override. |
| STARTTLS | Both | Required, Preferred, or Disabled. |
| CA cert | Client with TLS | Custom PEM trust anchor. In **Security**. |
| Allow unverified | Client with TLS | Explicit certificate-verification bypass for any host. Warning-styled and off by default. In **Security**. |
| TLS cert / TLS key | Server with TLS | Matching server certificate and private key; omit both for automatic self-signed. In **Security**. |
| Allow remote | Server | Permit non-loopback binding. In **Security**. |
| Username / Password / Resource | Client | Sign-in identity, secret, and bind resource. The password may be present but empty. |
| Account / Acct pwd | Server | Single external account. The account password may be present but empty. |
| Destination | Direct | Up to 20 bare destination JIDs; optional in server role. |
| Room / Nickname / Room pwd | MUC | Room identity, occupant nickname, and optional room password. |
| Preset | Both | Pre-fills a paired local Simulator and Logger test. Defaults to Custom. Shown above Mode, in the panel rather than Protocol Settings. |
| Timeouts ms | Both | Connect (30000) and reply (15000) deadlines. In **Advanced**. Positive whole milliseconds only; there is no wait-forever value. |
| Ping ms | Client | XEP-0199 keepalive interval (60000). In **Advanced**. Positive whole milliseconds only; the keepalive cannot be switched off. |
| Reconnect ms | Client | Delay before the automatic reconnect after a dropped stream (60000). In **Advanced**. Positive whole milliseconds only; automatic reconnect cannot be switched off. |
| Copy Client Settings | Server | Copy receiver settings as canonical `option=value` lines. Password is withheld unless Include password is checked. Stays available while the server is connected, when every other dialog control is read-only. |

Every numeric timing input has `min="1"`. A blank, zero, or negative entry falls
back to the canonical default rather than being sent to the transport, and the
transport rejects a non-positive timing outright.

### Copy Client Settings

The copied block uses the Simulator's canonical option names so it can be pasted
straight into a command line or a launch-config `connection` section:

```bash
# ArcGIS Velocity Simulator — XMPP client settings
ip=127.0.0.1
port=5222
protocol=xmpp
mode=client
xmppDomain=localhost
xmppTlsPolicy=required
xmppAllowUnverifiedTls=false
xmppUsername=receiver
# xmppPassword=<not copied — enable "Include password" to copy it>
xmppResource=velocity-simulator
xmppConversation=direct
xmppDestination=velocity-simulator@localhost
xmppConnectTimeoutMs=30000
xmppReplyTimeoutMs=15000
xmppPingIntervalMs=60000
xmppReconnectDelayMs=60000
```

The host is emitted as `ip`, never as `host` or `xmppHost`. In Room (MUC) mode
the destination line is replaced by `xmppRoom` and `xmppNickname`. The account
password line is a comment unless **Include password** is checked, so the
clipboard never carries a credential by accident.

## Tooltip reference

Dynamic select tooltips are the exact strings from `renderer.js`:

- **Conversation — Direct:** `XMPP Conversation: Direct. Each replayed line is delivered as a one-to-one chat message to every destination JID, up to 20 of them.`
- **Conversation — Room (MUC):** `XMPP Conversation: Room (MUC). Each replayed line is broadcast as an XEP-0045 groupchat message into the room. Every occupant receives it, and the room echoes the message back to the sender.`
- **STARTTLS — Required:** `XMPP STARTTLS: Required. The stream must be upgraded to TLS before any credential is sent. The built-in server advertises STARTTLS as mandatory and refuses plaintext authentication.`
- **STARTTLS — Preferred:** `XMPP STARTTLS: Preferred. The stream is upgraded to TLS when the peer offers it, but authentication still proceeds on a plaintext stream when it does not.`
- **STARTTLS — Disabled:** `XMPP STARTTLS: Disabled. Encryption is not required and the built-in server stops advertising STARTTLS. As a client the Simulator still accepts an upgrade a third-party server insists on, so Disabled means 'do not require TLS', not 'refuse TLS'.`

Static control tooltips are the exact strings from `index.html` (line breaks are
shown as spaces):

- **Domain:** `XMPP domain. Client: the domain your account belongs to, for example example.com. It can differ from the host in the Connection row, so you can connect to an IP address while authenticating against the real domain. Server: the domain served to clients. Rooms live under conference.<domain>.`
- **CA cert:** `Path to a custom CA certificate file (PEM) used to verify the XMPP server certificate. Leave empty to use the OS certificate store. Only needed for enterprise or self-signed CAs that are not in the system trust store.`
- **TLS cert:** `Path to the server certificate file (PEM) presented during STARTTLS. Leave empty to let the app generate an automatic self-signed certificate for local testing. Requires a matching private key.`
- **TLS key:** `Path to the private key file (PEM) that matches the XMPP server certificate. Required whenever a certificate path is set. Leave empty to use the automatic self-signed certificate.`
- **Allow unverified:** `Warning: accept any XMPP server certificate --- Certificate verification is disabled for every host, not only localhost. STARTTLS still encrypts the stream, but the server identity is not checked. Use only for local self-signed testing.`
- **XMPP Settings…:** `Open XMPP settings (Cmd+Shift+P / Ctrl+Shift+P). --- Everything specific to XMPP is edited in the dialog: conversation, domain, account, destinations, STARTTLS, and timings. Configured: <state>. Nothing is sent until you select Connect.`
- **Basics tab:** `Basics: the settings that decide what is sent and where it is delivered.`
- **Security tab:** `Security: TLS, certificates, certificate verification, and who may connect.`
- **Advanced tab:** `Advanced: the settings most connections can leave at their defaults.`
- **Preset:** `Pre-fills the connection fields for a paired local Simulator and Logger test.`
- **Allow remote:** `Allow remote clients to reach the built-in XMPP server. Left off, the server binds a loopback address only, so nothing outside this machine can sign in. Turn it on to bind an address such as 0.0.0.0 and accept connections from the network.`
- **Username:** `Account used to sign in. Enter either a local part such as simulator, or a full bare JID such as simulator@example.com. A bare JID overrides the Domain field, so a copied JID can be pasted straight in.`
- **Password:** `Password for the XMPP account. Held in memory for the lifetime of the connection and never written to status or log files. Launch configuration export includes it so automation can round-trip; protect that JSON file as a secret.`
- **Reconnect ms label:** `Delay before an automatic reconnect, in milliseconds.`
- **Resource:** `Resource part requested at bind time, which distinguishes this stream from other sessions of the same account. The server assigns a random resource when this is left empty.`
- **Account:** `Username of the required external account the built-in XMPP server accepts. The simulator's own application identity is created automatically and is always available. Give this account to the receiver you want to sign in, for example an ArcGIS Velocity XMPP feed.`
- **Acct pwd:** `Password for the required external account the built-in XMPP server accepts. Held in memory for the lifetime of the server and never written to status or log files. Launch configuration export includes it so automation can round-trip; protect that JSON file as a secret.`
- **Destination:** `Bare destination JIDs that receive each replayed line. Use user@domain form with no resource part. Separate up to 20 destinations with commas. In server mode, leave this empty to publish to every signed-in account.`
- **Room:** `Multi-User Chat room to publish into. Enter a bare room name such as traffic, which is qualified with the conversation sub-domain of the Domain field. A full room JID such as traffic@conference.example.com is also accepted.`
- **Nickname:** `Nickname used inside the Multi-User Chat room. Occupants see messages as room@conference.domain/nickname. It must not contain '/' or '@'. The room refuses entry when the nickname is already taken.`
- **Room pwd:** `Password required to enter the Multi-User Chat room. In server mode this also protects the room against every other occupant. Leave empty for an open room. It is never logged. Launch configuration export includes it so automation can round-trip; protect that JSON file as a secret.`
- **Connect timeout:** `Connect timeout, in milliseconds. How long to wait for the stream to negotiate, authenticate and bind a resource before the attempt fails. Default is 30000. Must be a positive whole number; there is no wait-forever value.`
- **Reply timeout:** `Reply timeout, in milliseconds. How long to wait for a reply to a request that expects one, such as a room entry confirmation or a ping result. Default is 15000. Must be a positive whole number; there is no wait-forever value.`
- **Ping ms:** `Keepalive ping interval, in milliseconds. Sends an XEP-0199 ping on an otherwise idle stream so an intermediate firewall does not drop it. Default is 60000. Must be a positive whole number; the keepalive cannot be switched off.`
- **Reconnect ms:** `Automatic reconnect delay, in milliseconds. How long to wait after a dropped stream before signing in again. A reconnect re-binds the resource and re-joins the room; stream resumption is not implemented, so nothing sent while offline is replayed. Default is 60000. Must be a positive whole number; automatic reconnect cannot be switched off.`
- **Copy Client Settings:** `Copy the settings a receiver needs to sign in to this server. Copies canonical option=value lines: ip, port, xmppDomain, xmppTlsPolicy, xmppAllowUnverifiedTls, the account, the destination or room, and the connect, reply, ping and reconnect timings. The account password is left out unless 'Include password' is checked.`
- **Include password:** `Include the external account password in the copied settings. Off by default so a credential is never placed on the clipboard by accident. Turn it on only when you are pasting into a trusted destination.`

## Minimal local UX test with Logger

This setup exercises both applications with the fewest explicit settings. It
keeps the Logger in its default XMPP Server role and the Simulator in its
default XMPP Client role. Port `5222`, domain `localhost`, Direct conversation,
and Required STARTTLS use their XMPP defaults, and both passwords are left
intentionally empty.

In the user interface, select the preset **Local XMPP — Logger Server /
Simulator Client** in the Logger and the entry with the same name in the
Simulator, then select **Connect** in the Logger and **Connect** and **Play** in
the Simulator.

The equivalent command line starts the Logger first, in one terminal:

```bash
npm start -- protocol=xmpp mode=server ip=127.0.0.1 xmppExternalUsername=simulator xmppExternalPassword=
```

Start the Simulator in a second terminal:

```bash
npm start -- filename=/Users/hano4470/Backup/data/faa.csv protocol=xmpp mode=client ip=127.0.0.1 xmppUsername=simulator xmppPassword= xmppDestination=velocity-logger@localhost xmppAllowUnverifiedTls=true
```

In the Logger, select **Connect**. Then select **Connect** and **Play** in the
Simulator. `xmppAllowUnverifiedTls=true` is an explicit opt-in that allows the
Simulator to accept the Logger's automatic self-signed certificate while
STARTTLS still encrypts the stream. The bypass applies to any host the
Simulator connects to, so leave it off outside local testing.

## CLI and headless mode

Use `name=value` syntax. XMPP-specific keys are:

`xmppDomain`, `xmppTlsPolicy`, `xmppTlsCaPath`, `xmppTlsCertPath`,
`xmppTlsKeyPath`, `xmppAllowUnverifiedTls`, `xmppAllowRemote`, `xmppUsername`,
`xmppPassword`, `xmppResource`, `xmppExternalUsername`, `xmppExternalPassword`,
`xmppConversation`, `xmppDestination`, `xmppRoom`, `xmppNickname`,
`xmppRoomPassword`, `xmppConnectTimeoutMs`, `xmppReplyTimeoutMs`,
`xmppPingIntervalMs`, and `xmppReconnectDelayMs`.

The host is the shared top-level `ip` parameter, which is why no `xmppHost` key
exists. `mode`, `port`, `filename` and every other shared parameter behave
exactly as they do for the other transports.

Client mode requires `xmppUsername`; server mode requires
`xmppExternalUsername`. The matching password parameter must be present, but it
may be empty (`xmppPassword=` or `xmppExternalPassword=`). See
[Empty passwords](#empty-passwords).

Client example:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp ip=xmpp.example.com xmppDomain=example.com xmppUsername=simulator xmppPassword=change-me xmppDestination=receiver@example.com
```

Loopback server example:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp mode=server ip=127.0.0.1 xmppExternalUsername=receiver xmppExternalPassword=change-me waitForClient=true
```

Explicit timings, including the reconnect delay:

```bash
npm run start:headless -- filename=./data.csv protocol=xmpp ip=127.0.0.1 xmppUsername=simulator xmppPassword=change-me xmppDestination=feed@example.com xmppConnectTimeoutMs=30000 xmppReplyTimeoutMs=15000 xmppPingIntervalMs=60000 xmppReconnectDelayMs=60000
```

`waitForClient=true` in server role holds the replay cursor until a bound direct
recipient or external room occupant exists. Disconnect rejects recipient
waiters. Client connect timeout cleanup disables reconnect and closes pending
sockets before returning.

The transport is registered with the transport manager before its connect is
awaited, so a connect that fails part-way — a refused STARTTLS upgrade, a
rejected credential, a room that refuses the nickname — is torn down before the
failure is reported and before the done file is written.

All four samples in `docs/examples/` contain every XMPP mapping. Command-line
values override launch configuration values. See [Command-line
reference](command-line.md), [Headless mode](headless.md), and
[Configuration](configuration.md).

## Status and logging

The transport emits structured `[XMPP]` logs for connect/listen, TLS upgrade,
authentication outcome, binding, room lifecycle, send outcome, disconnect, and
errors. Passwords, room passwords, SASL payloads, and authorization material are
never logged.

Lifecycle callbacks expose Connecting, Signed in/Ready, In room,
Offline/Reconnecting, and Disconnected states. Their metadata carries the actual
per-connection TLS state and the resolved timings, so the Offline state names
the exact delay before the next reconnect attempt (`XMPP stream is offline; an
automatic reconnect is pending in 60000ms.`) and the Ready state reports
`xmppConnectTimeoutMs`, `xmppReplyTimeoutMs`, `xmppPingIntervalMs` and
`xmppReconnectDelayMs`. The TLS badge distinguishes TLS off, automatic
self-signed, explicit verification bypass, custom CA, and OS trust.

## XEP support and focused-server limitations

Implemented and tested:

- RFC 6120 stream negotiation, STARTTLS, SASL, binding, and clean close;
- RFC 6121 direct `chat` bodies;
- XEP-0045 focused MUC join, leave, nickname, password, status `110`/`201`, groupchat, and self echo;
- XEP-0199 ping;
- XEP-0198 enable and acknowledgement counters.

XEP-0198 support is **acknowledgement-only**:

- `<enable/>` receives `<enabled resume="false"/>`;
- `<r/>` receives `<a h="N"/>`;
- resumption is not implemented;
- unacknowledged stanzas are not queued or replayed;
- acknowledgement counters never drive retransmission;
- an automatic reconnect after `xmppReconnectDelayMs` is therefore a brand new session, and nothing published while the stream was down is replayed to the receiver.

The built-in server intentionally does not provide server-to-server federation,
roster or presence subscriptions, service discovery, offline storage,
archive/history, receipts, carbons, typing notifications, registration, password
changes, administration, clustering, persistence, anonymous SASL, certificate
authentication, SASL2/FAST/Bind2, SCRAM channel binding, moderated/configurable
rooms, affiliations, invitations, room-private messages, or MUC history.

Real XMPP servers may require additional roster/presence behavior or apply their
own room policies. The client requests no MUC history but does not claim support
for those broader features.

## Dependency note

The client uses `@xmpp/client` 0.14. Per-connection STARTTLS options are scoped
through `AsyncLocalStorage` and a narrow `@xmpp/tls` socket augmentation because
that release does not expose CA options on its STARTTLS call. Node's global
`tls.connect` is never replaced. Revalidate this integration whenever `@xmpp/*`
packages are upgraded.

Four packages are declared as runtime `dependencies`, not devDependencies,
because the shipped app uses them:

| Package | Version | Why |
|---------|---------|-----|
| [`@xmpp/client`](https://github.com/xmppjs/xmpp.js) | `^0.14.0` | The maintained reference XMPP client used for the client role. |
| `@xmpp/xml` | `^0.14.0` | ltx-based streaming XML parser/builder used by the built-in server. |
| `@xmpp/jid` | `^0.14.0` | JID parsing and normalization. |
| `@xmpp/tls` | `^0.14.0` | Declared directly because `xmpp-client-core.js` augments `@xmpp/tls/lib/Socket.js` to inject per-client STARTTLS options. |

No XMPP server library is embedded and no sidecar process is spawned. TLS
material is produced by the repository's existing `src/tls-utils.js`.
`@xmpp/client` 0.14 is ESM-only and is loaded through Node's `require(esm)`
support; the packaged Electron runtime is verified with `ELECTRON_RUN_AS_NODE=1
./node_modules/.bin/electron -e "require('./src/xmpp-transport.js')"` whenever
the dependency is upgraded.

## Tests

```bash
npm run test:xmpp             # protocol core: streams, STARTTLS, SASL, binding, MUC, bounds
npm run test:xmpp-transport   # transport facade, both roles, option validation, limits
npm run test:xmpp-secrets     # secret-disclosure guarantees
npm run test:xmpp-parity      # option vocabulary, defaults, Simulator/Logger parity
npm test                      # everything
npm run docs:check-links      # documentation link check
```

All XMPP suites are self-contained and deterministic: they start servers on
ephemeral loopback ports, generate their own certificates in memory, and need no
network access, no external XMPP server, and no fixtures. Together they cover
both roles, Direct and MUC, every TLS policy, self-signed and custom trust, the
pre-SASL Required failure, Preferred plaintext metadata, auth limiting, case
normalization, whitespace secrets, certificate pairing, UTF-8 framing and
limits, reconnect and cleanup, headless execution, the UI/help/CLI/config
mappings, and secret disclosure.

Regression coverage for the hardening rules above:

| Rule | Where it is proven |
|------|--------------------|
| Required aborts before SASL and sends no credential | `xmpp-core.test.js` (counts `<auth/>` elements reaching the server) and `xmpp-transport.test.js` |
| Canonical account collision | `xmpp-core.test.js`, `xmpp-transport.test.js`, `cli-options.test.js` |
| Direct inbound is chat-only | `xmpp-core.test.js` (both the server refusal and the client filter) |
| Per-connection TLS metadata under Preferred | `xmpp-transport.test.js` (a raw plaintext SCRAM sign-in against a TLS-capable server) |
| Certificate/key pair validation | `xmpp-core.test.js`, `xmpp-transport.test.js`, `cli-options.test.js` |
| Cleanup registration before connect | `xmpp-transport.test.js`, `headless-runner.test.js` |
| Untrimmed password parsing | `xmpp-transport.test.js`, `cli-options.test.js`, `config.test.js` |
| Positive-only timings and the reconnect delay | `xmpp-core.test.js`, `xmpp-transport.test.js`, `cli-options.test.js`, `renderer.test.js`, `help.test.js` |

## Security bounds

| Bound | Default | Behavior |
|-------|---------|----------|
| Message body cap | 65,536 UTF-8 bytes | Longer bodies are **rejected** before they reach the wire, never truncated, so a replay never silently loses part of a line. |
| Destination cap | 20 bare JIDs | Enforced in the UI, the CLI, and the transport. Each line is delivered once per destination, so the cap keeps a single replay tick bounded. |
| Bare-JID enforcement | always on | Destination, account, and room JIDs must be `user@domain`; a resource part is rejected rather than stripped. |
| XML/stanza size cap | 512 KiB | Counted per socket chunk and re-measured per parsed stanza. Exceeding it ends the stream with `<policy-violation/>`. The cap exceeds the body cap so a maximal body still fits inside its XML-escaped envelope. |
| Restricted XML | always on | Any chunk containing `<!DOCTYPE` or `<!ENTITY` ends the stream with `<restricted-xml/>`, blocking entity-expansion attacks. |
| Per-address auth rate limiting | 10 attempts / 60 s | Each `<auth/>` is charged before SCRAM key derivation; only a successful exchange refunds its own charge. Further attempts receive `<temporary-auth-failure/>`. |
| Per-connection auth limit | 3 initiations | Further `<auth/>` initiations receive `<temporary-auth-failure/>`; a second `<auth/>` ends the active exchange as malformed without deriving another challenge. |
| Loopback-safe binding | `127.0.0.1` | Binding a non-loopback host requires **Allow remote** / `xmppAllowRemote=true`. |
| TLS verification bypass | off | Requires **Skip cert check** / `xmppAllowUnverifiedTls=true` **and** a loopback host. |
| Secret logging | never | Passwords, room passwords, and SASL payloads never reach the status log, the log file, a done file, or `explain` output, which prints `<redacted:NB>` markers instead. |
| Secret persistence | never written | Saved launch configurations omit `xmppPassword`, `xmppExternalPassword`, and `xmppRoomPassword`. |
| Clipboard | password withheld | **Copy Client Settings** omits the account password unless **Include password** is checked, and emits canonical `option=value` lines keyed on `ip`, never `host` or `xmppHost`. |
| Pre-SASL TLS abort | Required policy | A client set to Required never sends an `<auth/>` element to a peer that does not offer STARTTLS, so a credential cannot leak to a downgraded server. |
| Reserved identity | canonical | The external account is compared to `velocity-simulator` after trimming, lowercasing, and stripping any domain, so no case or domain variation can shadow the application identity. |
| Inbound direct filtering | `type=chat` only | `normal`, `headline`, and untyped messages are refused (`<bad-request/>`) or ignored rather than replayed as data. |
| TLS reporting | per connection | Every reported security state is the state negotiated on that stream; a server's advertised STARTTLS capability is never reported as a connection's security. |
| Timing values | positive integers | Connect, reply, ping and reconnect timings are validated as positive integers everywhere, so a run cannot be configured to hang or to silently stop keeping its stream alive. |
| JID spoofing | prevented | The server stamps `from` on every routed stanza. |
| UTF-8 framing | safe | A `StringDecoder` per stream means a multi-byte code point split across TCP segments is never corrupted. |

### Credentials in launch-config files

`xmppPassword`, `xmppExternalPassword`, and `xmppRoomPassword` are **read** from
a launch-config file so automated runs can supply credentials from a secret
store, but they are **never written** when the app saves a launch configuration.
A launch-config file is plain JSON, so treat any file you add a password to as a
secret and keep it out of version control.

## Error handling and message delivery

Nothing is dropped without telling the sender:

| Situation | Response |
|-----------|----------|
| Direct message to an account with no signed-in resource. | `<message type='error'><service-unavailable/></message>` — there is no offline storage |
| `groupchat` from a stream that is not an occupant. | `<not-acceptable/>` per XEP-0045 §7.2.2 |
| `groupchat` addressed to a room that does not exist. | `<item-not-found/>` |
| Private message to a room occupant JID. | `<feature-not-implemented/>` |
| Unsupported `iq` `get`/`set`. | `<service-unavailable/>` |
| `iq` with a missing or unrecognised type. | `<bad-request/>` |
| `iq` of type `result` or `error`. | **Never answered** — RFC 6120 §8.3.1, so two peers cannot enter an error loop |
| Second resource bind on the same stream. | `<not-allowed/>`, leaving the existing binding and room occupancy untouched |

Room entry and in-room nickname changes are atomic: everything is validated
before anything is mutated, so a wrong room password, a taken nickname, or a
malformed room JID leaves the stream's existing occupancy exactly as it was. A
nickname change is announced to every occupant with status code `303` and
preserves the occupant's affiliation and role.

Traffic addressed to the automatic application identity is surfaced to the
transport as inbound data when that identity has no stream of its own, so a
receiver's replies reach the Simulator's status log.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| `STARTTLS is set to Required but … did not negotiate an encrypted stream` | The peer does not offer STARTTLS. Fix the server, or lower the policy to Preferred and accept an unencrypted stream. |
| `self-signed certificate` / `unable to verify the first certificate` | The server uses an automatic self-signed certificate. Supply it as **CA cert**, or tick **Skip cert check** when the host is loopback. |
| `TLS verification bypass is restricted to loopback hosts` | **Skip cert check** only applies to `127.0.0.0/8`, `::1`, or `localhost`. Supply a CA certificate for remote hosts. |
| `The XMPP server binds a loopback address unless …` | Tick **Allow remote** (or pass `xmppAllowRemote=true`) before binding `0.0.0.0` or a LAN address. |
| `not-authorized` when entering a room | The room password is wrong or missing. The stream stays in any room it already occupies. |
| `conflict` when entering a room | The nickname is taken. Choose a different **Nickname**. |
| `not-acceptable` on a groupchat message | The sender is not an occupant. Enter the room first. |
| `service-unavailable` on a direct message | The destination account has no signed-in resource. There is no offline storage. |
| `Message body is N UTF-8 bytes, which exceeds the 65536-byte XMPP limit` | A CSV line is too long. Split the line, or use a transport without this cap. |
| `'xmppPingIntervalMs' must be an integer of 1 millisecond or more` | A timing was set to `0`, a negative number, or a fraction. Every XMPP timing is a positive integer; there is no zero-disable or zero-wait-forever value. |
| `must differ from the reserved velocity-simulator identity` | The external account canonically matches the automatic application identity. Choose a different account name — case and a domain suffix do not make it different. |
| `Both an XMPP TLS certificate and its private key are required` | Only one half of the server TLS pair was supplied. Give both, or leave both empty for the automatic self-signed certificate. |
| `not-authorized` when signing in with a password that looks correct | Password whitespace is significant. Copy the value exactly, including any leading or trailing spaces. |
| Nothing arrives even though the run reports success | In Room mode a receiver only sees traffic published after it enters the room; there is no history. |

## Scope and design intent

XMPP support is deliberately focused. It covers the client-to-server surface an
ArcGIS Velocity XMPP feed or an ArcGIS GeoEvent Server XMPP connector needs to
receive replayed data, and nothing beyond it. The Simulator embeds no
third-party XMPP server and starts no sidecar process, so both roles stay small
enough to reason about and to test end to end on loopback.

The limitations recorded above are part of the contract rather than an
oversight. They are kept current instead of being softened, so a deployment that
needs federation, roster and presence subscriptions, offline storage, or message
archiving can be pointed at a full XMPP server while the Simulator continues to
publish into it.

## Related documentation

| Document | Purpose |
|----------|---------|
| [TLS and SSL security](tls.md) | Certificate types, trust stores, mutual TLS, and the TLS Trust Badge. |
| [Protocol settings and presets](connection-presets.md) | Protocol Settings, its sections, and the paired presets with empty XMPP passwords. |
| [Connection summary and protocol settings](connection-summary.md) | The read-only description of the current connection and its warnings. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Headless mode](headless.md) | No-UI replay sessions, parameters, and the completion artifact. |
| [Data formats](data-formats.md) | Shared input-versus-payload concepts for socket replay. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and the launch configuration samples. |
| [Developer guide](developer-guide.md) | Repository structure, local development, tests, debugging, and extension points. |
