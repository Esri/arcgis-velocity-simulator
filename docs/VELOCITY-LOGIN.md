# Velocity Login & Feed Picker

> **Audience:** Users, integrators  
> **Feature:** ArcGIS Velocity sign-in dialog, feed browser, and token-based authentication

## Overview

The **🔑 Sign In to ArcGIS Velocity** button in the toolbar opens a modal dialog that lets you authenticate against your ArcGIS portal, browse available Velocity feeds by type, preview feed details, and auto-populate the Simulator's connection settings with a single click.

## Workflow

1. Click **🔑** in the toolbar.
2. Enter your Portal URL (default: `https://velocitydemo.maps.arcgis.com`), username, and password.
3. Click **Sign In** — the dialog fetches your organization's Velocity feeds.
4. Use the **Type** dropdown to filter feeds (gRPC, HTTP Receiver, WebSocket, etc.).
5. Select a feed to view its details (URL, auth type, format, schema fields).
6. Click **Apply** — the main window auto-configures: connection mode, host, port, path, TLS, and format.
7. Check the footer **🔑 Token On / Token Off** badge. Click it to control whether the Velocity token is sent with new client connections.
8. Click **Connect** → **Play** as usual.

## Authentication

| Feed Auth Type | How the Simulator Authenticates |
|---|---|
| `arcgis` (token) | `Authorization: Bearer <token>` header/metadata — used for gRPC, HTTP, WebSocket |
| `basic` | `Authorization: Basic <base64(user:pass)>` header — used for HTTP Receiver feeds configured with basic auth |
| `none` | No authentication header is sent (TCP, UDP) |

### Token Refresh

- Tokens are refreshed proactively at **80% of their lifetime** (e.g., a 60-minute token refreshes at 48 minutes).
- On failure, retries with exponential backoff (1s, 2s, 4s… up to 5 attempts).
- The footer **🔑 Token On / ◇ Token Off** badge shows whether an authenticated token is available and whether it will be sent with new gRPC, HTTP, and WebSocket client connections.
- The app never displays the raw bearer token in the tooltip or status popover. The tooltip shows safe metadata only: selected feed, auth type, expiry time, and toggle action.

### Token Sending Toggle

The login dialog supports two usage modes:

1. **Use Token Only** — sign in and use the Velocity token with your own manually configured connection settings. The footer badge defaults to **🔑 Token On**.
2. **Apply a Feed** — sign in, select a feed, and apply its connection settings. Feeds with `arcgis`, `token`, `bearer`, OAuth, or unspecified auth on token-capable transports default to **🔑 Token On**. Feeds with `basic`, `none`, TCP, UDP, or unsupported auth default to **◇ Token Off**.

Click the footer badge to toggle token sending for **new** client connections. Active gRPC and HTTP client transports hot-swap the refreshed token when possible; WebSocket upgrade headers are fixed at connect time, so reconnect after changing the toggle.

The **🔒 TLS badge** is intentionally separate: it describes encryption and certificate trust only. The **🔑 auth badge** describes token availability and whether the token is sent.

## OAuth 2.0

The **OAuth 2.0** tab supports client-credentials flow (Client ID + Client Secret). This is currently only supported by ArcGIS Velocity for HTTP Poller feeds. The Apply button is disabled with a tooltip when the selected feed type does not support OAuth.

## Unsupported Feed Types

Feed types not yet supported by the Simulator are displayed with a **⚠** prefix and muted styling in the dropdowns. The **Apply** button is disabled for these types. Use the **Supported / All** radio toggle in the picker header to control their visibility. The default is **Supported** (unsupported types are hidden on first open).

## Feed Type Reference

Each feed type is visually identified in the picker dropdowns and info panel by a unique Unicode icon and a colour that matches the protocol's brand or role. The icon appears as a prefix character in the dropdown option text, and in the info panel's **Type** row as a coloured badge.

| Icon | Feed Type | Colour | Supported by Simulator |
|------|-----------|--------|------------------------|
| ⬡ (`\u2B21`) | `grpc` — gRPC | `#7c4dff` (purple) | ✅ Yes |
| ■ (`\u25A0`) | `http-receiver` — HTTP Receiver | `#0097a7` (teal) | ✅ Yes |
| ◆ (`\u25C6`) | `websocket` — WebSocket | `#00897b` (green) | ✅ Yes |
| ◎ (`\u25CE`) | `mqtt` — MQTT | `#f57c00` (orange) | ❌ Not yet |
| ▲ (`\u25B2`) | `kafka` — Kafka | `#e53935` (red) | ❌ Not yet |
| ◗ (`\u25D7`) | `tcp` — TCP | `#546e7a` (slate) | ❌ Not yet |
| ◖ (`\u25D6`) | `udp` — UDP | `#78909c` (blue-grey) | ❌ Not yet |
| ❖ (`\u2756`) | `azure-event-hub` — Azure Event Hub | `#0078d4` (Microsoft blue) | ❌ Not yet |
| ❖ (`\u2756`) | `azure-service-bus` — Azure Service Bus | `#0062ad` (dark blue) | ❌ Not yet |
| ◉ (`\u25C9`) | `kinetic` — Kinetic | `#43a047` (green) | ❌ Not yet |
| ▣ (`\u25A3`) | `file` — File | `#8d6e63` (brown) | ❌ Not yet |
| ○ (`\u25EF`) | *(unknown type)* | `#888` (grey) | ❌ Not yet |

