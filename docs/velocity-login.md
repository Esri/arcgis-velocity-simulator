# ArcGIS Velocity sign-in and feed picker

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

The **Sign In to ArcGIS Velocity** toolbar button opens a dialog for Portal
authentication, feed browsing, and applying supported connection settings.
This guide covers the workflow, controls, tooltips, and credential storage
for users and integrators with an ArcGIS Online or ArcGIS Enterprise account
authorized to access Velocity.

## Table of contents

- [Workflow](#workflow)
- [Authentication](#authentication)
- [OAuth 2.0](#oauth-20)
- [Supported and unsupported feed types](#supported-and-unsupported-feed-types)
- [Feed type reference](#feed-type-reference)
- [Scope toggle](#scope-toggle)
- [Dialog size persistence](#dialog-size-persistence)
- [UI controls](#ui-controls)
- [Tooltip reference](#tooltip-reference)
- [Credential storage](#credential-storage)
- [Related documentation](#related-documentation)

## Workflow

To configure a supported receiver:

1. Click **Sign In to ArcGIS Velocity** in the toolbar;
2. enter your Portal URL (default: `https://velocitydemo.maps.arcgis.com`),
   username, and password;
3. leave **Velocity endpoint** on **Automatic**, or choose **Custom public
   URL** and enter the complete public API base. See
   [Choose the Velocity endpoint](velocity-rest-api.md#choose-the-velocity-endpoint);
4. click **Sign In** and review **Effective URL** and the status message;
5. use **Server** when multiple Velocity servers are available, or leave
   **All Velocity servers** selected to aggregate feeds. Use **Type** to filter
   feeds, then select a feed to retrieve its details;
6. while disconnected, click **Apply** to populate validated connection
   settings. This does not connect or start playback;
7. check the footer **Token On / Token Off** badge and review the settings;
8. click **Connect**, then **Play**.

Disconnect before using **Apply** or **Use Token Only**; both actions are
blocked while a transport is connecting or connected. Pending endpoint edits
disable feed application until **Apply URL** succeeds.
Changing **Portal URL** requires a new sign-in. A successful Portal sign-in
can still leave endpoint discovery or feed listing unavailable; the error
remains visible, and **Use Token Only** is available for a destination that
accepts that Portal token.

The picker shows each feed's source server, and the detail table shows the
server name and ID separately from the feed ID. Unavailable servers produce
an explicit partial-results warning without hiding feeds from healthy servers.

## Authentication

| Feed authentication | Behavior |
|---|---|
| ArcGIS token | Sends bearer authentication through a header or gRPC metadata on token-capable client transports. |
| Basic authentication | Disables token sending; Apply does not recover saved basic-auth credentials. |
| None | Disables token sending. |

### Token refresh

Tokens refresh at **80% of lifetime** and retry with exponential backoff on
failure. The footer auth badge shows whether a token is available and sent
with new gRPC, HTTP, and WebSocket client connections. Raw bearer tokens are
never shown; tooltips show safe metadata only.

### Token sending toggle

The dialog supports two usage modes:

1. **Use Token Only** signs in without changing the manually configured
   transport fields and defaults to **Token On**;
2. **Apply** selects a supported feed. ArcGIS, token, bearer, OAuth, and
   unspecified authentication on token-capable transports default to
   **Token On**. Basic, none, and unsupported authentication default to
   **Token Off**.

Click the footer badge to change token sending for new client connections.
Active gRPC and HTTP clients hot-swap refreshed tokens when possible.
WebSocket upgrade headers are fixed at connect time; reconnect after changing
the toggle. The TLS badge describes encryption and trust, not authentication.
See [TLS and SSL security](tls.md) for that separate surface.

## OAuth 2.0

The **OAuth 2.0** tab supports client-credentials flow using **Client ID** and
**Client Secret**. Portal and endpoint selection are shared with the password
tab. The application's permissions and the deployment determine which
resources its token can access. Signing in does not grant feed access or
change an unsupported source into a receiver.

## Supported and unsupported feed types

Unsupported types have a **⚠** prefix and muted styling. **Apply** is disabled
for these items. **Supported** is the default filter; **All** includes
unsupported types. A WebSocket feed connects outward to a source, so it is
paired with the Simulator's WebSocket Server role. A GET-based HTTP Poller is
paired with HTTP Server polling mode. TCP connector roles are inverted:
a Velocity server connector selects a Simulator client, while a Velocity
client connector selects a Simulator server with a safe local bind and separate
advertised endpoint metadata. UDP mapping requires the receiving contract:
passive feeds select Simulator UDP Client, and explicitly Registered feeds
select UDP Server in Registered mode. See
[Velocity feeds](udp.md#velocity-feeds) for routing and framing requirements.
If the list contains only unsupported sources, the status reports the actual
total and prompts you to choose **All** beside **Supported**; an empty
supported filter does not mean that the servers returned no feeds.

Missing or invalid advertised endpoint properties are errors, not a reason
to reuse the previous feed's fields. For endpoint mapping rules, see
[Apply connection settings](velocity-rest-api.md#apply-connection-settings).

## Feed type reference

Dropdowns and the detail panel identify each type with a geometric Unicode
icon and a color:

| Icon | Feed type | Color | Supported |
|---|---|---|---|
| ⬡ | `grpc` — gRPC | `#7c4dff` | Yes. |
| ■ | `http-receiver` — HTTP Receiver | `#0097a7` | Yes. |
| ↻ | `http-poller` — HTTP Poller | `#00838f` | Yes, for GET requests. |
| ◆ | `websocket` — WebSocket | `#00897b` | Yes, as a Simulator WebSocket Server. |
| ◎ | `mqtt` — MQTT | `#f57c00` | No. |
| ▲ | `kafka` — Kafka | `#e53935` | No. |
| ◗ | `tcp`, `tcp-client` — TCP client | `#546e7a` | Yes, as a Simulator TCP Server. |
| ◗ | `tcp-server` — TCP server | `#455a64` | Yes, as a Simulator TCP Client. |
| ◖ | `udp-client` — UDP Client (receiving feed) | `#78909c` | Requires explicit Direct or Registered contract metadata; otherwise configure manually. |
| ◖ | `udp-server` — UDP Server (receiving feed) | `#607d8b` | Yes, as a Simulator UDP Client with a valid advertised endpoint. |
| ❖ | `azure-event-hub` — Azure Event Hub | `#0078d4` | No. |
| ❖ | `azure-service-bus` — Azure Service Bus | `#0062ad` | No. |
| ◉ | `kinetic` — Kinetic | `#43a047` | No. |
| ▣ | `file` — File | `#8d6e63` | No. |
| ○ | Unknown type | `#888` | No. |

## Scope toggle

**My Feeds** lists feeds owned by the signed-in user. **ORG Feeds**, the
default, adds `view=admin` to request organization-wide feeds and requires
administrator privileges. Changing scope re-fetches the list. **Refresh**
requests the current scope without changing it.

## Dialog size persistence

The dialog opens at **590 × 840** pixels by default. Its size and position
are saved under `dialogSizes.velocityLogin` in App Config and restored on the
next open. Remove that key to restore the default bounds. See
[Configuration](configuration.md) for storage locations.

## UI controls

The shared **Portal URL**, expandable **Velocity endpoint**, and **Remember
me** controls sit outside both authentication forms. The endpoint section
contains **Automatic**, **Custom public URL**, **Public API URL**, **Detect
again**, and **Apply URL**. Read-only **Detected URL**, **Effective URL**, and
the endpoint status distinguish discovery from the active browsing endpoint.
With multiple registered servers, **Server** defaults to **All Velocity
servers**, and the section shows each server's URLs and status. Select one
server before editing its custom public URL. A single server retains the
simple endpoint editor without a server selector.
**Apply URL** is disabled in the aggregate view. **Detect again** remains a
Portal-wide preview and never resets individual servers' saved overrides.

Button foregrounds and backgrounds follow the selected theme, including
both operating-system appearances of **System**. Primary and selected
segmented controls use paired button colors rather than assuming white text
is readable on an accent. Disabled buttons retain readable text and use a
dashed border and unavailable cursor instead of dimming the entire control.
See the [REST API guide](velocity-rest-api.md#choose-the-velocity-endpoint)
for endpoint selection and validation.

The password form contains **Username**, **Password**, and its visibility
toggle. OAuth contains **Client ID**, **Client Secret**, and its visibility
toggle. Both use **Sign In**. The picker contains scope and supported-type
filters, **Refresh**, **Type**, **Feed**, and a read-only detail table.
**Apply** closes the dialog only after the main window accepts the settings;
errors keep it open. **Use Token Only** preserves manual connection fields,
and **Close** dismisses the dialog without applying a feed.

## Tooltip reference

Tooltips use the shared custom tooltip utility. These strings match the
controls exactly:

| Control | Tooltip |
|---|---|
| Toolbar sign-in | Sign In to ArcGIS Velocity: browse feeds and auto-configure connection |
| Password tab | Sign in with ArcGIS username and password |
| OAuth tab | Sign in with OAuth 2.0 client credentials; resource access depends on the application permissions |
| Portal URL | ArcGIS Enterprise or ArcGIS Online portal URL |
| Velocity endpoint | Choose the public Velocity API address used to browse resources |
| Server label and initial dropdown | Browse all Velocity servers or select one server to edit its public API URL |
| All Velocity servers option | Browse resources from all Velocity servers |
| Automatic | Use the public API address found through Portal discovery |
| Custom public URL | Use a complete public API base instead of the detected address |
| Public API URL | Complete HTTPS API base, including the public context and optional port; no resource suffix, credentials, query, or fragment |
| Detect again | Refresh discovery without changing the custom URL or active browsing endpoint |
| Apply URL | Validate and apply the endpoint selection with the current Portal session, then reload the list |
| Apply URL in aggregate view | Select one Velocity server before applying a public API URL |
| Username | ArcGIS account username |
| Password | ArcGIS account password (press Enter to sign in) |
| Show password | Show password |
| Hide password | Hide password |
| Client ID | OAuth 2.0 application Client ID |
| Client Secret | OAuth 2.0 application Client Secret (press Enter to sign in) |
| Show client secret | Show client secret |
| Hide client secret | Hide client secret |
| Remember me | Remember the Portal URL, username, server selection, and each server's endpoint preferences; never save passwords or tokens |
| Sign In | Authenticate and retrieve feeds from your Velocity organization |
| My Feeds | Show only feeds you own |
| ORG Feeds | Show all feeds in your organization (requires admin privileges) |
| Refresh | Refresh: re-request the list of feeds from Velocity |
| Supported | Show only feed types supported by the Simulator |
| All | Show all feed types, including those not yet supported by the Simulator |
| Type label and initial dropdown | Filter by feed type. Types marked with a warning are not yet supported by the Simulator. |
| Feed label and initial dropdown | Select a feed to view its details and apply connection settings. |
| All Types option | Show all feed types |
| Empty Feed option | Select a feed to view its details |
| Use Token Only | Use Velocity token for authentication only — keep your own connection settings in the main window |
| Apply | Apply the selected feed's connection settings to the main window. |
| Apply with pending endpoint edits | Apply the pending endpoint selection before applying a feed. |
| Apply with unsupported feed | Cannot apply - this feed type is not yet supported by the Simulator. |
| Close | Close this dialog |
| Status dismiss | Dismiss this message |

Dropdown tooltips follow the selected option. A supported type uses
`Show {type} feeds`; an unsupported type uses
`{type} - not yet supported by the Simulator`. Feed options use
`{label} - {type label} feed` or
`{label} - {type label} (not yet supported by the Simulator)`.
When the source is present, both end with ` — {server name}`. Server options
use `Browse resources from {server label} ({server ID})`. The detail-panel
type badge uses the type label.

The scope-group tooltip is:

```text
My feeds: show only feeds you own
ORG Feeds: show all feeds in your organization (requires admin privileges)
```

The supported-filter group tooltip is:

```text
Supported: show only feed types supported by the Simulator
All: show all feed types including unsupported ones
```

## Credential storage

With **Remember me**, the Portal URL, username, selected server scope, and
accepted endpoint preferences are stored in `velocity-credentials.json` in
the app's user data directory. Each custom URL belongs to a specific Portal
and registered server ID; it never becomes an override for every server on
that Portal. Changing the Portal or server never silently reuses another
server's custom URL. Passwords and tokens are not persisted.

With Remember me off, endpoint preferences remain session-only. Turning it
off removes saved preferences. Password and client-secret inputs are cleared
after a successful sign-in. Browsing requests use current main-process
session metadata, not a cached token in the dialog.

## Related documentation

| Document | Purpose |
|---|---|
| [ArcGIS Velocity REST API](velocity-rest-api.md) | Endpoint discovery, public contexts, resource paths, and data endpoints. |
| [Configuration](configuration.md) | App Config, Launch Config, and storage locations. |
| [Command-line reference](command-line.md) | Parameters, defaults, and examples. |
| [TLS and SSL security](tls.md) | Encryption, certificate trust, and the TLS badge. |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Keyboard shortcuts throughout the application. |
