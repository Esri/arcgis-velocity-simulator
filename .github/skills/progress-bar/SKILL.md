---
name: progress-bar
description: Show a live right-panel progress bar with numbered milestones, overall and per-line percentages, remaining minutes, and local clock-time ETAs. Use when the user asks for a progress bar, progress panel, or granular progress with ETA.
---

# Live progress bar

Use the bundled templates to reproduce the approved compact progress panel.
Do not substitute cards, a table, a terminal-only bar, or a static Markdown list.
This skill is repository-local; it does not install anything into a user's global configuration.
Use it alongside the repository's existing long-running-action guidance, not
instead of its execution, monitoring, runtime-preflight or cancellation rules.
Open the panel when requested; adding this skill does not make it mandatory for
every build or test.

## Format

- A task-specific heading and short scope description.
- Overall phase, percentage, remaining minutes and estimated local finish time.
- A simple numbered list (`#1`, `#2`, etc.), with a thin bar, percentage and ETA on every line.
- Pending, running, done and blocked states; running names are bold.
- Theme-aware colors with a dark fallback when host theme tokens are absent,
  tabular numerals and reduced-motion support. In auto mode, host-provided
  colors take precedence.
- Live updates every five seconds, with the countdown refreshed every second.
- Task state persists across extension reloads in a session artifact, never in the repository.
- Present actual parallelism and model information in the progress bar when available/possible. A short execution summary states actual parallel/delegated work; each line can show its worker and confirmed model in muted text without changing the simple list layout.

## Open or reuse

1. Inspect available canvases. If `task-progress` exists, read its capabilities and reuse the current progress panel. Do not create a duplicate or overwrite an unrelated extension.
2. If absent, use the `create-canvas` skill when available, and always call extension management's `guide` first. Read the installed SDK extension documentation and canvas types.
3. Scaffold a **session-scoped** canvas extension named `task-progress`. Use the scaffold tool, not a new project/global extension.
4. Copy `templates/extension.mjs` and `templates/progress.html` from this skill directory into that scaffold's directory. Keep both files together. The extension stores `task-progress.json` two levels above its directory, in the session's `files` directory. Confirm that directory exists.
5. Reload extensions, inspect `task-progress` for errors, and discover its capabilities.
6. Open it with a stable panel handle such as `work-progress`. Call `update` immediately with the current task's title, description and milestones. Use the same handle throughout the task.
7. Verify the open/action results. If an old title is still visible, reload the provider and reopen the same handle; never leave a prior task's name on new work.

The SDK and canvas tools are supplied by the host app. If unavailable, explain that limitation instead of claiming a live panel is shown.

## Theme selection

The default is `auto`: without a theme parameter, or with `?theme=auto`, follow
host theme colors when supplied and fall back to dark colors otherwise. Auto
follows the app, not the operating system's color preference.
Append `?theme=light` or `?theme=dark` to the returned panel URL to explicitly
override host colors, for example `http://127.0.0.1:<port>/?theme=light`.
Unknown values use the default auto behavior.
This is a renderer URL option, not an `update` action field or a global preference.

## Update payload

```json
{
  "title": "Logger dashboards",
  "description": "Both Loggers: controls, saved state, localization and checks",
  "execution": "One delegated worker plus coordinator; remaining work queued",
  "phase": "Implementing",
  "percent": 10,
  "etaMinutes": 30,
  "steps": [
    { "name": "Implementing controls", "worker": "UI worker", "model": "Runtime default (model not reported)", "status": "running", "percent": 20, "etaMinutes": 15 },
    { "name": "Updating help", "status": "pending", "percent": 0, "etaMinutes": 20 },
    { "name": "Regression checks", "status": "pending", "percent": 0, "etaMinutes": 30 }
  ]
}
```

Use only fields supported by the discovered schema; older panels may lack title/description fields. Upgrade only this session's progress template when necessary.

## Reporting rules

- Supply unnumbered names: the renderer adds `#1`, `#2`, etc. exactly once.
- Show actual execution, not planned parallelism: identify delegated workers, coordinator work, queued dependencies and completed workers separately. Do not infer worker count from the number of running milestone lines; one worker may own several milestones.
- Include exact model names only when confirmed by runtime metadata or an explicit launch override. Never guess a model from the task, agent type or prior session. Use `Runtime default (model not reported)` when unavailable. A worker's self-reported model should be labeled as such if not independently confirmed.
- Update execution/model information when workers start, finish, fail or change. Do not launch extra workers just to populate the progress display.
- Percentages reflect completed work, not elapsed time. Never advance them on a timer.
- Estimate remaining minutes honestly. Each line's ETA is its expected completion from **now**, including prerequisite delays, not only its active execution duration.
- Keep scope granular enough to expose real milestones but use short, readable names.
- Refresh after phase changes, verified milestones, blockers or materially revised estimates. Do not poll agents solely to animate a bar.
- Estimates are approximate and must not be represented as guarantees. Overdue estimates say `Revising ETA`; send a revised estimate when evidence permits.
- For blocked work, mark the line blocked and explain the blocker in the phase or task response. Never show it as done.
- On a task switch, replace the title, scope and milestone list; do not carry completed work into the new task.
- Set overall and all relevant lines to 100% only after validation. A stopped task is not automatically complete.
- Mark completed lines `done`; percentages alone do not complete a line. The
  renderer reserves 100% for completed work and completes the overall display
  only when the overall value is exactly 100 and every line is `done`.
- Follow any active planning-mode restrictions on time estimates; defer timed progress until implementation when estimates are prohibited during planning.

## Template maintenance

Keep the two templates together and preserve the presentation above when changing their implementation.
Keep shared copies consistent across GeoEvent, Velocity Services, Velocity
Kubernetes, Velocity Enterprise, ST-BDS and BDS Map Service; adapt repository
discovery/monitoring links outside this bundle.
State updates are serialized and published by atomic rename in the session
artifact directory so readers never observe a partially written snapshot.
Failed updates must reach the action caller without preventing later updates.

Run `node --test .github/skills/progress-bar/tests/progress-bar.test.mjs`
from the repository root for completion-state, persistence and theme URL regressions.
Validate JavaScript syntax, reload a session copy, exercise `update`, and confirm the returned state includes absolute `etaAt` timestamps for overall and per-line estimates.
