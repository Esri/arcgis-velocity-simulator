# Installing and running the application

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide covers release package selection, installation, first launch, logs,
and startup troubleshooting for ArcGIS Velocity Simulator. Release packages include
Electron and do not require a separate Node.js installation.

## Table of contents

- [Choose a package](#choose-a-package)
- [Install and launch](#install-and-launch)
- [Find diagnostic logs](#find-diagnostic-logs)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Choose a package

Download only from the repository's official GitHub release page. Match the CPU:
`arm64` for Apple silicon or ARM Linux, `x64` for Intel/AMD. Both are 64-bit;
only combinations actually present in the release are supported.

| Platform | Filename suffix | Use |
|---|---|---|
| macOS | `-mac-arm64.dmg` or `-mac-arm64.zip` | Install or extract the complete application bundle. |
| Windows | `-win-x64-setup.exe` | Install with shortcuts and an uninstaller. |
| Windows | `-win-x64-portable.exe` | Self-extracting, no-install launch. |
| Windows | `-win-x64.zip` | Extract all application and supporting files together. |
| Linux | `-linux-<arch>.deb` | Install with `apt`/`dpkg`, resolving dependencies on Debian/Ubuntu. |
| Linux | `-linux-<arch>.AppImage` | Portable executable containing the app and many dependencies. |

Names begin with `arcgis-velocity-simulator-<version>`. Maintainers keep target
manifests for checksum and provenance validation; manifests are not application
downloads.

### Linux support

Linux support targets Ubuntu 24.04 LTS and Debian 13 on `x64` and `arm64`,
for GUI and no-display headless operation. GUI use requires a working desktop
session and the native libraries declared by the package. Headless execution
uses the bundled Node runtime before Chromium starts; see
[headless launch patterns](headless.md#quick-start).

Ubuntu and Debian are maintained glibc-based systems aligned with the bundled
Electron runtime. They provide APT integration and a bounded distribution and
architecture matrix that can be validated consistently. The remote data
endpoint or server container does not need to use the same operating system.

Debian is a distribution; `.deb` is a package format used by both Debian and
Ubuntu. A DEB installs into the system, declares dependencies, and integrates
with the package manager. AppImage is a portable executable format, not a
distribution or a universal Linux ABI. It still needs a compatible host and
native libraries. Some systems require FUSE or the extraction fallback below.

Alpine Linux, including Alpine 3.23.7, is not supported for either native GUI
or headless execution. Alpine uses musl, while the bundled Electron binary
requires glibc. Selecting Electron's Node-only headless mode avoids Chromium
display initialization but does not remove that binary's glibc requirement.
Remote X11 changes where windows appear, not ABI compatibility. No separate
Alpine-compatible Node CLI is shipped or tested. Do not use custom glibc shims,
mixed-distribution libraries, or edge packages to bypass these requirements.

## Install and launch

### macOS

macOS 13 or later is required. Open the DMG and drag `VelocitySimulator.app` into
`/Applications`, or extract the ZIP and move the complete application bundle
there. Quit any running copy before replacing it. Launch the installed copy,
not the one inside a mounted DMG.

```bash
VERSION=1.1.1
hdiutil verify "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-mac-arm64.dmg"
shasum -a 256 "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-mac-arm64.dmg"
```

Compare the SHA-256 with GitHub's published asset digest. Disk-image integrity
and checksums do not establish Developer ID signing or notarization.

#### Unsigned package workaround

If Gatekeeper blocks an intact, trusted official download, first verify its
origin and checksum. Only then quit the application and remove its quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/VelocitySimulator.app"
open "/Applications/VelocitySimulator.app"
```

> [!WARNING]
> Removing quarantine bypasses a macOS security control. Ad-hoc signing is not
> Developer ID notarization. Do not use this workaround for an untrusted
> download, use `sudo`, or disable Gatekeeper globally.

### Windows

Run the setup executable for installation or the portable executable for
no-install use. For ZIP packages, extract everything to a writable folder and
run `VelocitySimulator.exe`; do not separate the executable from its resources.
Check the publisher if SmartScreen displays a warning. A signed package can
still need to establish SmartScreen reputation.

### Linux

Choose `ARCH=arm64` or `ARCH=x64` to match the machine.

```bash
VERSION=1.1.1
ARCH=x64
sudo apt install "./arcgis-velocity-simulator-${VERSION}-linux-${ARCH}.deb"
```

For portable use:

```bash
VERSION=1.1.1
ARCH=x64
chmod +x "arcgis-velocity-simulator-${VERSION}-linux-${ARCH}.AppImage"
"./arcgis-velocity-simulator-${VERSION}-linux-${ARCH}.AppImage"
```

When FUSE is unavailable, use the AppImage's extraction-and-run facility:

```bash
APPIMAGE_EXTRACT_AND_RUN=1 ./arcgis-velocity-simulator-1.1.1-linux-x64.AppImage \
  runMode=headless filename=./input.csv protocol=tcp mode=client ip=127.0.0.1 \
  port=5565 doneFile=./replay.done.json
```

The DEB's executable is `/opt/ArcGIS Velocity Simulator/VelocitySimulator`.
Always use this launcher or the AppImage for headless operation, not the
internal native `.bin` file. No display server or Xvfb is required for help,
configuration errors, or headless replay.

For GUI use, run as a normal user on a desktop that permits Chromium's sandbox.
The upstream AppImage `AppRun` may inject `--no-sandbox` when run as root or
when its user-namespace probe fails. A successful rootless container launch
therefore does not establish sandboxed GUI execution. Do not disable sandbox
checks or elevate the application to work around a desktop configuration issue.
Both startup parsers recognize this exact AppImage runtime flag without treating
it as an application parameter. GUI execution preserves the upstream arguments;
the application does not add a sandbox bypass. Other unknown flags still fail.

## Find diagnostic logs

Packaged applications create timestamped logs without depending on the launch
directory:

| Platform | Default directory |
|---|---|
| macOS | `~/Library/Logs/arcgis-velocity-simulator/` |
| Windows | `%APPDATA%\arcgis-velocity-simulator\logs\` |
| Linux | `~/.config/arcgis-velocity-simulator/logs/` |

Linux follows `XDG_CONFIG_HOME` when set. An explicit `logFile=<path>` overrides
the default; relative overrides resolve against the process working directory.
Use absolute paths for scheduled jobs and shortcuts. Saved settings retain the
canonical [configuration location](configuration.md#file-location).

## Troubleshooting

| Symptom | Action |
|---|---|
| macOS reports damage or blocks launch | Verify the asset checksum first; see [Unsigned package workaround](#unsigned-package-workaround) only for trusted, intact downloads. |
| macOS reports an unsupported application | Check macOS version and CPU architecture. |
| Windows shows a SmartScreen warning | Verify origin and publisher; do not assume signing proves runtime behavior. |
| Linux cannot execute the AppImage | Check architecture, execute permission, supported distribution, and FUSE/extraction mode. |
| Linux headless reports a missing display | Use the packaged launcher, not the native `.bin` executable. |
| Linux GUI cannot start | Run inside a supported desktop session; resolve native dependencies with the distribution package manager. |
| The application starts but cannot connect | Review [connection presets](connection-presets.md) and the selected transport guide. |

## Related documentation

| Guide | Purpose |
|---|---|
| [Headless mode](headless.md) | Automated replay workflows. |
| [Configuration](configuration.md) | Settings and launch configuration. |
| [Command-line reference](command-line.md) | Application parameters. |
| [Build and release](build-and-release.md) | Packaging and signature verification. |
