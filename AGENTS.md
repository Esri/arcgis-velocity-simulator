# Agent Guidelines — ArcGIS Velocity Simulator

This file provides rules and guidance for AI coding agents (e.g. GitHub Copilot, OpenAI Codex) working in this repository.

## General

- Follow the existing code style and conventions found in the source files.
- Do not introduce new dependencies without updating `package.json`.
- Keep all documentation in the `docs/` folder up to date when changing related functionality.
- Run `npm test` after making code changes and ensure all tests pass.
- **Always prefer a DRY (Don't Repeat Yourself) implementation approach.** When logic is shared across modules (e.g. TLS utilities used by both gRPC, HTTP, and WebSocket transports), extract it into a dedicated shared module rather than duplicating it. Reference `src/tls-utils.js` and `src/format-utils.js` as examples of this pattern.

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

Whenever a new Markdown (`.md`) file is added to the repository:

1. **Root `README.md`** — add a reference to the new file in the relevant section (e.g. the Documentation table).
2. **`docs/README.md`** — add an entry for the new file in the documentation index, including a short description and the intended audience.

Do not add a new `.md` file without updating both README files.

When adding a new protocol, transport, or major feature:

1. **`src/help.html`** — update the **Overview/Getting Started** description, add the new protocol to the **Connection Modes** list, and add a dedicated **Options** section describing every control and its tooltip content.
2. **`docs/*.md`** — the corresponding transport doc (e.g. `docs/HTTP.md`, `docs/GRPC.md`, `docs/WEBSOCKET.md`) must include a **UI Controls** section listing every control with its tooltip text, and a **Tooltip Reference** section with the exact tooltip strings used in `renderer.js`.

## Terminology

- Use **"unsecure"** (not "insecure") when writing prose, comments, or documentation that describes a connection or mode lacking TLS/encryption.
- Exception: do **not** rename third-party API identifiers such as `createInsecure()`, `InsecureServerCredentials`, or any gRPC/library symbol — those are external API names and must stay unchanged.

## Code Organization

- `src/` — application source (main process, renderer, preload, helpers, gesture/voice/speech modules)
- `scripts/` — build and developer utility scripts
- `test/` — unit and integration tests
- `docs/` — all documentation

## UI / CSS Conventions

- All text-input controls (e.g. file paths, cert paths, URL paths) and dropdown selects (e.g. format, serialization) inside `.aligned-group` containers must use **`text-align: left`** (and `text-align-last: left` for selects). The default right-alignment in `.aligned-group > :not(label)` is for numeric/port inputs only. When adding a new text input or select dropdown, add an explicit `text-align: left` override in `style.css` following the existing patterns.
- **Every interactive control** (buttons, checkboxes, dropdowns, text inputs) must have a meaningful `title` attribute (tooltip) that describes its purpose, accepted values, and any important context. For `<select>` dropdowns, add a `title` on each `<option>` as well as on the `<select>` itself. Use the JavaScript tooltip-updater pattern (see existing `*_TOOLTIPS` objects and `update*Tooltip()` functions in `renderer.js`) to keep each `<select>` element's tooltip in sync with the currently selected value. All tooltip text must also be captured in the corresponding `docs/*.md` file so documentation stays consistent with the UI.

### Tooltip Authoring Rules

Tooltips in this app use the native HTML `title` attribute, which Electron renders as a hover tooltip without any custom CSS or JavaScript. Follow these rules every time you add or edit a control:

1. **Always add a `title` attribute.** Every `<button>`, `<input>`, `<select>`, `<label>`, and `<textarea>` must have one. Do not leave any interactive element without a tooltip.

2. **Be descriptive, not just a label echo.** `title="Save"` on a save button tells the user nothing new. Instead write what it does and when: `title="Save logs to a file (Cmd+S)"`. Include the keyboard shortcut if one exists.

3. **Use a colon or parentheses to separate the label from the description.** Avoid em dashes (`—`) and other Unicode punctuation in `title` strings — these characters have caused tooltips to silently fail to render in Electron. Stick to plain ASCII: colons, hyphens, parentheses, and newlines.

4. **Use `&#10;` for multi-line tooltips.** Newlines inside a `title` attribute must be written as the HTML entity `&#10;` (not a literal newline or `\n`). Example:
   ```html
   title="Toggle Camera&#10;---&#10;Supported Gestures:&#10;👍 Connect&#10;🤙 Disconnect"
   ```
   Limit multi-line tooltips to buttons that have several distinct behaviors worth listing. Keep each line short.

5. **Match the pattern of existing working buttons.** Before writing a new tooltip, look at a nearby working button in `index.html` (e.g. `toggle-connection-controls`, `save-logs-btn`) and follow exactly the same quoting, attribute placement, and text style.

6. **Dynamic tooltips go in `renderer.js`, not in HTML.** When a button or select changes state (e.g. Play ↔ Pause, Ascending ↔ Descending), update `element.title` in JavaScript alongside the icon/label swap. Never hard-code a state-dependent tooltip into the HTML — it will become stale.

7. **Test on hover before committing.** After adding a tooltip, run the app with `npm start` and hover over the control to confirm the tooltip appears. If it does not, check for em dashes, curly quotes, or other non-ASCII characters in the `title` value.

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
  ```
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
