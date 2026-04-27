# Release Process

This document covers how to publish a new release of ArcGIS Velocity Simulator — both via **GitHub Actions (automated)** and **locally (manual)**. For build script details and package format comparisons, see [BUILD.md](./BUILD.md).

---

## Overview

Releases are built for three platforms automatically by GitHub Actions when a version tag is pushed:

| Platform | Artifacts |
|----------|-----------|
| macOS | `.dmg` (installer), `.zip` (archive) |
| Windows | `setup.exe` (NSIS installer), `portable.exe`, `win.zip` (x64 archive) |
| Linux | `.AppImage` (universal), `.deb` (Debian/Ubuntu) |

All artifacts are attached to a GitHub Release created automatically from the tag.

---

## Automated Release via GitHub Actions

### Workflow Location

`.github/workflows/release.yml`

### Trigger

Push a version tag matching `v*`. The workflow also supports manual dispatch from the GitHub Actions UI (`workflow_dispatch`).

### Step-by-Step

1. **Bump the version** in `package.json`:
   ```bash
   # Edit package.json and set "version": "x.y.z"
   # Then commit:
   git add package.json
   git commit -m "chore: bump version to x.y.z"
   ```

2. **Push the commit and tag**:
   ```bash
   git tag v1.2.3
   git push origin main
   git push origin v1.2.3
   ```

3. **Monitor the workflow** — go to the repo's **Actions** tab on GitHub. Three parallel build jobs run (macOS, Windows, Linux), then the `release` job collects all artifacts and creates the GitHub Release.

4. **Verify the release** — go to the **Releases** page. The release will contain auto-generated release notes (based on commits since the last tag) and all platform artifacts attached.

> **Note:** `package.json → "version"` controls the filenames of built artifacts (e.g. `arcgis-velocity-simulator-1.2.3-mac.dmg`). Always bump it before tagging.

---

## Manual Release (Local Build)

If you need to build and upload a release without CI:

```bash
# Build all platforms sequentially (includes Windows ZIP)
npm run package:seq:clean

# Or build just one platform
npm run package:mac
npm run package:win
npm run package:linux
```

Artifacts are written to `dist/`. Upload them manually to a GitHub Release via the web UI or the `gh` CLI:

```bash
gh release create v1.2.3 dist/* --title "v1.2.3" --generate-notes
```

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

**GitHub Actions with signing** — add these repository secrets (`Settings → Secrets and variables → Actions`):

| Secret | Value |
|--------|-------|
| `APPLE_CSC_LINK` | Base64-encoded `.p12`: `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CSC_KEY_PASSWORD` | Password for the `.p12` |
| `APPLE_ID` | Your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character team ID |

Then update the macOS build step in `.github/workflows/release.yml`:
```yaml
- name: Build (macOS)
  if: runner.os == 'macOS'
  run: npm run package:mac
  env:
    CSC_LINK: ${{ secrets.APPLE_CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.APPLE_CSC_KEY_PASSWORD }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

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

**GitHub Actions with signing** — add these repository secrets:

| Secret | Value |
|--------|-------|
| `WIN_CSC_LINK` | Base64-encoded `.pfx`: `base64 -i cert.pfx \| pbcopy` |
| `WIN_CSC_KEY_PASSWORD` | Password for the `.pfx` |

Then update the Windows build step in `.github/workflows/release.yml`:
```yaml
- name: Build (Windows)
  if: runner.os == 'Windows'
  run: |
    npm run package:win
    npm run package:win:zip
  env:
    CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
    CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

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

## GitHub Actions Infrastructure

No self-hosted build machine is needed. GitHub-hosted runners provide all three platforms:

| Runner | Platform | What's built |
|--------|----------|-------------|
| `macos-latest` | macOS 14 (Sonoma) | `.dmg`, `.zip` |
| `windows-latest` | Windows Server 2022 | `setup.exe`, `portable.exe`, `win.zip` |
| `ubuntu-latest` | Ubuntu 22.04 | `.AppImage`, `.deb` |

Build time is approximately **5–15 minutes** per platform (parallel). The `release` job that creates the GitHub Release runs only after all three builds succeed.

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

