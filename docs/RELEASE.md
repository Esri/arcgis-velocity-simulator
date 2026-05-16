# Release Process

This document covers how to publish a new release of ArcGIS Velocity Simulator. The **recommended approach** is the release script described below, which handles every step automatically. A manual fallback build path is also documented for reference.

---

## 🚀 Release Script (Recommended)

The release script at `scripts/release.sh` is the primary way to cut a release. Run it from the **repository root**:

```bash
./scripts/release.sh <version>
```

### What It Does

The script handles the full release pipeline in one command:

0. **Verifies** that all required tooling is installed (Node ≥ 18, npm, `node_modules`, git, gh + auth, and on macOS for `.deb`: `dpkg`, `fakeroot`, GNU `ar`) and that the working tree is clean (no uncommitted changes apart from `package.json`, no unpushed commits) — fails fast with install hints or a list of dirty files if anything is wrong
1. **Validates** the requested version against the current `package.json` version (blocks downgrades)
2. **Bumps** `package.json` to the new version
3. **Builds** all platform packages in parallel via `npm run package:all:clean` (mac, win, linux run simultaneously). Pass `--seq` to build sequentially instead. Optional external Windows signing remains compatible with the parallel build because each external signing invocation uses a shared lock.
4. **Commits and pushes** the `package.json` version bump (only if the version changed)
5. **Publishes** a GitHub Release with all `dist/` artifacts and rich release notes (changelog, artifact table, build environment info)

### Prerequisites

The release script auto-checks all of these in Step 0 and aborts with install hints if anything is missing. You can also verify your machine at any time with:

```bash
npm run prereqs:check                    # build-only checks
npm run prereqs:check:release            # also verify git/gh/auth (release prereqs)
npm run check:build-prereqs              # backwards-compat alias
```

Or, on a fresh machine, install everything in one step:

```bash
npm run prereqs:install:release          # install missing build + release prereqs
./scripts/release.sh --install-prereqs v1.2.3   # equivalent, then continue with the release
```

