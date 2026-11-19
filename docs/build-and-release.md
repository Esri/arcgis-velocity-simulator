# Build and release

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide covers building, signing, verifying, and publishing ArcGIS Velocity
Simulator packages. It is for maintainers with Node.js 24 LTS, npm, Git, and the
repository dependencies installed. Electron is the desktop runtime.

## Table of contents

- [Prerequisites](#prerequisites)
- [Local builds](#local-builds)
- [Platform packaging](#platform-packaging)
- [Code signing](#code-signing)
- [Releasing](#releasing)
- [Release checklist](#release-checklist)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Prerequisites

```bash
npm ci
npm run prereqs:check:release
```

Use the existing host-controlled build tools. macOS packaging needs macOS and
Xcode command-line tools. Windows packaging from macOS uses the existing
Electron builder tools; test the result on Windows. Linux DEB packaging on
macOS needs `dpkg`, `fakeroot`, and GNU `ar` from Homebrew `binutils`.
Native Linux validation requires the target distribution and architecture.

```bash
npm run prereqs:check:mac
npm run prereqs:check:win
npm run prereqs:check:linux
npm run prereqs:install -- --dry-run
```

The prerequisite installer is opt-in. It does not configure signing credentials
or upgrade the host Node.js major version. Release upload requires authenticated
`gh`; packaging does not need a GitHub token.

## Local builds

Final outputs live in `dist/electron/<platform>-<arch>/`. A build cleans only its
selected target, not another platform or architecture. Each successful target
writes a local manifest recording version, architecture, source commit, dirty
state, exact filenames, byte sizes, and SHA-256 digests.

```bash
npm run package:mac
npm run package:win
npm run package:linux -- --arm64
npm run package:linux -- --x64
npm run package:win:zip
```

`npm run package:all` runs platform builds in parallel; `npm run package:seq`
runs them sequentially. Windows defaults to `x64`; other platforms default to
the host architecture. Specify architecture explicitly for reproducible builds.
`ia32` and labels such as `universal` are not substitutes for a real supported
build. Both `x64` and `arm64` are 64-bit architectures.

Package-only wrappers enforce `--publish=never`, including under CI. An explicit
request for another publishing mode fails before output cleanup. Publish only
through the release workflow after validation.

### Compression

Compression defaults to `normal`. The existing `:max` scripts pass
`--config.compression=maximum`; they trade build time for smaller output.
Do not edit source configuration just to choose compression.

### Key build settings

`package.json` owns the version and Electron builder configuration. Preserve
`build.appId` and `build.executableName` when changing presentation or packaging;
they affect application identity, shortcuts, and installation behavior.
Application code is packaged in ASAR, while `src/assets` supplies icons.

`build.toolsets.appimage` pins the official Electron builder `1.0.3` toolset.
Builder labels this static-runtime toolset beta. Its normal checksum-verified
tool download is used unchanged; there is no locally rebuilt runtime. The
static runtime avoids an unversioned `libz.so` dependency and preserves clean
application stdout during extraction-and-run.

## Platform packaging

Public filenames contain the version, platform, and actual architecture, with
no edition suffix:

```text
arcgis-velocity-simulator-<version>-mac-<arch>.dmg
arcgis-velocity-simulator-<version>-mac-<arch>.zip
arcgis-velocity-simulator-<version>-win-<arch>-setup.exe
arcgis-velocity-simulator-<version>-win-<arch>-portable.exe
arcgis-velocity-simulator-<version>-win-<arch>.zip
arcgis-velocity-simulator-<version>-linux-<arch>.deb
arcgis-velocity-simulator-<version>-linux-<arch>.AppImage
```

The release matrix is macOS ARM64, Windows x64, and Linux ARM64 plus x64:
nine application packages and four local target manifests. macOS requires
version 13 or later. See [Linux support](installation.md#linux-support) for
the supported distributions, ABI requirements, and package-format choices.

The Linux after-pack hook retains the native Electron executable as
`<executableName>.bin` and installs a launcher at the original executable path.
It dispatches help, validation errors, and headless replay through the bundled
Node runtime before Chromium starts. GUI execution remains normal Electron.
No separate Node download or CLI package is required.

For reproducible Linux packaging on a non-Linux host, use the local Docker
engine and the pinned Ubuntu build image:

```bash
npm run package:targets -- --platform linux --linux-container
```

This builds x64 and ARM64 sequentially. Add `--arch x64` or `--arch arm64` to
select one. Only reviewed source inputs enter the container; personal
configuration and signing credentials are excluded. The local manifest records
the image identity and source snapshot digest. Container help and invalid-input
checks run the actual packages without a display server.

On an ARM64 Mac, x64 AppImage verification explicitly uses the distribution's
`qemu-x86_64-static` inside the build container. Docker's default x64 execution
can reject the static AppImage runtime even when other x64 executables work.
The verification report names the executor; this is emulated x64 evidence,
not a native x64 hardware test. QEMU is a build-time verification tool only,
not a shipped application dependency, and no global Docker settings change.

## Code signing

### macOS signing and notarization

Configure the normal Electron builder `CSC_*` and `APPLE_*` credentials for
Developer ID signing and notarization. Ad-hoc signing verifies bundle integrity
but is not Developer ID trust or notarization. Never describe these as
equivalent. User Gatekeeper guidance belongs in
[installation troubleshooting](installation.md#troubleshooting).

### Windows signing

Use a readable external signing-script path explicitly:

```bash
npm run package:win -- --sign-script /path/to/sign.sh
```

The build signs the unpacked application after resource editing, then signs
the completed setup and portable executables in one outer-artifact batch.
The external signer owns its credentials, service configuration, and staging.
Use its documented configuration rather than copying secrets into this repository.
An ignored `.release.local.json` may hold a local `signScript` pointer, but
the scripts do not load it automatically: pass `--sign-script`.

The wrappers also accept `--sign-share-dir`, `--sign-product-names`, and
`--sign-timeout-minutes`. Use `--help` for their exact defaults. Preserve the
shared signing lock, unique request correlation, terminal success checks,
copy-back verification, and failure behavior. Never submit competing clients,
delete an unexplained marker, or repost an ambiguously accepted request.

### Ready-file signing batches

Independent, fully prepared EXE, DLL, and MSI files can use the neutral adapter:

```bash
VELOCITY_SIGN_SCRIPT=/path/to/sign.sh node scripts/sign-windows-files.js --batch /ready/application.exe /ready/helper.dll
```

Use one flat directory of regular files and exact distinct filenames. Links,
nested directories, wildcards, duplicates, case collisions, and signer filename
normalization collisions are rejected. Inner files must be signed before
assembling the outer packages. Verify every result against its own pre-sign
input, allowing only Authenticode certificate, directory, and checksum changes.

## Releasing

`scripts/release.sh` is the release entry point. Use reviewed notes when
generated commit messages are not appropriate for publication.

```bash
bash scripts/release.sh --help
bash scripts/release.sh --dry-run 1.1.1
```

The full workflow checks prerequisites and source state, updates and commits the
version when necessary, builds from that clean commit, pushes, creates a draft release, uploads
validated application packages, and publishes only after all uploads succeed.
Local manifests are mandatory provenance records, not public downloads.

### Verification and recovery

Validate prepared outputs and preview publication without rebuilding:

```bash
node scripts/release-artifacts.js --platform all --packages-only
bash scripts/release.sh --upload-only --platform all --notes-file /path/to/reviewed-notes.md --dry-run
```

The validator checks manifest completeness, version, architecture, hashes, and
source provenance. `--packages-only` changes the output list, not validation.
Do not rename old packages or rewrite their manifests to claim a newer producer.
Omit a global architecture override when collecting mixed-architecture targets.

An interrupted upload leaves a draft; inspect its exact assets before resuming.
An accepted signing request is not a completed signing request. Preserve its
identity and resolve its actual state rather than retrying blindly.

### Two-phase release

`--prepare-only` still commits and pushes; it is not a local-only build mode.
`--upload-only` validates prepared artifacts and publishes them without building.
These options are mutually exclusive.

### Replacing a release

`--re-release` deletes and recreates the selected release and tag. Before using
it, preserve the old release metadata and all original bytes, verify every
replacement target, freeze its source commit, and prepare the intended notes.
Never use it to recover from an unknown upload or signing state.

## Release checklist

- Run `npm test`, `npm run docs:check-links`, and `git diff --check`.
- Freeze the reviewed source and build every selected architecture.
- Verify executable versions, architecture, signatures, and pre-sign payloads.
- Inspect archive entry types and targets before extraction or file hashing.
  Reject unexpected absolute, escaping, and dangling runtime links. The
  DMG-root `Applications` link to `/Applications` is the deliberate exception.
- Test Linux GUI launch and actual no-display headless replay on Ubuntu 24.04
  and Debian 13, with both architectures; do not use Xvfb as headless proof.
- Exercise help, invalid arguments, Launch Config, signals, replay limits,
  input files, `doneFile`, and transport/TLS behavior in real packages.
- Test Windows startup, installation, portable extraction, and command-line
  behavior; a valid signature does not establish that these work.
- Preview the exact upload set, then verify remote asset names, sizes, digests,
  release body, timestamp, and tag after publication.

## Troubleshooting

| Symptom | Action |
|---|---|
| DEB is suspiciously small | Check GNU `ar`, `dpkg`, and `fakeroot`; rebuild and verify extraction. |
| Packaging attempts to publish | Use the package wrappers with enforced `--publish=never`; do not supply a token as a workaround. |
| Signing appears stalled | Inspect correlated request state and heartbeat output. Do not retry an accepted request. |
| An artifact changed after packaging | Investigate the changed bytes; rebuild the intended target and regenerate its manifest honestly. |
| Linux headless needs a display | Use the packaged launcher, not the native `.bin` executable; verify its Node-only dispatch. |
| A downloaded package will not start | See [installation troubleshooting](installation.md#troubleshooting). |

## Related documentation

| Guide | Purpose |
|---|---|
| [Installation](installation.md) | Package requirements and first launch. |
| [Developer guide](developer-guide.md) | Local development and tests. |
| [Headless mode](headless.md) | Automated replay workflows. |
| [Command-line reference](command-line.md) | Application parameter reference. |
