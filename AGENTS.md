# Agent Guidelines — ArcGIS Velocity Simulator

This file provides rules and guidance for AI coding agents (e.g. GitHub Copilot, OpenAI Codex) working in this repository.

## General

- Follow the existing code style and conventions found in the source files.
- Do not introduce new dependencies without updating `package.json`.
- Keep all documentation in the `docs/` folder up to date when changing related functionality.
- In help text and documentation examples, always use full long option names rather than short aliases. This includes wrapper options (for example `--sign-script`, not `-x`) and pass-through external signing options (for example `--jenkins-email-to`, not `-je`).
- Run `npm test` after making code changes and ensure all tests pass.
- **Always prefer a DRY (Don't Repeat Yourself) implementation approach.** When logic is shared across modules (e.g. TLS utilities used by both gRPC, HTTP, and WebSocket transports), extract it into a dedicated shared module rather than duplicating it. Reference `src/tls-utils.js` and `src/format-utils.js` as examples of this pattern.
- Work in the repository's existing main checkout by default. Do not create a
  worktree unless the user explicitly requests isolation or concurrent work in
  this same repository cannot be performed safely in one checkout. Parallel
  work in separate repositories should use each repository's existing checkout.

## Copyright Headers

**Every new JavaScript file** added to this repository **must** begin with the following copyright header:

```js
/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
```

This applies to all `.js` files under `src/` only.

Do **not** add this header to files under `scripts/` or `test/` — script files often begin with a `#!/usr/bin/env node` shebang that must stay on line 1, and the copyright block would break them.

Do not skip this header in `src/`, even for small utility files.

## Documentation Updates

These rules are durable: they apply to every documentation change, not just the one that introduced them. Reconcile any conflicting guidance elsewhere in this file in favour of this section.

### Scope and ownership

- Documentation describes current behavior and actionable tasks only. Do not add historical narratives, changelogs, release chronologies, migration stories, "changes made" or "achievements" lists, benchmark timings, file-size comparisons, or future-enhancement wish lists. Git history is the record of what changed.
- Every topic has exactly one owner. Link to the owning guide instead of restating it, and delete a duplicate summary rather than keeping it in sync.

| Guide | Owns |
|-------|------|
| `docs/grpc.md`, `docs/http.md`, `docs/websocket.md`, `docs/xmpp.md` | Their protocol's behavior, user interface controls, tooltip reference, and troubleshooting. |
| `docs/tls.md` | Shared certificate concepts: certificate types, trust stores, mutual TLS, automatic self-signed certificates, and the TLS Trust Badge. |
| `docs/command-line.md` | The command-line option reference: every parameter, its values, default, headless requirement, and example. |
| `docs/headless.md` | Headless workflows: no-UI replay sessions, the launch configuration workflow, and completion artifacts. |
| `docs/configuration.md` | Persisted App Config, Launch Config keys and storage locations, and the `docs/examples/` samples. |
| `docs/developer-guide.md` | Repository structure, local development, testing, documentation checks, debugging, logging, and extension points. |
| `docs/build-and-release.md` | Prerequisites, packaging, code signing, release commands, and the release checklist. |
| `docs/keyboard-shortcuts.md`, `docs/offline-speech.md`, `docs/velocity-login.md` | Their feature surface end to end. |
| `docs/connection-presets.md` | The connection panel layout, the Protocol Settings dialog and its sections, and the paired connection presets. |
| `docs/connection-summary.md` | The connection summary: its surfaces, row order, warnings, secret handling, and effective URLs. |

### Placement

- All maintained documentation lives under `docs/`. The only Markdown files allowed outside `docs/` are the root `README.md`, this `AGENTS.md`, license and legal files (for example `LICENSE`), and GitHub-required metadata under `.github/` such as issue templates, pull request templates, contributing policies, and security policies.
- Tooling metadata that happens to be Markdown (for example a linter fixture) is not documentation and stays with its tool.
- Ready-to-copy sample files that a guide references — such as launch configuration JSON — live in `docs/examples/`. They are documentation examples, never runtime configuration, and the application must not read them at run time. That folder holds only `.sample.json` files; link each sample directly from `docs/configuration.md` and `docs/README.md` rather than adding an index there.
- Do not create a second documentation index. `docs/README.md` is the single index; the root `README.md` carries a short catalog that links to it.

### File naming

- Every Markdown file under `docs/` uses a lowercase kebab-case name with a lowercase `.md` extension — `command-line.md`, `build-and-release.md`, `xmpp.md`. The only exception is `docs/README.md`, the single documentation index.
- Do not add uppercase or `SCREAMING-CASE` documentation names. Prefer a descriptive noun phrase over an abbreviation when the abbreviation is not the product term.
- Sample files use a descriptive lowercase name and keep their `.sample.json` suffix, for example `launch-config.client.sample.json`.

### Required indexes

Whenever a Markdown file is added, renamed, or removed under `docs/`:

1. **`docs/README.md`** — add, rename, or remove the row in the guide table, including its leading icon, title, one-sentence purpose, and audience. Audience values are exactly `Users`, `Developers`, or `Users and developers`.
2. **Root `README.md`** — keep the documentation catalog concise, pointing at `docs/README.md`, and listing exactly the guides that exist.
3. **Sibling guides** — update the `## Related documentation` table of any guide that should link to the new or renamed file.

### Guide skeleton

Every guide under `docs/` (except the index files) has this shape:

1. Line 1 is a single sentence-case H1 — `# Command-line reference`, not `# Command-Line Reference`. Never use more than one H1.
2. Line 2 is blank; line 3 is the top navigation line, and nothing else appears above the intro:
   ```text
   [← Documentation index](README.md) · [Repository overview](../README.md#documentation)
   ```
   Nested guides adjust the relative paths, for example `[← Documentation index](../README.md) · [Repository overview](../../README.md#documentation)`.
3. A one- or two-paragraph intro that states the scope, the intended audience, and any prerequisites.
4. A `## Table of contents` section listing **H2 anchors only** whenever the guide exceeds roughly 80 lines or has four or more H2 sections.
5. The body, with heading levels used in order — no H2 → H4 jumps — and no repeated prev/next navigation bars between sections.
6. A closing `## Related documentation` section (or a clearly equivalent closing section) with a compact table of useful sibling guides.

### Headings, links, and formatting

- No emoji in headings, ever. A single leading icon per row or list entry is allowed in the `docs/README.md` guide table, in a `## Related documentation` table, and in short navigation lists.
- Use relative links only, and never prefix them with `./` — write `](configuration.md)`, not `](./configuration.md)`. No reference-style links.
- Link text is descriptive: `[Headless mode](headless.md)`, not `[headless.md](headless.md)`. Wrap literal file and folder names in backticks when they are named as files rather than linked as guides.
- Anchors are lowercase GitHub-style slugs. Avoid `&`, `/`, and other punctuation in headings that are link targets, because the slug is ambiguous; write "TLS and certificate stores", not "TLS & Certificate Stores".
- Every code fence declares a language — `bash`, `json`, `javascript`, `css`, `html`, `powershell`, `protobuf`, or `text` for output, trees, and diagrams.
- Use GitHub alerts (`> [!NOTE]`, `> [!WARNING]`) sparingly, for genuine warnings and caveats. Use a Mermaid diagram only when it explains something prose cannot, and always introduce it and fence it with the `mermaid` language.
- Wrap prose at roughly 80 columns where practical. Tables, code fences, and link-heavy list rows may exceed it. Keep tables compact, end descriptive table cells with a period, and leave no trailing whitespace on any line.
- Write formal enumerations in Esri style: introduce the list with a colon, separate the items with semicolons, and end the last item with a period.

### Tooltip and content fidelity

- Tooltip strings in a guide must match `src/index.html` and `src/renderer.js` character for character, including punctuation and capitalization. Never reword a tooltip only to make a sentence read better in documentation.
- Keep technical claims exact: defaults, ports, timeouts, limits, protocol behavior, and stated limitations must match the code. If behavior is deliberately limited, say so plainly rather than softening it.

### Terminology in documentation

- Write **ArcGIS Velocity** on first mention in a document, then **Velocity**. Use **Velocity Online** and **Velocity Enterprise** for the deployment variants.
- Say **documentation** (not "docs" in prose), **repository** (not "repo"), and **pull request** (not "PR").
- Describe the XMPP transport in user-facing terms and reference the ArcGIS Velocity and ArcGIS GeoEvent Server products it talks to, not internal codebases or spike history.

### Renames and validation

- When a documentation file is renamed or moved, update every reference in the same change: Markdown links and anchors, `src/help.html` and other HTML, JavaScript strings, `package.json` scripts, tests, build and release scripts, and repository metadata.
- After any documentation change, run `npm run docs:check-links` (relative links and anchors) and `npm test`, and confirm `git diff --check` reports no whitespace errors.
- Search the whole repository, excluding `node_modules`, for the old path before considering a rename complete.

When adding a new protocol, transport, or major feature:

1. **`src/help.html`** — update the **Overview/Getting Started** description, add the new protocol to the **Connection Modes** list, and add a dedicated **Options** section describing every control and its tooltip content.
2. **`docs/*.md`** — the corresponding transport guide (for example `docs/http.md`, `docs/grpc.md`, `docs/websocket.md`, `docs/xmpp.md`) must include a **UI controls** section listing every control with its tooltip text, and a **Tooltip reference** section with the exact tooltip strings used in `renderer.js`.

## Terminology

- Use **"unsecure"** (not "insecure") when writing prose, comments, or documentation that describes a connection or mode lacking TLS/encryption.
- Exception: do **not** rename third-party API identifiers such as `createInsecure()`, `InsecureServerCredentials`, or any gRPC/library symbol — those are external API names and must stay unchanged.

## Code Organization

- `src/` — application source (main process, renderer, preload, helpers, gesture/voice/speech modules)
- `scripts/` — build and developer utility scripts
- `test/` — unit and integration tests
- `docs/` — all documentation (lowercase kebab-case filenames; samples in `docs/examples/`)

## UI / CSS Conventions

- All text-input controls (e.g. file paths, cert paths, URL paths) and dropdown selects (e.g. format, serialization) inside `.aligned-group` containers must use **`text-align: left`** (and `text-align-last: left` for selects). The default right-alignment in `.aligned-group > :not(label)` is for numeric/port inputs only. When adding a new text input or select dropdown, add an explicit `text-align: left` override in `style.css` following the existing patterns.
- **Every interactive control** (buttons, checkboxes, dropdowns, text inputs) must have a meaningful `title` attribute (tooltip) that describes its purpose, accepted values, and any important context. For `<select>` dropdowns, add a `title` on each `<option>` as well as on the `<select>` itself. Use the JavaScript tooltip-updater pattern (see existing `*_TOOLTIPS` objects and `update*Tooltip()` functions in `renderer.js`) to keep each `<select>` element's tooltip in sync with the currently selected value. All tooltip text must also be captured in the corresponding `docs/*.md` file so documentation stays consistent with the UI.
- Use polished, theme-friendly **SVG icons** for persistent icon controls. Prefer `currentColor` masks or inline SVGs, avoid emoji/icon fonts for durable controls, and provide clear on/off variants for stateful buttons.

### Tooltip Authoring Rules

Tooltips in this app use the shared custom tooltip system in `src/tooltip-utils.js`, enabled on all operating systems because native Electron/macOS `title` tooltips are unreliable. Follow these rules every time you add or edit a control:

1. **Always add tooltip content.** Every `<button>`, `<input>`, `<select>`, `<label>`, and `<textarea>` must have a meaningful `data-tooltip` and `aria-label` (or a `title` that `tooltip-utils.js` can migrate at runtime). Prefer explicit `data-tooltip` for new controls.

2. **Be descriptive, not just a label echo.** `data-tooltip="Save"` on a save button tells the user nothing new. Instead write what it does and when: `data-tooltip="Save logs to a file (Cmd+S)"`. Include the keyboard shortcut if one exists.

3. **Use structured tooltip attributes.** Custom tooltips may use Unicode icons and theme-aware colors through approved attributes such as `data-tooltip-icon="🔑"` and `data-tooltip-kind="auth|info|success|warning|error|secure"`. Do not put arbitrary HTML in tooltip strings.

4. **Use `&#10;` for multi-line tooltip text in HTML attributes.** Newlines inside `data-tooltip` or `title` attributes must be written as the HTML entity `&#10;` (not a literal newline or `\n`). Example:
   ```html
   data-tooltip="Toggle Camera&#10;---&#10;Supported Gestures:&#10;Thumbs up: Connect&#10;Call me hand: Disconnect" data-tooltip-icon="📷" data-tooltip-kind="info"
   ```
   Limit multi-line tooltips to buttons that have several distinct behaviors worth listing. Keep each line short.

5. **Match the pattern of existing working buttons.** Before writing a new tooltip, look at a nearby working button in `index.html` (e.g. `toggle-connection-controls`, `save-logs-btn`) and follow exactly the same quoting, attribute placement, and text style.

6. **Dynamic tooltips go in `renderer.js`, not in HTML.** When a button or select changes state (e.g. Play/Pause, Ascending/Descending), update `element.dataset.tooltip` (or `element.title`, which is migrated by `tooltip-utils.js`) in JavaScript alongside the icon/label swap. Never hard-code a state-dependent tooltip into the HTML - it will become stale.

7. **Test on hover before committing.** After adding a tooltip, run the app with `npm start` and hover/focus the control to confirm the custom tooltip appears with the expected icon, color, and line wrapping.

## UX Design Standards

Aim for the polish and refinement found in industry-leading desktop applications (VS Code, GitHub Desktop, Figma, Linear, Slack). Every user-facing interaction should feel intentional, responsive, and well-crafted:

- **Error and status feedback** must never obscure other UI elements. Use inline banners or toast notifications within the relevant context area rather than cramming messages into fixed-height footers. Errors should be dismissible, wrap naturally for long messages, and use clear visual hierarchy (icon + colored border + readable text).
- **Dialogs and panels** should have breathing room, consistent spacing, and a clear visual flow from top to bottom. Avoid overloading a single row with competing elements.
- **Transitions and animations** should be subtle (150-200ms), purposeful, and never block interaction. Use them to orient the user, not to decorate.
- **Progressive disclosure** — show only what the user needs at each step. Hide advanced options behind expandable sections or secondary views.
- **Accessibility** — use semantic HTML, ARIA attributes (`role`, `aria-live`), and ensure keyboard navigation works for all interactive elements.

## Logging Best Practices

All network-facing operations (authentication, API queries, token refresh) must include structured console logging:

- Use the shared `appLogger` (a `RunLogger` instance) via the `velocityLog(level, message)` helper. Levels: `'error'`, `'warn'`, `'info'`, `'debug'` (ordered by priority, lowest to highest).
- Default log level is `'info'`. Configure via the `logLevel` CLI parameter (e.g. `logLevel=debug` for verbose output, `logLevel=error` for quiet operation). Works in both UI and headless modes.
- All log output goes to both the console and a log file. The log file defaults to `./logs/velocity-simulator-YYYYMMDDTHHMMSS.log`. Override with `logFile=/custom/path.log`.
- Log entries use the `RunLogger` format: `[timestamp] [LEVEL] [message]`.
- Prefix each message with a context tag in brackets: `[Auth]`, `[API]`, `[Token]`, `[Transport]`, `[Startup]`, etc.
- Log the operation being attempted on entry, and the outcome (success summary or error message) on completion.
- Never log sensitive data (passwords). Tokens, usernames, and client IDs are acceptable for debugging context.

## Commit Messages

Use the conventional-commits style:
- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance (build, deps, tooling, compliance)
- `docs:` documentation-only changes
- `test:` test additions or fixes

## Git / GitHub Commit Workflow (Agent Tool Usage)

When creating commits with multi-line messages, **never** construct the message inline in a chained shell command. The zsh parser inside the IDE's `run_in_terminal` tool mishandles embedded newlines, apostrophes, em dashes, and other punctuation in heredocs or `printf '…' | git commit -F -` chains — leading to mangled messages, stuck pager prompts (requiring the user to press `q`), or failed commits.

### Required Pattern — Two Separate Tool Calls

**Call 1** — write the message to a temp file:
```zsh
cat > /tmp/cm.txt << 'EOF'
feat(scope): short subject line

Longer body paragraph explaining what changed and why.
Another line of detail.

- bullet one
- bullet two
EOF
```

**Call 2** — stage and commit using that file:
```zsh
cd /path/to/repo && git add -A && git commit -F /tmp/cm.txt
```

**Verification step (required).** Some terminals collapse blank lines inside pasted heredocs, which produces a commit object where the subject and body are stuck on consecutive lines (no separator). Always inspect the file before committing:

```zsh
cat -en /tmp/cm.txt | head -5
```

Line 1 must be the subject, **line 2 must be blank** (just `$`), and the body must start on line 3. If line 2 is not blank, regenerate the file using Node, which is unambiguous:

```zsh
node -e 'require("fs").writeFileSync("/tmp/cm.txt", `subject\n\nbody line 1\nbody line 2\n`)'
```

### Commit Message Format

- **Keep the subject line short and imperative (≤ 72 chars).** Use the conventional-commits prefix (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). The subject should name *what* changed, not explain *why* or list details.
- **Always leave a blank line** between the subject and the body.
- **Move all detail into the body.** The body should be well-formatted prose or a bullet list explaining what changed and why. Never run detail on into the subject line.
- **Good example:**
  ```text
  feat: add cross-platform prereq installer and --install-prereqs switch

  Adds an opt-in workflow for installing missing build/release
  prerequisites on macOS, Linux, and Windows. Default behaviour is
  unchanged (fail-fast with install hints).

  - New scripts/install-prereqs.js: installs via brew/apt/winget,
    skips things too risky to auto-install (Node upgrades, gh auth).
  - check-build-prereqs.js gains --json flag for machine-readable output.
  - release.sh gains --install-prereqs switch and portable mktemp fix.
  ```

### When to Commit and Push

- **Do not auto-commit after every change.** Wait until the user explicitly asks to "commit" or "commit and push". At that point, group all pending changes into a single logical commit (or the fewest meaningful commits).
- **Never commit and push in the same turn as making code changes.** After implementing a change, stop and wait for the user to review and approve before staging anything.
- **Always show the proposed commit message and list of files** to be staged, and wait for the user's "go ahead" before running `git commit`.
- **Always ask the user before pushing.** Show the commit(s) that will be pushed and wait for explicit approval before running `git push`.
- **Pushing is always a separate tool call** after verifying the commit landed cleanly:
  ```zsh
  git --no-pager log --oneline -3   # verify first
  git push                           # then push
  ```

### Amending Commits

- Use `git commit --amend --no-edit` for small follow-up tweaks (no message change needed).
- For message changes, write a new `/tmp/cm.txt` and use `git commit --amend -F /tmp/cm.txt`.

### Rebase Over Merge

- Always use `git pull --rebase` instead of `git pull`. Never create merge commits.
- Configure with `git config pull.rebase true` if needed.

### Pager Prevention

Always use `git --no-pager` (or append `| cat`) for any `git log`, `git diff`, `git show`, or `git tag` command — these invoke the pager by default, blocking the terminal until the user presses `q`.

```zsh
git --no-pager log --oneline -10
git --no-pager diff HEAD~1 --stat
```

### One Tool Call Per Action

- Never chain commit + push + log verification into a single command string. Run them as separate sequential tool calls so a failure in one step is isolated and visible.
- Never use `git commit -m "…"` for messages longer than a subject line — apostrophes and punctuation break shell quoting. Always write to a file first.

## Sister Repository: ArcGIS Velocity Logger

This app (the **Simulator**) and the **ArcGIS Velocity Logger** are companion applications. They share a nearly identical Velocity Login dialog, but serve opposite roles:

- **Simulator** — the login dialog queries **feeds** (data inputs that receive data sent by this app).
- **Logger** — the login dialog queries **outputs** (data outputs that this companion app connects to for receiving/logging data).

When making changes or enhancements to the **feeds** logic in this repository (e.g. feed picker UI, feed listing API calls, feed type icons/colors, dropdown styling), **apply the equivalent change to the outputs logic in the Logger repository**. The same applies in reverse: output-related improvements in the Logger should be mirrored here for feeds.

Key mapping between the two apps:

| Simulator (this repo)       | Logger (sister repo)        |
|-----------------------------|------------------------------|
| `listFeeds()`              | `listOutputs()`             |
| `parseFeedItem()`          | `parseOutputItem()`         |
| `item.feedType`            | `item.outputType`           |
| `velocity:feed-applied`    | `velocity:output-applied`   |
| Feed Picker dropdown       | Output Picker dropdown      |
| "not yet supported by the Simulator" | "not yet supported by the Logger" |

### Transport parity

The two apps also share every network transport — TCP, UDP, HTTP, WebSocket, gRPC, and XMPP — with the roles inverted: the Simulator **publishes** the data that the Logger **consumes**. Whenever a transport changes here, plan the mirrored change in the Logger, and vice versa.

Treat the following as one shared surface that must not drift between the repositories:

- **Protocol modules.** The `src/<protocol>-transport.js` facades and any protocol-specific helper modules (for example the `src/xmpp-*.js` family) should keep the same module names, option names, and public function shapes in both repositories, so a fix applied to one can be read straight across.
- **Option vocabulary.** CLI keys, launch-config keys, and UI element ids should be identical. A parameter named `xmppRoomPassword` here must not become `xmppMucPassword` there.
- **Defaults and bounds.** Ports, timeouts, size caps, destination caps, TLS/STARTTLS policies, and validation rules must match, so the same configuration behaves the same on both sides of a test.
- **Wire-level guarantees.** Framing, delimiters, content types, self-echo handling, and error conditions must stay compatible; one app's send path is the other app's receive path, so a change to either is a protocol change.
- **XMPP safeguards.** Keep account/JID canonicalization, password-whitespace handling, explicit opt-in unverified TLS, empty-password acceptance for PLAIN and SCRAM-SHA-1, Direct/MUC self-echo semantics, waiter cancellation, reconnect cleanup, and acknowledgement-only XEP-0198 claims identical. Never copy credentials between repositories or weaken a safeguard to simplify pairing.
- **Client TLS verification.** Client-mode certificate verification is on by default and is bypassed only through the explicit `allowUnverifiedTls` (gRPC), `httpAllowUnverifiedTls`, `wsAllowUnverifiedTls`, and `xmppAllowUnverifiedTls` options. Keep the option names, defaults, warning styling, and log wording identical in both repositories, and keep the decision in one shared TLS helper (`resolveClientTlsVerification()` in `src/tls-utils.js`) rather than duplicating it per transport.
- **Shared SCRAM primitives.** `src/xmpp-scram.js` holds the SCRAM-SHA-1 key derivation used by both the in-process server mechanism and the client mechanism, so the two sides of a local pairing always agree and an empty password authenticates. Mirror any change to it rather than duplicating the crypto inline.

#### Connection preset parity

`src/connection-presets.js` defines twelve paired connection presets. The preset
**identifiers and labels are a cross-application contract** and must match the
Logger exactly, character for character, including the em dash in each label:

| Identifier | Label |
|---|---|
| `local-tcp-logger-server` | Local TCP — Logger Server / Simulator Client |
| `local-tcp-simulator-server` | Local TCP — Simulator Server / Logger Client |
| `local-udp-logger-server` | Local UDP — Logger Server / Simulator Client |
| `local-udp-simulator-server` | Local UDP — Simulator Server / Logger Client |
| `local-grpc-logger-server` | Local gRPC — Logger Server / Simulator Client |
| `local-grpc-simulator-server` | Local gRPC — Simulator Server / Logger Client |
| `local-http-logger-server` | Local HTTP — Logger Server / Simulator Client |
| `local-http-simulator-server` | Local HTTP — Simulator Server / Logger Client |
| `local-ws-logger-server` | Local WebSocket — Logger Server / Simulator Client |
| `local-ws-simulator-server` | Local WebSocket — Simulator Server / Logger Client |
| `local-xmpp-logger-server` | Local XMPP — Logger Server / Simulator Client |
| `local-xmpp-simulator-server` | Local XMPP — Simulator Server / Logger Client |

Only the **role mapping** is inverted. In the Simulator, a label naming *Logger
Server* selects a `*-client` connection type and a label naming *Simulator
Server* selects a `*-server` connection type; the Logger maps the same labels
the other way. Hosts, ports, formats, serialization, paths, and TLS choices must
stay identical.

Preset semantics must also match: a preset only pre-fills editable fields, never
connects, never starts playback or capture, never selects a file, never saves a
secret, and never changes startup defaults. Selecting **Custom** preserves
current values, and editing any populated field switches the display to
**Custom (modified)**. Adding, renaming, or repurposing a preset requires the
same change in the sister repository in the same release.

#### XMPP role defaults and the deliberate destination asymmetry

XMPP is the one transport where the two apps pick **different role defaults**, and that difference is intentional:

| | Simulator (this repo) | Logger (sister repo) |
|---|---|---|
| Default role when `protocol=xmpp` is selected | **Client** — it signs in to the receiving server and publishes | **Server** — it hosts the endpoint a publisher signs in to |
| Direction-specific option | `xmppDestination` — the bare JIDs each replayed line is **sent to** | `xmppLocalJid` — the local identity the Logger **receives on** |
| Application-wide default (unchanged by XMPP) | TCP Server on 5565 | the Logger's own app-wide default |

`xmppDestination` and `xmppLocalJid` are the only XMPP options that differ, and they differ because one app addresses a recipient and the other names itself. Do not add `xmppLocalJid` here, and do not add Simulator-style send behavior — or any receive-only behavior — to this repository to "even out" the pair.

Everything else in the public option vocabulary is identical and must stay identical, with the same defaults and the same validation:

- `xmppDomain`, `xmppTlsPolicy`, `xmppTlsCaPath`, `xmppTlsCertPath`, `xmppTlsKeyPath`, `xmppAllowUnverifiedTls`, `xmppAllowRemote`;
- `xmppUsername`, `xmppPassword`, `xmppResource`, `xmppExternalUsername`, `xmppExternalPassword`;
- `xmppConversation` (`direct` | `muc`), `xmppRoom`, `xmppNickname`, `xmppRoomPassword`;
- `xmppConnectTimeoutMs` (30000), `xmppReplyTimeoutMs` (15000), `xmppPingIntervalMs` (60000), `xmppReconnectDelayMs` (60000) — all positive integers, with no zero-disable or zero-wait-forever behavior;
- the shared top-level `ip` as the network host override, separate from `xmppDomain`. Neither repository may introduce an `xmppHost` key;
- port 5222 whenever XMPP is selected without an explicit port.

Internal differences are allowed where they do not surface to a user: the two apps may name their internal callbacks differently (a send path versus a receive path), and their transports may expose different internal hooks. Public option names, defaults, validation messages, tooltips, and documented behavior may not diverge.
- **Documentation.** The matching `docs/<protocol>.md`, `src/help.html` sections, and tooltip reference tables should describe the same behavior in both repositories, adjusted only for the direction of data flow.

Invert only what genuinely differs by role. Where the Simulator sends, the Logger receives; where the Simulator names a destination, the Logger names a source; and where a control here reads "publish to", the Logger's equivalent reads "listen on". Everything else — naming, structure, limits, terminology, and honesty about limitations — should be the same in both places.

### Protocol Settings dialog and Connection Summary parity

The connection surface is shared between the ArcGIS Velocity Simulator and the
ArcGIS Velocity Logger and must not drift. Both applications keep only the
fields every protocol shares inline, and edit everything protocol-specific in an
in-window native `<dialog id="protocol-settings-dialog">` nested inside the
connection controls container. It is a `<dialog>` element, never an Electron
`BrowserWindow`, so it renders in the top layer, traps focus natively, and still
delivers `change` and `input` events to the delegated preset-modification
listeners. No control is duplicated between the row and the dialog.

Keep the following identical in both repositories.

- **Element identifiers.** `protocol-settings-dialog`, `protocol-settings-btn`,
  `protocol-settings-count`, `protocol-settings-title`,
  `protocol-settings-subtitle`, `protocol-settings-close`,
  `protocol-settings-readonly`, `protocol-settings-alert`,
  `protocol-settings-tablist`, `protocol-settings-tab-<section>`,
  `protocol-settings-panel-<section>`, `protocol-settings-empty`,
  `protocol-settings-summary-rows`, `protocol-settings-done`,
  `protocol-settings-revert`, `protocol-settings-reset`,
  `connection-summary-card`, `connection-summary-rows`,
  `connection-summary-show-all`, `connection-summary-copy`,
  `connection-summary-warning-count`,
  `connection-summary-status-btn`, and `connection-summary-status-label`.
  Pre-existing protocol control ids are preserved unchanged, including
  `grpc-advanced`, `http-advanced`, `ws-advanced`, and `xmpp-advanced`, which
  identify the Advanced group of each protocol.
- **Sections.** `basics`, `security`, `advanced`, and `summary`, offered only
  when they hold something for the selected protocol and mode, with `tablist`,
  `tab`, and `tabpanel` roles, a roving tab stop, Arrow keys, and `Home` and
  `End`. Each protocol owns one
  `.protocol-settings-group[data-protocol][data-section]` per section, and a new
  protocol starts on its own first section rather than inheriting the previous
  one.
- **Control placement.** Format, path, serialization, RPC type, and the XMPP
  conversation, domain, account, and room fields are Basics; TLS, certificate
  paths, certificate verification, and remote binding are Security; the gRPC
  endpoint header, the WebSocket subscription message, first-message handling,
  and upgrade headers, and the XMPP timings are Advanced.
- **Editing model.** Controls update renderer state immediately and reach the
  network only on Connect. **Done** and `Esc` close and keep the edits,
  **Revert changes** restores the snapshot taken when the dialog opened and is
  enabled only while something still differs from it, and **Reset to preset** is
  enabled only while the fields derive from a modified preset. Focus returns to
  the opener.
- **Locking.** Disconnected is editable; connecting and connected are read-only
  with `protocol-settings-readonly` filled in; connected opens the read-only
  Summary section. Locking is one scoped query over the dialog, never a
  hand-maintained control list, and it also locks the shared preset, connection
  type, host, and port. The XMPP server **Copy Client Settings** and **Include
  password** actions stay available exactly while an XMPP Server is connected.
- **Validation.** A failed Connect fills the assertive `protocol-settings-alert`
  banner, opens the dialog on the section that owns the offending control,
  reveals and focuses it, sets `aria-invalid`, and adds the banner id to
  `aria-describedby` without discarding the tokens already there, and it still
  writes the message to the status log. Clearing the error removes only the
  banner's own token.
- **Shortcuts.** `Cmd/Ctrl+Shift+P` opens or closes Protocol Settings and
  `Cmd/Ctrl+Shift+I` opens its read-only Summary section. Both surfaces funnel through
  one `handleConnectionShortcut(name)` entry point in the renderer, so a menu
  accelerator and the in-page key handler can never disagree.
- **Summary generator.** `src/connection-summary.js` is a pure module with no
  DOM access. `buildConnectionSummary(state)` drives the warning-only alert,
  toolbar and status-bar buttons, the read-only Summary section, and the
  configured-state count. The permanent inline summary card is not restored:
  details are opened on demand, while the highest-priority warning remains
  visible beneath the toolbar. `formatConnectionWarningLine(summary)` returns
  `null` when nothing is wrong and otherwise condenses the warning count and
  highest-priority warning into the alert's single line. The generator covers
  all twelve protocol and mode combinations, sorts warnings
  first with the certificate-verification bypass leading them, composes
  effective HTTP and WebSocket URLs, and reports a secret only as
  `Set (hidden)`, `Empty`, or `Not set`. Row objects carry `key`, `label`,
  `value`, `group`, `kind`, `severity`, `secret`, `isDefault`, and `detail`;
  groups are `Security`, `Connection`, `Protocol`, and `Session`; kinds are
  `warning`, `state`, `endpoint`, `preset`, `security`, `setting`, and `secret`.
  The WebSocket subscription message and upgrade headers are secrets in every
  surface. A server with neither a certificate nor a key reports the automatic
  self-signed pair, and only a half-configured pair raises a warning. The
  certificate-verification row is reported whenever encryption applies. The
  Settings action reports the changed count through `settings.shortLabel`,
  which is empty for defaults and otherwise contains the count alone. The
  adjacent Summary action reports the warning count.
- **Status-bar tooltip.** The status-bar button tooltip only says how to open
  the summary; it never carries the summary itself.
- **Tooltip utility.** `src/tooltip-utils.js` stays byte-identical in both
  repositories. It owns title migration, dynamic content, and additive
  `aria-describedby`. Visual tooltips require roughly 900 ms of stationary
  fine-pointer hover within a 4 px tolerance. Movement, pointer interaction,
  keyboard input, form input, scrolling, dragging, resizing, target removal,
  focus alone, and an open modal dialog suppress or dismiss them. The utility
  never invents fallback tooltips from visible labels, select option text, or
  placeholders. Focus associates the same content as a hidden accessible
  description without opening a visual popup, and visible tooltips do not
  intercept pointer input. Fix shared behavior there rather than working around
  it in a renderer.

Only these differences are allowed, and each one follows from the direction of
data flow or from a control that only one application has.

| Difference | Simulator | Logger |
|---|---|---|
| XMPP role row | `xmppDestination`, labelled Destination, reported for a direct conversation. | `xmppLocalJid`, labelled Receiving JID, reported for a direct conversation. |
| Role wording | Publishing to for a client; Listening on for a server. | Receiving from for a client; Listening on for a server. |
| Copy heading | `ArcGIS Velocity Simulator — connection summary`. | `ArcGIS Velocity Logger — connection summary`. |
| Identity defaults | `xmppResource` and `xmppNickname` default to `velocity-simulator`. | `xmppResource` defaults to `velocity-logger`, `xmppNickname` to `logger`, and `xmppExternalUsername` to `velocity-client`. |
| Host control id | The pre-existing host input is `ip-address`. | The pre-existing host input is `host`. |
| Inline-only controls | File selection, the lines and interval rate fields, and the playback actions stay inline. | The log controls stay inline. |
| Server identity output | None. | `xmpp-receiving-jid` reports the JID the running server receives on. |

Anything else — element ids, section names, row keys, labels, defaults, tooltip
text, warning wording, and shortcut assignments — stays the same. Adding a
section, a footer action, a warning, or a summary row requires the same change
in the sister repository in the same release.

When a transport-level change cannot be mirrored immediately, say so explicitly in the pull request description and in the relevant `docs/<protocol>.md` limitations section, rather than leaving the two apps quietly incompatible.