See **[BUILD.md → Bootstrapping a Fresh Machine](./BUILD.md#bootstrapping-a-fresh-machine)** for the full per-target install matrix and OS-specific caveats (Linux sudo, Windows WSL, etc.).

| Requirement | Used for | Install (macOS) |
|-------------|----------|-----------------|
| Node.js ≥ 18 + npm | Everything | [nodejs.org](https://nodejs.org/) or `brew install node` |
| `node_modules/` (electron-builder) | Building | `npm install` |
| `git` with push access | Commit + push version bump | Ships with macOS / `brew install git` |
| `gh` GitHub CLI (authenticated) | Creating release, uploading assets | `brew install gh` then `gh auth login` |
| `dpkg`, `fakeroot`, GNU `ar` | Building `.deb` packages | `brew install dpkg fakeroot binutils` |

> **Note:** Without `dpkg`/`fakeroot`/GNU `ar`, electron-builder produces a malformed ~100-byte `.deb` stub instead of a real Debian package. After `brew install binutils` the build scripts auto-discover Homebrew's GNU `ar` and use it for the build — **no PATH edit needed**.

### Usage

```
./scripts/release.sh [options] <version>
```

| Argument / Option | Description |
|-------------------|-------------|
| `<version>` | Release version, e.g. `v1.2.3` or `1.2.3`. Must be ≥ current `package.json` version. The `v` prefix is optional. Not required when using `--upload-only` (version is read from `package.json`). |
| `--dry-run`, `--simulate` | Simulate the entire release without writing files, committing, or publishing. Shows each artifact that would be uploaded (with file size) and a full preview of the release notes. |
| `--re-release` | Re-publish an already-released version with rebuilt artifacts and refreshed release notes. Re-uses the requested version number (no `package.json` bump needed), generates the changelog against the **previous good tag** (skipping the version being re-released), deletes the existing GitHub release and git tag, and re-creates them pinned to the current `HEAD` commit. Use this to recover from a broken release of the same version. The clean-working-tree and version-gate checks still apply. |
| `--seq` | Build platforms sequentially instead of in parallel (the default). Slower overall, but produces non-interleaved build output — useful for debugging build failures. This is not required for external Windows signing; signing jobs are serialized separately. |
| `--prepare-only` | Run Steps 0–4 only (prereqs check, version bump, build all platforms, commit + push) and exit **before** creating or uploading any GitHub release. Use this to build and inspect artifacts locally before committing to a public release. When ready, complete the release with `--upload-only`. Compatible with `--seq`, `--install-prereqs`, and `--dry-run`. |
| `--upload-only` | Skip Steps 0–4 entirely and jump straight to Step 5 (create GitHub release + upload `dist/` artifacts). The version is read automatically from `package.json` — no version argument needed. Use this after a prior `--prepare-only` run, or when artifacts were produced by another process (e.g. CI). Only `gh` CLI is required — build tools are not checked. Compatible with `--re-release` and `--dry-run`. |
| `--install-prereqs`, `--install-deps` | Auto-install any missing build/release prerequisites before running Step 0 (uses Homebrew on macOS, apt/dnf/pacman on Linux, winget/choco on Windows). Combine with `--dry-run` to preview the install plan only. Tools that are too risky to auto-install (Node major upgrades, `gh auth login`, `.deb` tooling on Windows → WSL) are surfaced as manual steps. **Signing tools and signing-related env vars (`CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*`) are NOT auto-installed** — see the [Code Signing](#code-signing) section. |
| `--sign-script <path>` | Optional path to an external Windows signing script such as Esri's `sign.sh`. Supports absolute, relative (`../../../sign.sh`), and `~` paths, resolved to an absolute path before use. When provided and found/readable, Windows build wrappers skip electron-builder's built-in Windows Authenticode signing for direct signable files in external signing source folders (`dist/win-unpacked` and direct final artifacts in `dist/`), then hooks call the external script with `--run`, auto-populated `--source-dirs` source folders, `--product-names "ArcGIS Velocity Simulator"`, and `--timeout-minutes 20` by default. Nested helpers remain eligible for normal electron-builder/signtool signing. The signing script's output streams live inside the nested signing log, stdin is closed so prompts fail visibly instead of hanging, and each signing process has a hook watchdog timeout of at least 45 minutes (`VELOCITY_SIGN_TIMEOUT_MS=0` disables the watchdog; `VELOCITY_SIGN_PROGRESS_INTERVAL_MS` and `VELOCITY_SIGN_POLL_INTERVAL_MS` control heartbeat logging — see [BUILD.md](./BUILD.md)). If omitted or unusable, the build logs a warning and falls back to the current electron-builder signing/unsigned behavior. |
| `--sign-share-dir <UNC>` | Optional signing share passed to the external signing script as `--share-dir <UNC>`. Only used with `--sign-script`. |
| `--sign-timeout-minutes <minutes>` | Optional external signing script timeout passed to `sign.sh` as `--timeout-minutes <minutes>`. Default: `20`. Must be a positive whole number of minutes. |
| `--sign-product-names <names>` | Optional external signing product names passed to `sign.sh` as `--product-names <names>`. Defaults to `ArcGIS Velocity Simulator`; use comma-separated names for multiple source directories. |
| `--help` | Print usage information and exit. |
| `--list` | List all published GitHub releases for this repository and exit. Requires `gh` CLI to be installed and authenticated. Outputs a table with columns **TAG · DATE · STATUS · URL** — STATUS is colour-coded (● latest, ◐ pre-release, ○ draft). Also prints the local `package.json` version for quick comparison. Pair with `--limit <n>` to control how many are shown (default: 10). |
| `--limit <n>` | Maximum number of releases to show when using `--list`. Default: `10`. |

### Typo Suggestions

Unknown long options use **Levenshtein edit distance** to suggest the closest valid release flag when the typo is close enough:

```text
✖  ERROR:  Unrecognized option: --prepareonly
   Did you mean --prepare-only?
```

Levenshtein distance counts the minimum number of single-character insertions, deletions, and substitutions needed to transform the mistyped flag into a supported flag. This replaced the previous character-overlap heuristic, which only counted shared letters and ignored order; edit distance produces more predictable suggestions for CLI typos such as missing hyphens, omitted characters, or one wrong character.

| Approach | What it does | Pros | Cons | Used by `release.sh`? |
| --- | --- | --- | --- | --- |
| Exact allowlist validation | Accepts only declared flags such as `--dry-run`, `--prepare-only`, and `--upload-only`. | Safest way to decide whether to proceed. | Does not explain likely typos by itself. | **Yes** — the `case` statement remains the source of truth. |
| Character-overlap heuristic | Counts shared characters after stripping leading dashes. | Small and easy to implement in shell. | Ignores order and can choose a weak match when flags share letters. | **No** — replaced. |
| Levenshtein edit distance | Counts insertions, deletions, and substitutions between the typo and each known long flag. | Better for missing hyphens (`--prepareonly`), omitted characters (`--uplod-only`), extra characters, and substitutions. | Adjacent transpositions count as two edits. | **Yes** — used for `Did you mean ...?` suggestions when the edit distance is below a conservative threshold. |
| Damerau-Levenshtein | Adds adjacent transposition as a one-edit operation. | Better for pure swapped-letter typos. | More complex for a portable shell script; current thresholds already cover common transpositions. | No. |

Unknown short flags still show the generic `--help` guidance instead of a suggestion because the short-flag namespace is intentionally small and ambiguous.

### Examples

```bash
# Standard release — does everything
./scripts/release.sh v1.2.3

# Without the 'v' prefix (equivalent)
./scripts/release.sh 1.2.3

# Preview everything without making any changes (highly recommended before a real release)
./scripts/release.sh --dry-run v1.2.3

# Flag order is flexible
./scripts/release.sh v1.2.3 --dry-run

# Re-release the same version after a failed or broken release (deletes existing release + tag first, rebuilds, refreshes notes)
./scripts/release.sh --re-release v1.2.3

# Build platforms sequentially instead of in parallel (clean output, slower)
./scripts/release.sh --seq v1.2.3

# Auto-install any missing prerequisites (brew / apt / winget) before releasing
./scripts/release.sh --install-prereqs v1.2.3

# Preview just the prereq install plan (no install, no release)
./scripts/release.sh --install-prereqs --dry-run v1.2.3

# Two-phase release: build + commit now, upload to GitHub later
./scripts/release.sh --prepare-only v1.2.3
# ... inspect dist/ artifacts, sign them if needed, then:
./scripts/release.sh --upload-only

# Release build with optional external Windows signing
./scripts/release.sh v1.2.3 \
  --sign-script /absolute/path/to/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-product-names "ArcGIS Velocity Simulator"

# Preview release + external signing; invokes sign.sh with its own --dry-run mode
./scripts/release.sh --dry-run v1.2.3 \
  --sign-script ../../../signing/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-product-names "ArcGIS Velocity Simulator"

# Two-phase with sequential build (useful when debugging build output)
./scripts/release.sh --prepare-only --seq v1.2.3
./scripts/release.sh --upload-only

# Upload-only after artifacts were produced externally (e.g. by CI)
./scripts/release.sh --upload-only

# Re-release upload-only: delete existing GitHub release + re-upload freshly built artifacts
./scripts/release.sh --upload-only --re-release

# Preview the upload step without actually publishing
./scripts/release.sh --upload-only --dry-run

# Show help
./scripts/release.sh --help

# List all published releases
./scripts/release.sh --list

# List the 5 most recent releases
./scripts/release.sh --list --limit 5
```

### Two-Phase Release

The `--prepare-only` and `--upload-only` flags split the release pipeline into two independent phases:

| Phase | Flag | Steps run | What it does |
|-------|------|-----------|--------------|
| **Prepare** | `--prepare-only` | 0–4 | Checks prereqs, bumps version, builds all platform artifacts, commits + pushes the version bump. Exits before touching GitHub. |
| **Upload** | `--upload-only` | 5 only | Creates the GitHub release and uploads all `dist/` artifacts. Reads the version from `package.json` — no version argument needed. |

**When to use this:**

- **Inspect before publishing** — run `--prepare-only`, verify the artifacts in `dist/` (size, content, naming), then run `--upload-only` to publish once satisfied.
- **Build on one machine, upload from another** — run `--prepare-only` on your build machine, copy `dist/` to the upload machine, then run `--upload-only` there.
- **CI-produced artifacts** — if your CI pipeline builds the artifacts, run `./scripts/release.sh --upload-only` locally to publish them to GitHub without triggering a rebuild.
- **Staged releases** — prepare multiple versions back-to-back, then upload them in sequence.

> **Note:** `--upload-only` skips the clean-working-tree and prerequisites checks for build tools. Make sure `gh` is authenticated (`gh auth login`) and that `dist/` contains the expected artifacts before running it.

> **Mutual exclusivity:** `--prepare-only` and `--upload-only` cannot be combined — the script will abort with an error if both are passed.

> **Tip:** Always do a `--dry-run` first to preview the release notes and verify the artifact list before publishing.

> **Fresh-machine tip:** On a brand new machine, pass `--install-prereqs` to have the release script install missing build/release tooling (`git`, `gh`, `dpkg`, `fakeroot`, `binutils` on macOS) before doing anything else. Things that are too risky to auto-install (Node major upgrades, `gh auth login`, `.deb` tooling on Windows → WSL) are surfaced as manual steps. **Signing-tool prerequisites are NOT auto-installed** — see the [Code Signing](#code-signing) section.

---

## Overview

Releases are built for three platforms by the local release script (`scripts/release.sh`), which builds all platforms via electron-builder and publishes a GitHub Release using the `gh` CLI:

| Platform | Artifacts |
|----------|-----------|
| macOS | `.dmg` (installer), `.zip` (archive) |
| Windows | `setup.exe` (NSIS installer), `portable.exe`, `win.zip` (x64 archive) |
| Linux | `.AppImage` (universal), `.deb` (Debian/Ubuntu) |

All artifacts are attached to a GitHub Release created by the script.

> **Note:** A previous `.github/workflows/release.yml` GitHub Actions workflow was removed in favour of the local release script, which is more reliable and provides richer release notes, dry-run previews, and re-release recovery.

---

## Manual Release (Local Build, without the Script)

If you need to build and publish without using the release script (e.g. for partial builds or debugging):

```bash
# Build all platforms in parallel (recommended — fastest)
npm run package:all:clean

# Or build all platforms sequentially (useful for debugging interleaved output)
npm run package:seq:clean

# Or build just one platform
npm run package:mac
npm run package:win
npm run package:linux
```

Upload artifacts from `dist/` to a GitHub Release. Use `find` to avoid uploading unpacked directories:

```bash
gh release create v1.2.3 $(find dist -maxdepth 1 -type f) \
  --title "v1.2.3" --generate-notes
```

---

## Host-OS Support Matrix

The release script can run from any of the three host OSes, but each host can only build certain target artifacts natively. macOS is the only host that can do everything.

| Host | `.dmg` (mac) | `.zip` (mac) | `setup.exe` / `portable.exe` / `.zip` (win) | `.AppImage` | `.deb` |
|------|:---:|:---:|:---:|:---:|:---:|
| **macOS**   | ✅ | ✅ | ✅ (unsigned without signtool envs) | ✅ | ✅ (with `brew install dpkg fakeroot binutils`) |
| **Linux**   | ❌ | ❌ | ✅ (unsigned) | ✅ | ✅ |
| **Windows** | ❌ | ❌ | ✅ | ⚠️ via WSL | ⚠️ via WSL |

**Notes:**
- `.dmg` requires a macOS host — electron-builder cannot cross-build it.
- macOS notarization (`xcrun notarytool`) requires a macOS host **and** a paid Apple Developer account.
- Windows code signing requires the `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` env vars to be set, regardless of host. (Cross-host Windows signing via `jsign` is not currently configured.)
- The release script uploads whichever artifacts actually built — missing platforms are skipped silently rather than failing the release.

---


## Code Signing

Unsigned builds work but trigger OS security warnings on first launch. Signing is optional for internal/developer tools but recommended for wider distribution.

### macOS — Apple Developer ID + Notarization

**What you need:**
- An [Apple Developer account](https://developer.apple.com/) (paid, $99/year)
- A **Developer ID Application** certificate exported as a `.p12` file
- An **app-specific password** for your Apple ID (generate at [appleid.apple.com](https://appleid.apple.com))
- Your 10-character **Team ID** (visible in the Apple Developer portal)

**Why it matters:** Without signing + notarization, macOS Gatekeeper blocks the app on first launch with "Apple cannot check it for malicious software". Users can bypass via **System Settings → Privacy & Security → Open Anyway**, but this is unsuitable for distribution.

**Local build with signing:**
```bash
export CSC_LINK=/path/to/DeveloperID.p12      # or base64: $(base64 -i cert.p12)
export CSC_KEY_PASSWORD=your-cert-password
export APPLE_ID=your@apple-id.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
npm run package:mac
```

The same environment variables are picked up automatically when running `./scripts/release.sh` — export them in your shell (or source them from a local, git-ignored `.env` file) before invoking the script.

---

### Windows — Code Signing Certificate

**What you need:**
- A code signing certificate (`.pfx` / `.p12`) from a trusted CA such as:
  - [DigiCert](https://www.digicert.com/signing/code-signing-certificates) — most common
  - [Sectigo (Comodo)](https://sectigo.com/ssl-certificates-tls/code-signing)
  - [GlobalSign](https://www.globalsign.com/en/code-signing-certificate/)
- **EV (Extended Validation)** certificates are strongly recommended — they suppress the SmartScreen warning immediately. Standard OV certificates require a reputation build-up period before SmartScreen stops warning.

**Why it matters:** Without signing, Windows SmartScreen shows "Windows protected your PC" on first run. Users can click **More info → Run anyway**, but this erodes trust.

**Local build with signing:**
```bash
export WIN_CSC_LINK=/path/to/certificate.pfx   # or base64-encoded pfx
export WIN_CSC_KEY_PASSWORD=your-cert-password
npm run package:win
npm run package:win:zip
```

The same environment variables are picked up automatically when running `./scripts/release.sh` — export them in your shell (or source them from a local, git-ignored `.env` file) before invoking the script.

#### Optional external signing script

For release builds, the script can pass optional external signing settings through to the Windows build hooks:

```bash
./scripts/release.sh v1.2.3 \
  --sign-script /absolute/path/to/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-product-names "ArcGIS Velocity Simulator"
```

```bash
./scripts/release.sh --dry-run v1.2.3 \
  --sign-script ~/signing/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-product-names "ArcGIS Velocity Simulator"
```

Both `--sign-script` and `--sign-share-dir` are optional. If the script path is omitted or cannot be found/read, release builds use the same electron-builder signing/unsigned behavior as before. When a script path is provided and readable, the Windows build step injects a path-aware signing hook that skips electron-builder's built-in Authenticode signing for signable `.exe`, `.msi`, and `.msp` files directly in external signing source folders (`dist/win-unpacked` and `dist/`); nested files such as `dist/win-unpacked/resources/elevate.exe` remain eligible for normal electron-builder/signtool signing. The logs show the resolved absolute path and whether it can be used.

When `./scripts/release.sh --dry-run` is used with a valid `--sign-script`, the release script invokes the external signing script with its own `--dry-run` mode for any existing signable Windows files currently under `dist/win-unpacked` or `dist/`. The dry-run invocation does not include `--run`. The normal build hooks still run the external script with `--run` during real Windows builds.

When a valid external script is supplied, the Windows hooks call it with `--run` by default and auto-populate:

| Repo | Auto product name (`--product-names`) | Auto unpacked source (`--source-dirs`) | Final artifact signing |
|------|--------------------------|-----------------------------|------------------------|
| Simulator | `ArcGIS Velocity Simulator` | `/Users/hano4470/github/Esri/arcgis-velocity-simulator/dist/win-unpacked` | The hook signs direct `*.exe`, `*.msi`, and `*.msp` files in `dist/win-unpacked`, then only current generated final artifacts in `dist/` via an exact `--file-mask` value. |

The unpacked phase runs from the `afterSign` hook, after electron-builder has edited Windows executable resources. The path-aware signing hook skips electron-builder/signtool signing for direct top-level signable files in `dist/win-unpacked` (normally `VelocitySimulator.exe`) because this phase signs those files externally. During later package creation, the same hook skips electron-builder signing for direct signable files in `dist/`, leaving nested helper files eligible for normal signtool signing. Final `.zip`, `.dmg`, `.deb`, and `.AppImage` artifacts are not directly signed by this Windows signing script.

External signing invocations are serialized by a cross-process lock at `${TMPDIR}/arcgis-velocity-external-sign.lock` (or the platform temp equivalent). This preserves the required order for each Windows build — sign the unpacked app, package it, then sign the final package artifacts — while still allowing the macOS and Linux platform builds to continue in parallel. The same lock name is used by the companion Logger repository, so two local builds cannot submit external signing jobs at the same time.

---

### Linux — No Signing Required

Linux does not have a standard application signing or notarization mechanism. No certificates are needed. AppImage and DEB packages are distributed as-is.

---

## Signing Summary

| Platform | Required for distribution? | Certificate source | Suppresses warning immediately? |
|----------|---------------------------|--------------------|---------------------------------|
| macOS | Strongly recommended | Apple Developer Program ($99/yr) | Yes, after notarization |
| Windows | Recommended | DigiCert / Sectigo / GlobalSign | Only with EV cert |
| Linux | Not applicable | — | — |

---


## Versioning Convention

Use [Semantic Versioning](https://semver.org/):

| Change type | Version bump | Example |
|-------------|-------------|---------|
| Bug fixes | Patch (`z`) | `1.2.3` → `1.2.4` |
| New features (backward compatible) | Minor (`y`) | `1.2.3` → `1.3.0` |
| Breaking changes | Major (`x`) | `1.2.3` → `2.0.0` |

Tag format: `v` + version — e.g. `v1.2.3`.

---

## Related Documents

- [BUILD.md](./BUILD.md) — Local build scripts, package format comparisons, compression options
- [RELEASE-NOTES.md](./RELEASE-NOTES.md) — User-facing changelog
- [DOCUMENTATION.md](./DOCUMENTATION.md) — Full documentation index

