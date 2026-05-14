# Build & Package

## Quick Reference

| Script | Platforms | Compression | Notes |
|--------|-----------|-------------|-------|
| `npm run package:mac` | macOS | normal | DMG + ZIP |
| `npm run package:win` | Windows | normal | NSIS + Portable + ZIP |
| `npm run package:win:zip` | Windows | normal | ZIP only |
| `npm run package:linux` | Linux | normal | AppImage + DEB |
| `npm run package` | All three (parallel) | normal | Same as `package:all` |
| `npm run package:all` | All three (parallel) | normal | All artifacts on every platform |
| `npm run package:all:clean` | All three (parallel) | normal | Cleans `dist/` first |
| `npm run package:seq` | All three (sequential) | normal | All artifacts on every platform |
| `npm run package:mac:max` | macOS | maximum | DMG + ZIP |
| `npm run package:win:max` | Windows | maximum | NSIS + Portable + ZIP |
| `npm run package:linux:max` | Linux | maximum | AppImage + DEB |
| `npm run package:all:max` | All three (parallel) | maximum | |
| `npm run package:all:max:clean` | All three (parallel) | maximum | Cleans `dist/` first |
| `npm run package:seq:max` | All three (sequential) | maximum | |
| `npm run clean` | — | — | Deletes `dist/` |
| `npm run package:seq:clean` | All three (sequential) | normal | Cleans `dist/` first |
| `npm run package:seq:max:clean` | All three (sequential) | maximum | Cleans `dist/` first |

Output is written to `dist/`.

---

## Cleaning the Output Directory

To remove all previously built artifacts before a fresh build:

```bash
npm run clean
```

This deletes the entire `dist/` folder. The `:clean` variants do this automatically before building:

| Command | Description |
|---------|-------------|
| `npm run package:all:clean` | Clean `dist/` then parallel build (normal compression) |
| `npm run package:all:max:clean` | Clean `dist/` then parallel build (maximum compression) |
| `npm run package:seq:clean` | Clean `dist/` then sequential build (normal compression) |
| `npm run package:seq:max:clean` | Clean `dist/` then sequential build (maximum compression) |

---

## Build Prerequisites

Before running any `package:*` script, the build verifies that the required tooling is installed. Run the check manually any time:

```bash
npm run prereqs:check                  # all targets (build only)
npm run prereqs:check:linux            # only the Linux toolchain (dpkg, fakeroot, GNU ar)
npm run prereqs:check:release          # also verify git, gh, gh auth (for releases)
npm run check:build-prereqs            # backwards-compat alias for prereqs:check
```

