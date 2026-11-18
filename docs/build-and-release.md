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
- [Tauri builds](#tauri-builds)
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

Electron output is written to `dist/electron/<platform>-<arch>/`. Each build
cleans only its selected runtime, platform and architecture, preserving other
targets. Successful builds write a target manifest alongside the packages.

| Script | Platforms | Compression | Notes |
|--------|-----------|-------------|-------|
| `npm run package:mac` | macOS | normal | DMG and ZIP. |
| `npm run package:win` | Windows | normal | NSIS, portable, and ZIP. |
| `npm run package:win:zip` | Windows | normal | ZIP only. |
| `npm run package:linux` | Linux | normal | AppImage and DEB. |
| `npm run package` | All three, in parallel | normal | Same as `package:all`. |
| `npm run package:all` | All three, in parallel | normal | Every artifact for every platform. |
| `npm run package:all:clean` | All three, in parallel | normal | Cleans selected Electron outputs. |
| `npm run package:seq` | All three, sequentially | normal | Non-interleaved output. |
| `npm run package:mac:max` | macOS | maximum | DMG and ZIP. |
| `npm run package:win:max` | Windows | maximum | NSIS, portable, and ZIP. |
| `npm run package:linux:max` | Linux | maximum | AppImage and DEB. |
| `npm run package:all:max` | All three, in parallel | maximum | |
| `npm run package:all:max:clean` | All three, in parallel | maximum | Cleans selected Electron outputs. |
| `npm run package:seq:max` | All three, sequentially | maximum | |
| `npm run package:seq:clean` | All three, sequentially | normal | Cleans selected Electron outputs. |
| `npm run package:seq:max:clean` | All three, sequentially | maximum | Cleans selected Electron outputs. |
| `npm run clean` | — | — | Deletes `dist/`. |

Build only for the current host while iterating. Windows cross-builds from
macOS or Linux need a configured signing workflow to be signed; `.dmg`
packaging requires macOS.

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

## Tauri builds

Tauri is an additional desktop host, not an electron-builder target. It uses
the system webview and a bundled Node.js process running the same application
backend. The end user does not install Node.js. Existing `package:*` commands
remain Electron commands; select Tauri explicitly:

The public edition names are **Standalone** for Electron and **Compact** for
Tauri. Filenames use `standalone` and `compact`; internal CLI selectors,
configuration directories and source modules retain `electron` and `tauri`.

```bash
npm run package:tauri
npm run package:runtime -- --runtime both --platform mac --arch arm64
npm run package:runtime -- --runtime tauri --platform win --arch x64 --distribution portable
npm run package:runtime -- --runtime tauri --platform linux --arch x64
npm run package:runtime -- --runtime both --platform mac --dry-run
```

By default, Compact requires a matching native OS and architecture. On macOS,
`--windows-cross` enables a Windows cross-build and `--linux-container` enables
the local Linux route below. Other unsupported combinations fail rather than
bundling the wrong Node executable. No universal macOS bundle is produced.

For Windows cross-builds on macOS, install the host tools and selected Rust
target:

```bash
brew install llvm lld nsis
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run package:runtime -- --runtime tauri --platform win --arch x64 --windows-cross
```

The wrapper discovers standard Homebrew LLVM/LLD paths without changing the
shell configuration. It stages the official Windows Node executable, checks
its PE architecture, cross-compiles with `cargo-xwin`, and uses macOS-native
ZIP and NSIS tools. The external Windows signer runs on the Mac at application
and final-installer boundaries. A cross-build is not a Windows runtime smoke
test; verify the packages on a supported Windows system.

To build Linux ARM64 packages from an Apple Silicon Mac with a running local
Docker engine:

```bash
npm run package:runtime -- --runtime tauri --platform linux --arch arm64 --linux-container
```

The container uses Linux Node.js, Rust, and WebKitGTK rather than macOS
executables. The Docker engine must be installed and started separately; the
packaging command never installs host tools. Use `--runtime both` to package
Standalone and Compact, or `--dry-run` to inspect target selection without
starting a container. A dry run does not verify engine readiness.

Only a local Docker socket is accepted. The helper creates an isolated source
snapshot without `.git`, ignored credentials, or host dependencies, and mounts
that snapshot read-only. New untracked build inputs require explicit review;
symlink inputs are rejected. The container runs without privileged mode or
host-device access. Compact packages are checked for native ELF architecture,
headless help, and invalid-argument exit status before output promotion, without
a display server or FUSE. Failed builds leave existing output packages intact.

The Node.js and Rust base images are pinned by digest. System dependencies are
installed from the image's configured package repositories and their versions
are recorded in the manifest; these builds are not claimed to be byte-for-byte
reproducible. The Compact container uses Debian 12 with glibc 2.36; see
[Installation](installation.md) for target-system requirements.
Validated artifacts replace only
`dist/<runtime>/linux-<architecture>/`. Their manifest records the container
image, source digest, native architecture, and installed package versions.

| Prerequisite | Applies to |
|---|---|
| Rust and Cargo plus the platform compiler/SDK. | Every Tauri build. |
| Xcode Command Line Tools, `codesign`, `ditto`, and `hdiutil`. | macOS. |
| Microsoft C++ build tools and WebView2. | Windows. |
| NSIS `makensis` on PATH. | Windows portable EXE assembly. |
| WebKitGTK 4.1 development libraries and native packaging tools. | Linux; the supplied container uses Debian 12 with glibc 2.36. |

`scripts/prepare-tauri.js` downloads the exact official Node version pinned in
`package.json → tauriRuntime.nodeVersion`, verifies its SHA-256 against the
official checksum list, and stages production dependencies under
`src-tauri/resources/`. Downloads are cached in `.tauri/downloads/`; a checksum
mismatch fails the build. Only browser assets are staged in `.tauri/frontend/`.
Generated resources, build outputs and caches are ignored by Git.
Quit any preview running from the build directory before rebuilding it.

| Option | Values and default |
|---|---|
| `--runtime` | `electron`, `tauri`, or `both`; default `electron`. |
| `--platform` | `mac`, `win`, `linux`, or `all`; default current host. Compact requires matching native targets unless an explicit cross-build option is selected. |
| `--arch` | `x64` or `arm64`; default native architecture except Windows Standalone and macOS Windows cross-builds default to `x64`. |
| `--distribution` | `portable`, `installer`, or `both`; default `both`. |
| `--linux-container` | Build selected Linux targets in a local Docker container; off by default. Cannot be combined with `--dev`. |
| `--windows-cross` | Build Compact Windows targets on macOS with the cross toolchain; off by default. Cannot be combined with `--dev`. |
| `--dry-run` | Print targets without writing or building. |
| `--dev` | Run Tauri development mode after staging its resources. |

Portable selects macOS ZIP, Windows ZIP and portable EXE, or Linux AppImage.
Installer selects DMG, NSIS setup EXE, or DEB. Windows portable EXE uses a
user-level NSIS self-extracting launcher: it extracts the complete runtime into
a temporary directory, forwards arguments, waits for exit, and does not create
registry installation entries or shortcuts. WebView2 must already be present
for portable Windows packages. The NSIS installer can provision WebView2.

Tauri output is written to `dist/tauri/<platform>-<arch>/`. Both runtimes use
`arcgis-velocity-simulator-<version>-<edition>-<platform>-<arch>` followed by
the extension, or `-setup.exe` / `-portable.exe` for Windows executables.
Each target has a similarly named `-manifest.json` recording artifact names,
sizes, SHA-256 hashes, source commit and whether the source tree was dirty.
The commit field is the build's base commit, not proof that uncommitted changes
were absent. Container snapshots preserve the host checkout's commit and dirty
flag through a validated source metadata file rather than creating a synthetic
Git history. The internal `VELOCITY_BUILD_SOURCE_FILE` environment variable
names this JSON file with a full `commit` SHA and boolean `dirty` value.
These local packaging commands never commit, push or publish.
Linux Compact binaries use `VelocitySimulator-compact` so installation does
not replace the Standalone executable. The other platforms keep
`VelocitySimulator` as the executable name inside distinct application bundles.

For Tauri macOS distribution, configure `APPLE_SIGNING_IDENTITY` and the
appropriate Apple notarization credentials before building. The wrapper signs
the embedded Node executable with JIT entitlements before Tauri bundles the
application; without a Developer ID it uses ad hoc signing only. Tauri Windows
can use the same `--sign-script` options through a per-file adapter, including
the portable launcher. An explicitly requested unreadable Tauri signer fails
the build. The Electron `CSC_*` settings do not automatically configure Tauri.

## Platform packaging

In the filenames below, `<edition>` is `standalone` or `compact` and `<arch>` is
`x64` or `arm64`. Install and webview requirements are owned by
[Installing and running the application](installation.md).

### macOS

| Format | Artifact | Description |
|--------|----------|-------------|
| DMG | `arcgis-velocity-simulator-<version>-<edition>-mac-<arch>.dmg` | Disk image with a drag-to-Applications installer window. |
| ZIP | `arcgis-velocity-simulator-<version>-<edition>-mac-<arch>.zip` | Plain archive of the `.app` bundle. |

Use the DMG for user-facing releases and the ZIP for continuous integration or
scripted distribution. Apple Silicon (arm64) and Intel (x64) are both supported.
macOS 12 through 15 are supported, macOS 11 is best-effort, and macOS 10.15 is
not supported because Electron 41 requires macOS 11 or newer.

### Windows

| Format | Artifact | Description |
|--------|----------|-------------|
| NSIS installer | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>-setup.exe` | Guided installer with Start Menu shortcut and uninstaller. |
| Portable executable | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>-portable.exe` | Self-extracting application launcher without application installation. |
| ZIP | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>.zip` | Plain archive containing the application folder. |

Use the NSIS installer for standard end-user and managed deployments; it is the
only format that creates shortcuts and an Add/Remove Programs entry, and it
requires administrator rights for a system-wide install. Use the portable
executable or the ZIP on shared machines, removable media, and locked-down
environments. Windows 10 (1903 or newer) and Windows 11 are supported; Windows
8.1 and Server 2012 R2 are not, because Electron 41 requires Windows 10 or
newer. Electron wrapper builds default to x64; use
`npm run package:runtime -- --runtime electron --platform win --arch arm64`
to select ARM64 explicitly.

Windows Standalone executable metadata uses **ArcGIS Velocity Simulator Standalone**
for the **Product name** and **File description** fields, while artifact
filenames keep the `arcgis-velocity-simulator` slug prefix for stable,
script-friendly downloads.

### Linux

| Format | Artifact | Description |
|--------|----------|-------------|
| AppImage | `arcgis-velocity-simulator-<version>-<edition>-linux-<arch>.AppImage` | Portable package for compatible distributions. |
| DEB | `arcgis-velocity-simulator-<version>-<edition>-linux-<arch>.deb` | Debian and Ubuntu package installed with `apt` or `dpkg`. |

Use an AppImage whose architecture and runtime requirements match the target
distribution; it needs no package installation and is removed by deleting the file. Use
the DEB on Debian-family distributions where application-menu integration and
`apt` management matter. Linux builds are produced for the build machine's own
architecture; other architectures require a matching host or continuous
integration environment.

### Host support matrix

This matrix describes Electron packaging only. See [Tauri builds](#tauri-builds)
for native-host and local Linux container options.

| Host | `.dmg` | mac `.zip` | Windows artifacts | `.AppImage` | `.deb` |
|------|:---:|:---:|:---:|:---:|:---:|
| macOS | ✅ | ✅ | ✅ (unsigned without signing variables) | ✅ | ✅ (with `dpkg`, `fakeroot`, `binutils`) |
| Linux | ❌ | ❌ | ✅ (unsigned) | ✅ | ✅ |
| Windows | ❌ | ❌ | ✅ | ⚠️ via WSL | ⚠️ via WSL |

macOS notarization requires a macOS host and a paid Apple Developer account.
Windows signing requires certificate configuration or the external signer. The
release script requires complete, checksum-verified manifests for every
selected runtime and platform. Missing selected targets fail the release.

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

Users installing an unsigned test package should follow
[Installing and running the application](installation.md#unsigned-package-workaround).

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

The repository-local
[Build, sign and release skill](../.github/skills/build-sign-release/SKILL.md)
locates the existing tools. An optional ignored `.release.local.json` can hold
a personal `signScript` path. This is a discovery hint for the skill, not an
automatically loaded release-script configuration; pass `--sign-script`
explicitly. The external tool owns its own configuration.

Windows builds can delegate signing to an external script such as Esri's
`sign.sh`, either from a build:

```bash
npm run package:win -- --sign-script /absolute/path/to/sign.sh
```

or from a release:

```bash
./scripts/release.sh v1.2.3 \
  --sign-script /absolute/path/to/sign.sh \
  --sign-share-dir '\\fileserver\signing\Velocity' \
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
| Unpacked application (`afterSign`) | `dist/electron/win-<arch>/win-unpacked` (or `win-arm64-unpacked`). | `ArcGIS Velocity Simulator` | Top-level `*.exe`, `*.msi`, and `*.msp` files, normally `VelocitySimulator.exe`, after electron-builder has finished Windows resource editing. |
| Final artifacts (`afterAllArtifactBuild`) | `dist/electron/win-<arch>/`. | `ArcGIS Velocity Simulator` | Only the current build's signable artifacts, selected by exact filename. |

The hook skips electron-builder and signtool signing for direct signable files
in those two folders because the external script signs them, while nested
helpers beneath the unpacked application's `resources/` remain eligible for
normal electron-builder signing. ZIP, DMG, DEB, and AppImage artifacts are never
signed by this script. Running `./scripts/release.sh --dry-run` with a valid
`--sign-script` invokes the external script in its own dry-run mode, without
`--run`, against existing signable files under the selected Electron output
directories. Legacy top-level `dist/` output is also recognized by this preview.

Before each platform build, the wrapper removes existing artifacts for that
runtime/platform/architecture only. The final Windows signing hook rejects any Simulator artifact
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
against `package.json` and blocks downgrades, synchronizes the package and lock
versions, builds selected targets, and commits and pushes the version bump.
It validates selected manifests and checksums, creates a draft GitHub Release,
uploads packages and manifests, and publishes only after all uploads succeed.
An interrupted upload leaves a draft rather than an incomplete public release.

| Argument or option | Description |
|--------------------|-------------|
| `<version>` | Release version such as `v1.2.3` or `1.2.3`; the `v` prefix is optional. Must be greater than or equal to the current `package.json` version. Not required with `--upload-only`. |
| `--runtime electron\|tauri\|both` | Select runtimes; default `electron`. |
| `--platform mac\|win\|linux\|all` | Select platforms; default `all` for Electron, current host for Tauri or both. |
| `--arch x64\|arm64` | Select one architecture; upload-only without this option includes available architectures for each selected target. |
| `--distribution portable\|installer\|both` | Select required package formats; default `both`. |
| `--linux-container` | Build Linux targets in a local Docker container; requires a running engine. Does not affect upload-only artifact selection. |
| `--windows-cross` | Build Compact Windows targets on macOS with the cross toolchain; build-only, not an upload selector. |
| `--notes-file <path>` | Use a reviewed Markdown release body verbatim instead of generated commit notes. Preview it with `--dry-run` before publishing. |
| `--dry-run`, `--simulate` | Preview without writing, committing, or publishing. Upload-only validates and lists existing assets; a build preview does not advertise files that have not been built. |
| `--re-release` | Re-publish an already-released version with rebuilt artifacts and refreshed notes. Generates the changelog against the previous good tag, deletes the existing GitHub release and Git tag, and re-creates them pinned to the current `HEAD`. The clean-tree and version-gate checks still apply. |
| `--seq` | Build platforms sequentially instead of in parallel. Slower, but produces non-interleaved output for debugging. Not required for external Windows signing, which is serialized separately. |
| `--prepare-only` | Run the prerequisite check, version bump, build, and commit and push, then exit before touching GitHub. Complete the release later with `--upload-only`. Compatible with `--seq`, `--install-prereqs`, and `--dry-run`. |
| `--upload-only` | Validate selected target manifests and upload their artifacts. The version is read from `package.json`. Build tooling and the clean-tree check are skipped. Node.js, Git, and authenticated `gh` remain required. |
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

To assemble builds from native workers, preserve each worker's
`dist/<runtime>/<platform>-<arch>/` directory and its manifest, then preview and
publish the selected matrix:

```bash
./scripts/release.sh --upload-only --runtime both --platform all --dry-run
./scripts/release.sh --upload-only --runtime both --platform all
```

Versions follow [Semantic Versioning](https://semver.org/): patch for fixes,
minor for backward-compatible features, major for breaking changes. Tags are the
version prefixed with `v`, for example `v1.2.3`.

## Release checklist

1. Confirm the working tree is clean and every change is pushed.
2. Run `npm test` and `npm run docs:check-links`.
3. For transport changes, exercise the affected transport in both roles; for XMPP, confirm Direct and Room conversations, the Required, Preferred, and Disabled STARTTLS policies, automatic self-signed and custom trust, headless cleanup, and the password-redaction tests.
4. Verify each selected packaged runtime loads the ESM-only `@xmpp/client` dependency and starts both its GUI and headless workflows.
5. Export any signing variables that apply, or pass `--sign-script` with its options.
6. Preview with `./scripts/release.sh --dry-run <version>` and read the artifact list and release notes.
7. Publish with `./scripts/release.sh <version>`, or with `--prepare-only` followed by `--upload-only`.
8. Confirm the published release with `./scripts/release.sh --list` and download one artifact per platform to verify it launches.

For a complete seven-format release, verify the exact installer, portable EXE,
Windows ZIP, AppImage, DEB, DMG, and macOS ZIP files rather than assuming a
successful script produced every target. Check each embedded application
version and source against the same committed revision, verify Windows
Authenticode signatures and macOS bundle signatures as applicable, and record
architecture, size, and SHA-256 for every uploaded asset. Do not upload stale
files, block maps, build logs, or unpacked directories as installable packages.

## Troubleshooting

| Symptom | Cause and fix |
|---------|---------------|
| The `.deb` artifact is about 100 bytes. | `dpkg`, `fakeroot`, or GNU `ar` is missing. Run `npm run prereqs:install:linux` (on macOS, `brew install dpkg fakeroot binutils`) and rebuild. |
| The release aborts before building. | The working tree is dirty or commits are unpushed. Commit or revert the listed files and push, then re-run. |
| The release aborts on the version gate. | The requested version is lower than the `package.json` version. Choose a higher version, or use `--re-release` to republish the same one. |
| `gh` errors while publishing. | `gh` is not installed or not authenticated. Run `npm run prereqs:install:release` and `gh auth login`, then re-run with `--upload-only`. |
| A build fails and the parallel output is unreadable. | Re-run with `npm run package:seq` or `./scripts/release.sh --seq <version>` for non-interleaved output. |
| The external signing script appears to hang. | Its output streams into the nested signing log and a heartbeat is printed after 30 seconds of silence. Tune `VELOCITY_SIGN_PROGRESS_INTERVAL_MS`, or raise or disable the watchdog with `VELOCITY_SIGN_TIMEOUT_MS`. |
| macOS reports that the application is damaged or cannot be checked for malicious software. | The build is unsigned or not notarized. Use a signed and notarized package for distribution. User launch troubleshooting belongs in [Installing and running the application](installation.md#troubleshooting). |
| Windows SmartScreen warns on first run. | The build is unsigned or signed with a self-signed or non-Extended-Validation certificate. Use an Extended Validation certificate for distribution. |
| A platform is missing from the published release. | That artifact could not be built on the host. Check the [host support matrix](#host-support-matrix) and rebuild on a supported host. |

## Related documentation

| Document | Purpose |
|----------|---------|
| [Developer guide](developer-guide.md) | Repository structure, local development, tests, debugging, and extension points. |
| [Installation](installation.md) | Install and run release packages, find logs, and troubleshoot first launch. |
| [Command-line reference](command-line.md) | Every command-line parameter, its default, and a worked example. |
| [Configuration](configuration.md) | App Config and Launch Config settings, storage locations, and reset steps. |