> The icon characters are plain Unicode geometric shapes — no emoji — ensuring consistent rendering across platforms and OS native select dropdowns.

## Scope Toggle

The **My Feeds / ORG Feeds** segmented control in the sign-in row lets you switch between:

- **My Feeds** — returns only feeds owned by the signed-in user (`/iot/feeds`).
- **ORG Feeds** (default) — adds `view=admin` to the API request to return all feeds in the organization. Requires the signed-in account to have administrator privileges.

Switching scope re-fetches from the API. The **⟳ Refresh** button re-requests the current scope without changing scope.

## Dialog Size Persistence

The Velocity Login dialog opens at **590 x 840** pixels by default. After resizing or moving the window, its size and position are automatically saved to `dialogSizes.velocityLogin` in `config.json` and restored on the next open. To reset to the default size, remove the `velocityLogin` key from `dialogSizes` in `config.json`.

## UI Controls

Tooltips are rendered by the app's custom tooltip system on all operating systems. The tooltip renderer supports Unicode icons and theme-aware accent colors through structured attributes such as `data-tooltip-icon` and `data-tooltip-kind`; tooltip text is inserted as text content, not arbitrary HTML.

| Control | Tooltip / Behaviour |
|---|---|
| 🔑 button | "Sign In to ArcGIS Velocity — browse and apply feed connection settings" |
| Portal URL | "ArcGIS Enterprise or ArcGIS Online portal URL" |
| Username | "ArcGIS account username" |
| Password | "ArcGIS account password" |
| Show / Hide password | SVG eye icon toggles password field between masked and visible. |
| Remember me | "Remember portal URL and username for next session" |
| Sign In | "Authenticate and retrieve feeds from your Velocity organization" |
| My Feeds | "Show only feeds you own" |
| ORG Feeds | "Show all feeds in your organization (requires admin privileges)" — adds `view=admin` (default active scope) |
| ⟳ Refresh | "Refresh: re-request the list of feeds from Velocity" — re-fetches current scope |
| Supported | Show only feed types supported by the Simulator (default active filter) |
| All | Show all feed types, including those not yet supported by the Simulator |
| Type dropdown | Each option is prefixed with a type icon. Unsupported types show ⚠ prefix. |
| Feed dropdown | Each option is prefixed with a type icon. Unsupported items show ⚠ prefix and italic muted styling. |
| Use Token Only | "Use Velocity token for authentication only — keep your own connection settings in the main window" |
| Apply | "Apply the selected feed connection settings to the main window." Disabled for unsupported types. |
| Close | "Close this dialog without applying." |
| Footer 🔑 Token On | "Token On — Velocity token will be sent with new gRPC, HTTP, and WebSocket client connections. Scope: New client connections only. Token: Hidden for security. Selected feed: … Auth type: … Expires: … Action: Click to turn token sending off for new client connections." |
| Footer ◇ Token Off | "Token Off — A Velocity token is available, but it will not be sent with new client connections. Scope: New client connections only. Token: Hidden for security. Selected feed: … Auth type: … Expires: … Action: Click to turn token sending on for new client connections." |
| Footer ⚠ Token Error | "Token Error — Velocity token refresh failed. Token: Hidden for security. Status: … Action: Sign in again if reconnecting fails." |
| Footer 🔒… TLS badge | Mirrors the selected protocol's Use TLS checkbox while disconnected. Example configured tooltip: "TLS Configured — HTTP Client will use HTTPS on the next connection. Scope: New HTTP connections only. Encryption: Enabled in the UI. Certificate trust: Checked after connection. Endpoint: … Action: Click to turn TLS off for HTTP Client. Auth: Token status is shown separately by the key badge." Connected trust tooltips describe encryption and certificate trust only. |

## Credential Storage

When **Remember me** is checked, the portal URL and username are stored in the app's user data directory (`velocity-credentials.json`). The password is never persisted to disk.

