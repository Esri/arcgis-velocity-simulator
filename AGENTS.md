# Agent Guidelines — ArcGIS Velocity Simulator

This file provides rules and guidance for AI coding agents (e.g. GitHub Copilot, OpenAI Codex) working in this repository.

## General

- Follow the existing code style and conventions found in the source files.
- Do not introduce new dependencies without updating `package.json`.
- Keep all documentation in the `docs/` folder up to date when changing related functionality.
- Run `npm test` after making code changes and ensure all tests pass.

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

## Terminology

- Use **"unsecure"** (not "insecure") when writing prose, comments, or documentation that describes a connection or mode lacking TLS/encryption.
- Exception: do **not** rename third-party API identifiers such as `createInsecure()`, `InsecureServerCredentials`, or any gRPC/library symbol — those are external API names and must stay unchanged.

## Code Organization

- `src/` — application source (main process, renderer, preload, helpers, gesture/voice/speech modules)
- `scripts/` — build and developer utility scripts
- `test/` — unit and integration tests
- `docs/` — all documentation

## Commit Messages

Use the conventional-commits style:
- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance (build, deps, tooling, compliance)
- `docs:` documentation-only changes
- `test:` test additions or fixes

