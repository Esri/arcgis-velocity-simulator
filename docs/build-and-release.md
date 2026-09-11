# Build and release

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide covers everything needed to turn a clean checkout into installable
packages and a published GitHub Release: prerequisites, local and multi-platform
builds, per-platform artifacts, code signing, the `scripts/release.sh` release
commands, a release checklist, and troubleshooting.

It is written for developers and maintainers. Node.js 18 or newer and a
completed `npm install` are assumed; publishing additionally requires push
access and an authenticated `gh` CLI.

## Table of contents

- [Prerequisites](#prerequisites)
- [Local builds](#local-builds)
- [Platform packaging](#platform-packaging)
- [Code signing](#code-signing)
- [Release commands](#release-commands)
- [Release checklist](#release-checklist)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Prerequisites

Every `package:*` script verifies its tooling before building. Run the check
manually at any time:

```bash
npm run prereqs:check                  # all build targets
npm run prereqs:check:mac              # macOS build toolchain
npm run prereqs:check:win              # Windows build toolchain
npm run prereqs:check:linux            # Linux toolchain (dpkg, fakeroot, GNU ar)
npm run prereqs:check:release          # build tooling plus git, gh, and gh auth
npm run check:build-prereqs            # backwards-compatible alias for prereqs:check
```

| Requirement | Used for | Install (macOS) |
|-------------|----------|-----------------|
| Node.js ≥ 18 and npm | Everything. | `brew install node` or [nodejs.org](https://nodejs.org/). |
| `node_modules/` (electron-builder) | Building. | `npm install`. |
| `dpkg`, `fakeroot`, GNU `ar` | Building `.deb` packages. | `brew install dpkg fakeroot binutils`. |
| `git` with push access | Committing and pushing the version bump. | Ships with macOS or `brew install git`. |
| `gh` GitHub CLI, authenticated | Creating the release and uploading assets. | `brew install gh` then `gh auth login`. |

> [!WARNING]
> Without `dpkg`, `fakeroot`, and GNU `ar`, electron-builder silently produces a
> malformed ~100-byte `.deb` stub. The system `/usr/bin/ar` on macOS is BSD `ar`
> and causes this; after `brew install binutils` the build scripts auto-discover
> Homebrew's GNU `ar`, so no `PATH` edit is needed.

### Bootstrapping a machine

The prerequisite list comes from `scripts/check-build-prereqs.js`; the installer
in `scripts/install-prereqs.js` knows how to install each item on the host.

```bash
npm run setup                          # npm install plus any missing build prereqs
```

| Command | Installs prerequisites for |
|---------|----------------------------|
| `npm run prereqs:install` | All build targets (no `git` or `gh`). |
| `npm run prereqs:install:mac` | macOS builds. |
| `npm run prereqs:install:win` | Windows builds. |
| `npm run prereqs:install:linux` | Linux builds (`dpkg`, `fakeroot`, GNU `ar` on macOS). |
| `npm run prereqs:install:release` | Build prerequisites plus `git` and `gh`. |

Preview an install plan without changing anything:

```bash
node scripts/install-prereqs.js --dry-run
node scripts/install-prereqs.js --dry-run --release
```

Set `INSTALL_PREREQS=1` to let a build install what it is missing and continue:

```bash
INSTALL_PREREQS=1 npm run package:linux
```

Host behavior and deliberate exclusions:

- **macOS** uses Homebrew.
- **Linux** detects `apt-get`, `dnf`, or `pacman`; privileged installs are reported as manual steps unless the installer is re-run with `--use-sudo` from an interactive terminal. The `gh` CLI is always a manual step on Linux because it requires adding GitHub's apt or dnf repository.
- **Windows** uses `winget` (preferred) or `choco`. `.deb` artifacts cannot be built natively on Windows; use WSL for that target.
- Node major upgrades, `gh auth login`, and every code-signing tool, certificate, or credential (`codesign`, `signtool`, `CSC_LINK`, `WIN_CSC_LINK`, `APPLE_*`) are never auto-installed.

## Local builds

Output is written to `dist/`.

| Script | Platforms | Compression | Notes |
|--------|-----------|-------------|-------|
| `npm run package:mac` | macOS | normal | DMG and ZIP. |
| `npm run package:win` | Windows | normal | NSIS, portable, and ZIP. |
| `npm run package:win:zip` | Windows | normal | ZIP only. |
| `npm run package:linux` | Linux | normal | AppImage and DEB. |
| `npm run package` | All three, in parallel | normal | Same as `package:all`. |
| `npm run package:all` | All three, in parallel | normal | Every artifact for every platform. |
| `npm run package:all:clean` | All three, in parallel | normal | Cleans `dist/` first. |
| `npm run package:seq` | All three, sequentially | normal | Non-interleaved output. |
| `npm run package:mac:max` | macOS | maximum | DMG and ZIP. |
| `npm run package:win:max` | Windows | maximum | NSIS, portable, and ZIP. |
| `npm run package:linux:max` | Linux | maximum | AppImage and DEB. |
| `npm run package:all:max` | All three, in parallel | maximum | |
| `npm run package:all:max:clean` | All three, in parallel | maximum | Cleans `dist/` first. |
| `npm run package:seq:max` | All three, sequentially | maximum | |
| `npm run package:seq:clean` | All three, sequentially | normal | Cleans `dist/` first. |
| `npm run package:seq:max:clean` | All three, sequentially | maximum | Cleans `dist/` first. |
| `npm run clean` | — | — | Deletes `dist/`. |

Build only for the current host while iterating; cross-building a Windows
installer from macOS or Linux is supported but unsigned, and `.dmg` requires a
macOS host.

Compression defaults to `normal`. The `:max` scripts pass
`--config.compression=maximum` at invocation time, producing the same formats in
smaller files at the cost of build time; no configuration file changes are
required.

Parallel builds (`package:all*`, `scripts/timed-parallel-build.js`) stream each
platform's output prefixed with its label and print a summary table at the end.
Sequential builds (`package:seq*`, `scripts/timed-seq-build.js`) run one step at
a time. In both cases a failing step is marked in the summary and the process
exits with a non-zero code.

Key `build` settings in `package.json`:

| Setting | Value | Notes |
|---------|-------|-------|
| `asar` | `true` | Application source is bundled into a single ASAR archive. |
| `compression` | `"normal"` | Default; the `:max` scripts override it at invocation time. |
| `buildResources` | `"src/assets"` | Icons and platform-specific resources. |
| `files` | `src/**/*`, `package.json` | Source files included in the package. |
| `npmRebuild` | `false` | Native modules are not rebuilt. |
| `executableName` | `VelocitySimulator` | Space-free executable and bundle name; `productName` stays `ArcGIS Velocity Simulator` for display metadata. |

## Platform packaging

### macOS

| Format | Artifact | Description |
|--------|----------|-------------|
| DMG | `arcgis-velocity-simulator-{version}-mac.dmg` | Disk image with a drag-to-Applications installer window. |
| ZIP | `arcgis-velocity-simulator-{version}-mac.zip` | Plain archive of the `.app` bundle. |

Use the DMG for user-facing releases and the ZIP for continuous integration or
scripted distribution. Apple Silicon (arm64) and Intel (x64) are both supported.
macOS 12 through 15 are supported, macOS 11 is best-effort, and macOS 10.15 is
not supported because Electron 41 requires macOS 11 or newer.

### Windows

| Format | Artifact | Description |
|--------|----------|-------------|
| NSIS installer | `arcgis-velocity-simulator-{version}-setup.exe` | Guided installer with Start Menu shortcut and uninstaller. |
| Portable executable | `arcgis-velocity-simulator-{version}-portable.exe` | Self-contained executable that needs no installation. |
| ZIP | `arcgis-velocity-simulator-{version}-win.zip` | Plain archive containing the application folder. |

Use the NSIS installer for standard end-user and managed deployments; it is the
only format that creates shortcuts and an Add/Remove Programs entry, and it
requires administrator rights for a system-wide install. Use the portable
executable or the ZIP on shared machines, removable media, and locked-down
environments. Windows 10 (1903 or newer) and Windows 11 are supported; Windows
8.1 and Server 2012 R2 are not, because Electron 41 requires Windows 10 or
newer. Builds are x64 only; add other values to the `arch` array in
`package.json → build.win.target` to produce ia32 or arm64 packages.

Windows executable metadata uses the product name **ArcGIS Velocity Simulator**
for the **Product name** and **File description** fields, while artifact
filenames keep the `arcgis-velocity-simulator` slug prefix for stable,
script-friendly downloads.

### Linux

| Format | Artifact | Description |
|--------|----------|-------------|
| AppImage | `arcgis-velocity-simulator-{version}-linux.AppImage` | Self-contained portable executable. |
| DEB | `arcgis-velocity-simulator-{version}-linux.deb` | Debian and Ubuntu package installed with `apt` or `dpkg`. |

Use the AppImage for broad distribution: it needs no root, runs on any x86_64
distribution with glibc 2.17 or newer, and is removed by deleting the file. Use
the DEB on Debian-family distributions where application-menu integration and
`apt` management matter. Linux builds are produced for the build machine's own
architecture; other architectures require a matching host or continuous
integration environment.

### Host support matrix

| Host | `.dmg` | mac `.zip` | Windows artifacts | `.AppImage` | `.deb` |
|------|:---:|:---:|:---:|:---:|:---:|
| macOS | ✅ | ✅ | ✅ (unsigned without signing variables) | ✅ | ✅ (with `dpkg`, `fakeroot`, `binutils`) |
| Linux | ❌ | ❌ | ✅ (unsigned) | ✅ | ✅ |
| Windows | ❌ | ❌ | ✅ | ⚠️ via WSL | ⚠️ via WSL |

macOS notarization requires a macOS host and a paid Apple Developer account.
Windows signing requires the Windows signing variables regardless of host. The
release script uploads whichever artifacts were actually produced; missing
platforms are skipped rather than failing the release.

## Code signing

Unsigned builds work but trigger operating system warnings on first launch.

| Platform | Required for distribution? | Certificate source | Suppresses the warning immediately? |
|----------|---------------------------|--------------------|-------------------------------------|
| macOS | Strongly recommended. | Apple Developer Program. | Yes, after notarization. |
| Windows | Recommended. | A trusted certificate authority such as DigiCert, Sectigo, or GlobalSign. | Only with an Extended Validation certificate. |
| Linux | Not applicable. | — | — |

### macOS signing and notarization

Without signing and notarization, Gatekeeper blocks the application on first
launch. Export a **Developer ID Application** certificate as a `.p12`, create an
app-specific password for the Apple ID, and note the ten-character Team ID:

```bash
export CSC_LINK=/path/to/DeveloperID.p12      # or a base64-encoded copy
export CSC_KEY_PASSWORD=your-cert-password
export APPLE_ID=your@apple-id.com
export APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
export APPLE_TEAM_ID=XXXXXXXXXX
npm run package:mac
```

`scripts/release.sh` picks up the same variables from the environment.

### Windows signing

Without signing, SmartScreen shows "Windows protected your PC" on first run.
Extended Validation certificates suppress that warning immediately; standard
organization-validated certificates require a reputation build-up period.

```bash
export WIN_CSC_LINK=/path/to/certificate.pfx   # or a base64-encoded copy
export WIN_CSC_KEY_PASSWORD=your-cert-password
npm run package:win
```

For local builds, a self-signed certificate gives the executable a consistent
publisher identity and lets users verify that a binary has not been tampered
with, but it does not remove SmartScreen or Microsoft Defender warnings. Create
one in an elevated PowerShell session:

```powershell
New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject "CN=Esri ArcGIS Velocity Simulator, O=Esri" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -NotAfter (Get-Date).AddYears(5)

$cert = Get-ChildItem -Path "Cert:\CurrentUser\My" -CodeSigningCert |
  Where-Object { $_.Subject -like "*ArcGIS Velocity Simulator*" } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1
Write-Host "Thumbprint: $($cert.Thumbprint)"

$password = Read-Host -AsSecureString "Enter PFX export password"
Export-PfxCertificate -Cert $cert -FilePath ".\certs\selfsigned.pfx"
```

Everything in the repository's `certs` directory is ignored by Git, so a
certificate stored there is never committed. Point electron-builder at it, or
skip signing entirely for a quick local build:

```bash
CSC_LINK=certs/selfsigned.pfx CSC_KEY_PASSWORD="your-password-here" npm run package:win
CSC_IDENTITY_AUTO_DISCOVERY=false npm run package:win
```

`CSC_LINK` accepts either a path to the `.pfx` file or a base64-encoded copy of
its contents, which is convenient in continuous integration.

### External Windows signing script

Windows builds can delegate signing to an external script such as Esri's
`sign.sh`, either from a build:

```bash
npm run package:win -- --sign-script /absolute/path/to/sign.sh
```

or from a release:

```bash
./scripts/release.sh v1.2.3 \
  --sign-script /absolute/path/to/sign.sh \
  --sign-share-dir '\\storm\upload\DigitalSign\Velocity' \
  --sign-product-names "ArcGIS Velocity Simulator"
```

| Option | Required? | Passed to `sign.sh` |
|--------|-----------|---------------------|
| `--sign-script <path>` | Optional | The external script to run. Absolute, relative, and `~` paths are resolved to an absolute path before use. If it is omitted or cannot be found or read, the build logs a warning and falls back to the current electron-builder signing or unsigned behavior. |
| `--sign-share-dir <UNC>` | Optional | `--share-dir <UNC>`. |
| `--sign-timeout-minutes <minutes>` | Optional | `--timeout-minutes <minutes>`. Default `60`; must be a positive whole number. |
| `--sign-product-names <names>` | Optional | `--product-names <names>`. Defaults to `ArcGIS Velocity Simulator`; use comma-separated names for multiple source directories. |

When a usable script is supplied, the Windows build installs a path-aware
signing hook and calls the external script with `--run` and auto-populated
values:

| Signing phase | Auto `--source-dirs` value | Auto `--product-names` value | Files signed |
|---------------|----------------------------|------------------------------|--------------|
| Unpacked application (`afterSign`) | `dist/win-unpacked` | `ArcGIS Velocity Simulator` | Top-level `*.exe`, `*.msi`, and `*.msp` files, normally `VelocitySimulator.exe`, after electron-builder has finished Windows resource editing. |
| Final artifacts (`afterAllArtifactBuild`) | The final artifact folder, normally `dist`. | `ArcGIS Velocity Simulator` | Only the signable final artifacts from the current build, using an exact file mask such as `arcgis-velocity-simulator-<version>-setup.exe;arcgis-velocity-simulator-<version>-portable.exe`. |

The hook skips electron-builder and signtool signing for direct signable files
in those two folders because the external script signs them, while nested
helpers such as `dist/win-unpacked/resources/elevate.exe` remain eligible for
normal electron-builder signing. ZIP, DMG, DEB, and AppImage artifacts are never
signed by this script. Running `./scripts/release.sh --dry-run` with a valid
`--sign-script` invokes the external script in its own dry-run mode, without
`--run`, against existing signable files under `dist/win-unpacked` and `dist/`.

Before each platform build, the wrapper removes existing artifacts for that
platform. The final Windows signing hook also rejects any Simulator artifact
whose filename version differs from `package.json`, so a platform-only retry
cannot submit stale installers or portable executables.

The current Esri signing script mounts SMB shares on macOS with soft,
no-cache semantics and transfers files with visible `rsync` progress. In an
interactive terminal, the wrapper refreshes that progress in place on one
line; redirected logs retain each update as a separate line. Each transfer
uses a `.partial-<pid>` name, verifies the byte size, and atomically renames
the file before submitting or replacing an artifact. Shared staging cleanup
fails closed if stale files cannot be removed.

External signing invocations are serialized by a cross-process lock at
`${TMPDIR}/arcgis-velocity-external-sign.lock` (or the platform temporary-file
equivalent). Because the lock is held only around each invocation,
`npm run package:all:clean` still builds macOS, Windows, and Linux in parallel
while guaranteeing that one signing job runs at a time.

Signing output streams live inside the nested signing log. The script runs with
stdin closed so interactive prompts fail visibly instead of hanging the build,
and each signing process is watched by a timeout of the configured
`--sign-timeout-minutes` value plus a five-minute buffer — 65 minutes with the
default 60-minute script timeout.

| Variable | Default | Description |
|---|---|---|
| `VELOCITY_SIGN_TIMEOUT_MS` | Script timeout plus five minutes. | Watchdog timeout in milliseconds. Set to `0` to disable it. |
| `VELOCITY_SIGN_PROGRESS_INTERVAL_MS` | `30000` | Minimum silence before a "Still waiting" line is printed, and the minimum interval between heartbeat lines. Set to `0` to disable heartbeat logging. |
| `VELOCITY_SIGN_POLL_INTERVAL_MS` | `5000` | How often the silence clock is checked. Must be less than or equal to `VELOCITY_SIGN_PROGRESS_INTERVAL_MS`; it is clamped automatically. |

## Release commands

`scripts/release.sh` is the supported way to cut a release. Run it from the
repository root:

```bash
./scripts/release.sh [options] <version>
```

It verifies tooling and a clean working tree, validates the requested version
against `package.json` and blocks downgrades, bumps the version, builds every
platform with `npm run package:all:clean`, commits and pushes the version bump,
then publishes a GitHub Release with all `dist/` artifacts and generated release
notes.

| Argument or option | Description |
|--------------------|-------------|
| `<version>` | Release version such as `v1.2.3` or `1.2.3`; the `v` prefix is optional. Must be greater than or equal to the current `package.json` version. Not required with `--upload-only`. |
| `--dry-run`, `--simulate` | Simulate the whole release without writing, committing, or publishing. Lists each artifact that would be uploaded with its size and previews the release notes. |
| `--re-release` | Re-publish an already-released version with rebuilt artifacts and refreshed notes. Generates the changelog against the previous good tag, deletes the existing GitHub release and Git tag, and re-creates them pinned to the current `HEAD`. The clean-tree and version-gate checks still apply. |
| `--seq` | Build platforms sequentially instead of in parallel. Slower, but produces non-interleaved output for debugging. Not required for external Windows signing, which is serialized separately. |
| `--prepare-only` | Run the prerequisite check, version bump, build, and commit and push, then exit before touching GitHub. Complete the release later with `--upload-only`. Compatible with `--seq`, `--install-prereqs`, and `--dry-run`. |
| `--upload-only` | Skip straight to creating the GitHub release and uploading `dist/` artifacts. The version is read from `package.json`. Only `gh` is required; build tooling and the clean-tree check are skipped. Compatible with `--re-release` and `--dry-run`. |
| `--install-prereqs`, `--install-deps` | Auto-install missing build and release prerequisites before anything else. Combine with `--dry-run` to preview the plan. Signing tools and signing variables are never auto-installed. |
| `--sign-script <path>` | Path to an external Windows signing script; see [External Windows signing script](#external-windows-signing-script). |
| `--sign-share-dir <UNC>` | Signing share passed to the external script as `--share-dir <UNC>`. Only used with `--sign-script`. |
| `--sign-timeout-minutes <minutes>` | External signing timeout passed as `--timeout-minutes <minutes>`. Default `60`. |
| `--sign-product-names <names>` | External signing product names passed as `--product-names <names>`. Defaults to `ArcGIS Velocity Simulator`. |
| `--list` | List published GitHub releases as a **TAG · DATE · STATUS · URL** table, plus the local `package.json` version. Requires an authenticated `gh`. |
| `--limit <n>` | Maximum number of releases shown by `--list`. Default `10`. |
| `--help` | Print usage information and exit. |

`--prepare-only` and `--upload-only` cannot be combined. Unknown long options
are matched against the supported flags by Levenshtein edit distance, so a close
typo prints a `Did you mean --prepare-only?` suggestion; unknown short flags
print the generic `--help` guidance.

```bash
./scripts/release.sh v1.2.3                                   # standard release
./scripts/release.sh --dry-run v1.2.3                         # preview everything
./scripts/release.sh --re-release v1.2.3                      # rebuild and republish a version
./scripts/release.sh --seq v1.2.3                             # sequential build output
./scripts/release.sh --install-prereqs v1.2.3                 # install missing tooling first
./scripts/release.sh --prepare-only v1.2.3                    # build and commit, publish later
./scripts/release.sh --upload-only                            # publish prepared artifacts
./scripts/release.sh --upload-only --re-release               # replace an existing release
./scripts/release.sh --list --limit 5                         # recent releases
```

Split the pipeline with `--prepare-only` and `--upload-only` to inspect or
externally sign artifacts before publishing, to build on one machine and upload
from another, or to publish artifacts produced by continuous integration.

To publish without the script, build locally and upload with `gh`, using `find`
so unpacked directories are not uploaded:

```bash
npm run package:all:clean
gh release create v1.2.3 $(find dist -maxdepth 1 -type f) \
  --title "v1.2.3" --generate-notes
```

Versions follow [Semantic Versioning](https://semver.org/): patch for fixes,
minor for backward-compatible features, major for breaking changes. Tags are the
version prefixed with `v`, for example `v1.2.3`.

## Release checklist

1. Confirm the working tree is clean and every change is pushed.
2. Run `npm test` and `npm run docs:check-links`.
3. For transport changes, exercise the affected transport in both roles; for XMPP, confirm Direct and Room conversations, the Required, Preferred, and Disabled STARTTLS policies, automatic self-signed and custom trust, headless cleanup, and the password-redaction tests.
4. Verify the packaged Electron runtime still loads the ESM-only `@xmpp/client` dependency, as described in [Developer guide](developer-guide.md#manual-checks).
5. Export any signing variables that apply, or pass `--sign-script` with its options.
6. Preview with `./scripts/release.sh --dry-run <version>` and read the artifact list and release notes.
7. Publish with `./scripts/release.sh <version>`, or with `--prepare-only` followed by `--upload-only`.
8. Confirm the published release with `./scripts/release.sh --list` and download one artifact per platform to verify it launches.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| The `.deb` artifact is about 100 bytes. | `dpkg`, `fakeroot`, or GNU `ar` is missing. Run `npm run prereqs:install:linux` (on macOS, `brew install dpkg fakeroot binutils`) and rebuild. |
| The release aborts before building. | The working tree is dirty or commits are unpushed. Commit or revert the listed files and push, then re-run. |
| The release aborts on the version gate. | The requested version is lower than the `package.json` version. Choose a higher version, or use `--re-release` to republish the same one. |
| `gh` errors while publishing. | `gh` is not installed or not authenticated. Run `npm run prereqs:install:release` and `gh auth login`, then re-run with `--upload-only`. |
| A build fails and the parallel output is unreadable. | Re-run with `npm run package:seq` or `./scripts/release.sh --seq <version>` for non-interleaved output. |
| The external signing script appears to hang. | Its output streams into the nested signing log and a heartbeat is printed after 30 seconds of silence. Tune `VELOCITY_SIGN_PROGRESS_INTERVAL_MS`, or raise or disable the watchdog with `VELOCITY_SIGN_TIMEOUT_MS`. |
| macOS reports that the application cannot be checked for malicious software. | The build is unsigned. Sign and notarize it, or open it once through **System Settings → Privacy & Security → Open Anyway** for local testing. |
| Windows SmartScreen warns on first run. | The build is unsigned or signed with a self-signed or non-Extended-Validation certificate. Use an Extended Validation certificate for distribution. |
| A platform is missing from the published release. | That artifact could not be built on the host. Check the [host support matrix](#host-support-matrix) and rebuild on a supported host. |

## Related documentation

| Document | Purpose |
|----------|---------|
| [Developer guide](developer-guide.md) | Repository structure, local development, tests, debugging, and extension points. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
