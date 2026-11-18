---
name: build-sign-release
description: Build, package, sign, or publish releases of the Standalone and Compact desktop editions using this repository's existing release tools.
---

# Build, sign and release

## Find the existing workflow

Read `AGENTS.md` and `docs/build-and-release.md`, then inspect:

```bash
bash scripts/release.sh --help
node scripts/package-runtime.js --help
```

`scripts/release.sh` is the release entry point. `package.json` owns the version
and package scripts. `scripts/package-runtime.js` selects build targets.
Standalone uses `--runtime electron`; Compact uses `--runtime tauri`.
Use full long option names in commands and examples.

## Resolve the external signer

Use an explicitly supplied signing-script path first, then
`VELOCITY_SIGN_SCRIPT`, or the optional ignored `.release.local.json` file:

```json
{"signScript": "/absolute/path/to/sign.sh"}
```

Read that local pointer and pass `--sign-script` explicitly. The release scripts
do not automatically load this JSON file. Keep personal paths and credentials
out of tracked files. The signer is external: read its own README/help and let
it load its own configuration; do not copy its implementation into this repository.
Do not silently substitute unsigned Windows packages when signing is requested.
Report macOS signing/notarization status accurately; an explicitly accepted
unnotarized build is not a Developer ID-signed release.

## Build and validate

Preserve the established Mac-controlled workflow rather than replacing it with
GitHub Actions without agreement. Read the current host checks before selecting
cross-build options: Electron packaging and native Compact compilation have
different prerequisites. Compact supports explicit `--windows-cross` on macOS
and `--linux-container` for a local Linux build environment.

Build the selected formats from the intended version and source revision.
Verify embedded versions, target architectures, signing results, extracted
package behavior, and complete checksum manifests. Do not rename an old binary
to a new version or publish a partial matrix as a complete release.

## Release safely

`--prepare-only` still commits and pushes; it is not a local-only build mode.
`--upload-only` validates prepared manifests, uploads to a draft, and publishes
after uploads finish. Follow the repository's commit and push approval rules.

Read the requested reference release with `gh`. Preserve its format and use
`--notes-file` for a reviewed body when generated commit notes need curation.
Omit internal skill/tooling changes from public notes when requested.
Preview with `--dry-run` before executing the release and verify the resulting
GitHub release and asset list afterward.