| Requirement | Used for | Install (macOS) |
|-------------|----------|-----------------|
| Node.js ≥ 18 + npm | Everything | `brew install node` or [nodejs.org](https://nodejs.org/) |
| `node_modules/` (electron-builder) | Building | `npm install` |
| `dpkg`, `fakeroot`, GNU `ar` | Building `.deb` packages | `brew install dpkg fakeroot binutils` |

> **Why GNU `ar` matters on macOS:** The system `/usr/bin/ar` is BSD `ar` and silently produces a malformed ~100-byte `.deb` stub. After `brew install binutils` the build scripts auto-discover Homebrew's GNU `ar` — **no PATH edit needed**.

---

## Bootstrapping a Fresh Machine

To get a brand new machine ready for building (or for releasing), use the install scripts that pair with the prereq checker. The list of *what is needed* comes from `scripts/check-build-prereqs.js`; the install scripts know *how to install* each item on the host OS.

### One-liner setup

```bash
npm run setup
```

Runs `npm install` and then attempts to install any missing build prerequisites for the current host. Idempotent — running it twice is a no-op once everything is in place.

### Targeted install

| Command | Installs prereqs for |
|---------|----------------------|
| `npm run prereqs:install` | All targets (build only — no git/gh) |
| `npm run prereqs:install:mac` | macOS-build prereqs |
| `npm run prereqs:install:win` | Windows-build prereqs |
| `npm run prereqs:install:linux` | Linux-build prereqs (`dpkg`, `fakeroot`, GNU `ar` on macOS) |
| `npm run prereqs:install:release` | Build prereqs **plus** `git`, `gh` (for the release script) |

### Auto-heal during a build

Set `INSTALL_PREREQS=1` and any `package:*` script will hand off to the installer when prereqs are missing, then continue:

```bash
INSTALL_PREREQS=1 npm run package:linux
```

### Preview without installing

```bash
node scripts/install-prereqs.js --dry-run
node scripts/install-prereqs.js --dry-run --release
```

Prints the install plan (auto-install commands, manual steps, OS-specific skips) without executing anything.

### Host-OS support and caveats

- **macOS:** Uses Homebrew (`brew install …`).
- **Linux:** Detects `apt-get` / `dnf` / `pacman`. By default, privileged installs are reported as **manual steps** — re-run with `--use-sudo` (interactive TTY required) to auto-install with `sudo`. The `gh` CLI is always reported as a manual step on Linux because it requires adding GitHub's apt/dnf repository, which we won't do silently.
- **Windows:** Uses `winget` (preferred) or `choco`. `.deb` artifacts cannot be built natively on Windows — use **WSL** for that target.

### Things that are never auto-installed

- **Node major upgrades** — too risky to bump the host's Node version automatically. The installer prints a manual instruction.
- **`gh auth login`** — interactive; you must run it yourself after `gh` is on PATH.
- **Code-signing tools and certificates** (`codesign`, `signtool`, `CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*`) — see [RELEASE.md](./RELEASE.md) for the signing setup.

---

## Sequential Build Summary

All `package:seq*` scripts use `scripts/timed-seq-build.js`, which runs each platform step one at a time, prints per-step timing as it goes, and prints a final summary table when all steps complete:

```
════════════════════════════════════════════════════════════
📋 Build Summary  (10:00:00 AM → 10:26:09 AM)
════════════════════════════════════════════════════════════
  Step           Time  Status
──────────────────────────────────────────────────────────
  macOS         12m 4s  ✅ ok
  Windows        8m 2s  ✅ ok
  Linux          6m 3s  ✅ ok
──────────────────────────────────────────────────────────
  ✅ Total       26m 9s
════════════════════════════════════════════════════════════
```

If a step fails, the summary is printed immediately showing which step failed, and the process exits with a non-zero code.

---

## Parallel Build Summary

All `package:all*` scripts use `scripts/timed-parallel-build.js`, which spawns all platform steps at the same time. Each step's output is streamed to the terminal prefixed with its label so output from concurrent steps stays identifiable. A summary table is printed once all steps finish:

```
════════════════════════════════════════════════════════════
⏱  Parallel build started at 10:00:00 AM  (3 steps)
════════════════════════════════════════════════════════════

[macOS  ] ▶  electron-builder --mac  (started 10:00:00 AM)
[Windows] ▶  electron-builder --win  (started 10:00:00 AM)
[Linux  ] ▶  electron-builder --linux  (started 10:00:00 AM)
... interleaved output from all three steps ...

[macOS  ] ✅  12m 4s  (10:00:00 AM → 10:12:04 AM)
[Windows] ✅   8m 2s  (10:00:00 AM → 10:08:02 AM)
[Linux  ] ✅   6m 3s  (10:00:00 AM → 10:06:03 AM)

════════════════════════════════════════════════════════════
📋 Build Summary  (10:00:00 AM → 10:12:04 AM)
════════════════════════════════════════════════════════════
  Step           Time  Status
──────────────────────────────────────────────────────────
  macOS         12m 4s  ✅ ok
  Windows        8m 2s  ✅ ok
  Linux          6m 3s  ✅ ok
──────────────────────────────────────────────────────────
  ✅ Total       12m 4s
════════════════════════════════════════════════════════════
```

> The total time for the parallel build reflects wall-clock elapsed time (i.e. as long as the slowest step), not the sum of all step times.

If any steps fail, all others still complete, and the summary marks failing steps with ❌. The process exits with a non-zero code.

---

## Compression

Default is `normal` (fast builds). Use `:max` variants for smaller distributable files — same formats, smaller sizes, slower build:

```bash
npm run package:mac:max
npm run package:all:max
npm run package:seq:max
```

The `--config.compression=maximum` CLI flag overrides `"compression": "normal"` in `package.json` at invocation time — no config file changes required.

---

## macOS

### Output Formats

| Format | Artifact | Description |
|--------|----------|-------------|
| DMG | `arcgis-velocity-simulator-{version}-mac.dmg` | Disk image with drag-to-Applications installer UI |
| ZIP | `arcgis-velocity-simulator-{version}-mac.zip` | Plain archive; useful for scripted/CI distribution |

### DMG vs ZIP

| | DMG | ZIP |
|--|-----|-----|
| **Installation UX** | Opens a Finder window with a drag-to-Applications prompt | User unzips and moves the `.app` manually |
| **Best for** | End-user distribution — familiar, polished install experience | CI pipelines, automation, developers |
| **Auto-mount** | Yes — double-click to mount | No |
| **File size** | Slightly larger (disk image overhead) | Smallest distributable |

**Use DMG** for user-facing releases. **Use ZIP** for CI artifacts or when you just need the `.app` bundle without packaging overhead.

### Supported macOS Versions

| macOS Version | Name | Status |
|---------------|------|--------|
| 15.x | Sequoia | ✅ Supported |
| 14.x | Sonoma | ✅ Supported |
| 13.x | Ventura | ✅ Supported |
| 12.x | Monterey | ✅ Supported |
| 11.x | Big Sur | ⚠️ Best-effort (Electron 41 minimum is 11.0) |
| 10.15 | Catalina | ❌ Not supported (Electron 41+ requires macOS 11+) |

**Architecture:** Apple Silicon (arm64) and Intel (x64) are both supported. electron-builder produces a universal binary or separate arch targets depending on configuration.

### Code Signing & Notarization

Unsigned builds trigger a Gatekeeper warning on first launch ("app can't be opened because Apple cannot check it for malicious software"). Users can bypass via **System Settings → Privacy & Security → Open Anyway**, but this is not suitable for distribution.

To sign and notarize:

```bash
export CSC_LINK=/path/to/certificate.p12     # or base64-encoded p12
export CSC_KEY_PASSWORD=your-cert-password
export APPLE_ID=your@apple-id.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
npm run package:mac
```

---

## Windows

The packaged Windows app metadata uses the official product name **ArcGIS Velocity Simulator**. This is the value written to the Windows executable **Product name** and **File description** fields. Release artifact filenames intentionally keep the slug prefix `arcgis-velocity-simulator` for stable, script-friendly downloads.

### Output Formats

| Format | Artifact | Description |
|--------|----------|-------------|
| NSIS Installer | `arcgis-velocity-simulator-{version}-setup.exe` | Guided installer with Start Menu shortcut and uninstaller |
| Portable EXE | `arcgis-velocity-simulator-{version}-portable.exe` | Single self-contained executable, no installation required |
| ZIP | `arcgis-velocity-simulator-{version}-win.zip` | Plain archive containing the app folder |

### NSIS Installer vs Portable vs ZIP

| | NSIS Installer | Portable EXE | ZIP |
|--|----------------|--------------|-----|
| **Installation required** | Yes — runs a standard Windows installer | No — run directly | No — unzip and run |
| **Start Menu / Desktop shortcut** | ✅ Created automatically | ❌ | ❌ |
| **Add/Remove Programs entry** | ✅ | ❌ | ❌ |
| **Admin rights required** | Yes (for system-wide install) | No | No |
| **Run from USB / network share** | No | ✅ | ✅ |
| **Best for** | Managed enterprise deployments, end-user installs | Quick use without installing, restricted environments | CI artifacts, scripted distribution |

**Use the NSIS installer** for standard end-user distribution. **Use the portable EXE** when you cannot or do not want to install — e.g. shared machines, USB sticks, or locked-down corporate environments.

### Supported Windows Versions

| Version | Status |
|---------|--------|
| Windows 11 | ✅ Fully supported |
| Windows 10 (1903+) | ✅ Fully supported |
| Windows 10 (< 1903) | ⚠️ Best-effort |
| Windows 8.1 / Server 2012 R2 | ❌ Not supported (Electron 41+ requires Win10+) |

**Architecture:** x64 only (as configured). 32-bit (ia32) and arm64 builds are possible by adding them to the `arch` array in `package.json → build.win.target`.

### Code Signing

Unsigned builds trigger a Windows SmartScreen warning ("Windows protected your PC"). Users can click **More info → Run anyway**, but this degrades trust for end users.

To sign:

```bash
export WIN_CSC_LINK=/path/to/certificate.pfx   # or base64-encoded pfx
export WIN_CSC_KEY_PASSWORD=your-cert-password
npm run package:win
```

EV (Extended Validation) certificates suppress the SmartScreen warning immediately without requiring a reputation build-up period.

#### Optional external signing script

Windows builds can also call an external signing script, such as Esri's `sign.sh`, by passing an optional script path to the build wrapper:

```bash
npm run package:win -- --sign-script /absolute/path/to/sign.sh
```

Short aliases are available:

| Option | Alias | Required? | Passed to `sign.sh` |
|--------|-------|-----------|---------------------|
| `--sign-script <path>` | `-x <path>` | Optional | External script to run. Supports absolute, relative (`../../../sign.sh`), and `~` paths, resolved to an absolute path before use. If omitted or not found/readable, the build logs a warning and falls back to the current electron-builder signing/unsigned behavior. When found, the build logs the resolved path before invoking it. |
| `--sign-share-dir <UNC>` | `-d <UNC>` | Optional | `-sd <UNC>` / `--share-dir <UNC>` |
| `--sign-arg <arg>` | `-a <arg>` | Optional, repeatable | Extra argument appended to the signing command, useful for `--jenkins-email-to`, `--jenkins-api-token`, `--smb-user`, `--smb-pass`, `--quiet`, or a test-only `--dry-run`. |

The external signing hook auto-populates these values for this repo:

| Signing phase | Auto `--source-dirs` value | Auto `--product-names` value | Files signed |
|---------------|----------------------------------|--------------------------------------|--------------|
| Windows unpacked app (`afterPack`) | `dist/win-unpacked` | `ArcGIS Velocity Simulator` | Top-level files matching `*.exe;*.msi;*.msp` in `win-unpacked` (normally `ArcGIS Velocity Simulator.exe`). |
| Final Windows artifacts (`afterAllArtifactBuild`) | The final artifact folder, normally `dist` | `ArcGIS Velocity Simulator` | Only the generated signable final artifacts from the current build, using an exact file mask such as `arcgis-velocity-simulator-<version>-setup.exe;arcgis-velocity-simulator-<version>-portable.exe`. ZIP files are not signed directly. |

The hook calls the external script with `--run` by default:

```bash
bash /absolute/path/to/sign.sh --run \
  --source-dirs /Users/hano4470/github/Esri/arcgis-velocity-simulator/dist/win-unpacked \
  --product-names "ArcGIS Velocity Simulator"
```

If `--sign-share-dir` is supplied, the hook adds `--share-dir <UNC>`. Extra `--sign-arg` values are appended last so you can pass Jenkins, SMB, quiet, or test-only dry-run settings. Examples use full option names for readability:

```bash
npm run package:win -- \
  --sign-script /absolute/path/to/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-arg --jenkins-email-to --sign-arg build@example.com \
  --sign-arg --jenkins-api-token --sign-arg "$JENKINS_API_TOKEN"
```

```bash
npm run package:win -- \
  --sign-script ../../../signing/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-arg --quiet
```

---

## Linux

### Output Formats

| Format | Artifact | Description |
|--------|----------|-------------|
| AppImage | `arcgis-velocity-simulator-{version}-linux.AppImage` | Self-contained portable executable, runs on most distros |
| DEB | `arcgis-velocity-simulator-{version}-linux.deb` | Debian/Ubuntu package, installs via `apt`/`dpkg` |

### AppImage vs DEB

| | AppImage | DEB |
|--|----------|-----|
| **Installation** | None — `chmod +x app.AppImage && ./app.AppImage` | `sudo dpkg -i app.deb` or `sudo apt install ./app.deb` |
| **Root required** | No | Yes |
| **System integration** | None by default (no app menu entry) | Full — app menu, desktop shortcut, `apt` management |
| **Uninstall** | Delete the file | `sudo apt remove arcgis-velocity-simulator` |
| **Distro compatibility** | Any x86_64 Linux with glibc 2.17+ | Debian-family only (Ubuntu, Debian, Mint, etc.) |
| **Run from USB / network** | ✅ | ❌ must be installed first |
| **Multiple versions side-by-side** | ✅ trivial | ⚠️ requires manual workarounds |
| **Best for** | Broad compatibility, no-install scenarios | Ubuntu/Debian users who want native system integration |

**Use AppImage** when distributing broadly or to users who may be on any Linux distro.  
**Use DEB** for Ubuntu/Debian environments where system integration (app menu, `apt upgrade`) matters.

### Supported Linux Distributions

#### AppImage — broadly portable

Runs on any x86_64 distribution with **glibc 2.17+** (standard since ~2012):

| Distribution | Versions |
|--------------|----------|
| Ubuntu | 20.04 LTS, 22.04 LTS, 24.04 LTS |
| Debian | 10 (Buster), 11 (Bullseye), 12 (Bookworm) |
| Fedora | 38, 39, 40, 41 |
| RHEL / Rocky / AlmaLinux | 8, 9 |
| Arch Linux / Manjaro | Rolling |
| openSUSE Leap | 15.5, 15.6 |
| Linux Mint | 20, 21, 22 |
| Pop!_OS | 22.04 |
| elementary OS | 7.x |
| Zorin OS | 16, 17 |

#### DEB — Debian-family only

| Distribution | Versions |
|--------------|----------|
| Ubuntu | 20.04 LTS, 22.04 LTS, 24.04 LTS |
| Debian | 10, 11, 12 |
| Linux Mint | 20, 21, 22 |
| Pop!_OS | 22.04 |
| elementary OS | 7.x |
| Zorin OS | 16, 17 |

> **Note:** Linux builds are produced on the build machine's host architecture. Cross-architecture builds (e.g. arm64 for Raspberry Pi) require additional tooling or a CI environment with the target architecture.

---

## Key Build Settings (`package.json → "build"`)

| Setting | Value | Notes |
|---------|-------|-------|
| `asar` | `true` | App source bundled into a single ASAR archive |
| `compression` | `"normal"` | Default; `:max` scripts override at invocation time |
| `buildResources` | `"src/assets"` | Icons and platform-specific resources |
| `files` | `src/**/*`, `package.json` | Source files included in the package |
| `npmRebuild` | `false` | Native modules not rebuilt (not needed) |

---

## Single-Platform Dev Build (fastest)

Build only for your current OS to iterate quickly:

| Command | Platform |
|---------|---------|
| `npm run package:mac` | macOS |
| `npm run package:win` | Windows |
| `npm run package:linux` | Linux |

Cross-platform builds (e.g. building a Windows installer from macOS) require Wine or a CI environment with the target OS and are typically handled in a CI pipeline rather than locally.

---

## Publishing a Release

For the full release workflow — including how to run `scripts/release.sh`, version tagging, code signing recommendations for each platform, and manual upload steps — see **[RELEASE.md](./RELEASE.md)**.

