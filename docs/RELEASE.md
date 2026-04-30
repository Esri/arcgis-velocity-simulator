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
3. **Builds** all platform packages in parallel via `npm run package:all:clean` (mac, win, linux run simultaneously). Pass `--seq` to build sequentially instead.
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
| `<version>` | Release version, e.g. `v1.2.3` or `1.2.3`. Must be ≥ current `package.json` version. The `v` prefix is optional. |
| `--dry-run` | Simulate the entire release without writing files, committing, or publishing. Shows each artifact that would be uploaded (with file size) and a full preview of the release notes. |
| `--re-release` | Re-publish an already-released version with rebuilt artifacts and refreshed release notes. Re-uses the requested version number (no `package.json` bump needed), generates the changelog against the **previous good tag** (skipping the version being re-released), deletes the existing GitHub release and git tag, and re-creates them pinned to the current `HEAD` commit. Use this to recover from a broken release of the same version. The clean-working-tree and version-gate checks still apply. |
| `--seq` | Build platforms sequentially instead of in parallel (the default). Slower overall, but produces non-interleaved build output — useful for debugging build failures. |
| `--install-prereqs` | Auto-install any missing build/release prerequisites before running Step 0 (uses Homebrew on macOS, apt/dnf/pacman on Linux, winget/choco on Windows). Combine with `--dry-run` to preview the install plan only. Tools that are too risky to auto-install (Node major upgrades, `gh auth login`, `.deb` tooling on Windows → WSL) are surfaced as manual steps. **Signing tools and signing-related env vars (`CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*`) are NOT auto-installed** — see the [Code Signing](#code-signing) section. Alias: `--install-deps`. |
| `--help` / `-h` | Print usage information and exit. |

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

# Show help
./scripts/release.sh --help
```

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

