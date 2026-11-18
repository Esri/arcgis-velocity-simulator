# Installing and running the application

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide explains how users install and start ArcGIS Velocity Simulator from
a release package on macOS, Windows, or Linux. It also covers first-launch
security warnings, deployed log locations, and startup troubleshooting.

Both Standalone and Compact packages include their Node.js backend; Node.js
and npm are not required on the receiving machine. Standalone uses Electron
with its bundled browser; Compact uses Tauri with the operating system webview.

## Table of contents

- [Choose a package](#choose-a-package)
- [Install and launch](#install-and-launch)
- [Find diagnostic logs](#find-diagnostic-logs)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Choose a package

Download packages only from the repository's official GitHub release page.

| Platform | Package | Use |
|---|---|---|
| macOS | `arcgis-velocity-simulator-<version>-<edition>-mac-<arch>.dmg` | Drag-to-Applications installation. |
| macOS | `arcgis-velocity-simulator-<version>-<edition>-mac-<arch>.zip` | Scripted extraction or environments that do not use DMG files. |
| Windows | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>-setup.exe` | Standard installation with shortcuts and an uninstaller. |
| Windows | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>-portable.exe` | Run without installing the application. |
| Windows | `arcgis-velocity-simulator-<version>-<edition>-win-<arch>.zip` | Extract the complete application folder. |
| Linux | `arcgis-velocity-simulator-<version>-<edition>-linux-<arch>.AppImage` | Portable launch on compatible Linux distributions. |
| Debian and Ubuntu | `arcgis-velocity-simulator-<version>-<edition>-linux-<arch>.deb` | Installation through `apt` or `dpkg`. |

Select `standalone` or `compact` for `<edition>`. Architecture is explicit:
`arm64` for Apple silicon or ARM Linux/Windows, and `x64` for Intel/AMD systems.
Only download combinations actually present in the selected release.
The accompanying target manifest records byte sizes and SHA-256 checksums.

Compact on Windows requires Microsoft WebView2. The NSIS installer can download
the runtime if absent; portable EXE and ZIP packages require it to be installed
already and do not provision it. The portable EXE extracts its full application
to a temporary folder, waits for it to exit, and removes that folder.
Portable packaging does not move configuration or logs beside the executable.

For the architectural tradeoffs and when to choose each edition, see
[Desktop runtime choices](developer-guide.md#desktop-runtime-choices).

On Linux, Compact DEB packages declare native webview dependencies. AppImages
still require a compatible architecture and system-library baseline; they do
not run on every Linux distribution. Compact packages built with the supplied
Linux container use a Debian 12 / glibc 2.36 baseline and require WebKitGTK 4.1.
Do not assume these packages run on Ubuntu 22.04 or older glibc versions.
macOS uses the system WKWebView.
Camera and speech availability depends on the selected system webview.

Compact installers use a separate application identity and a display name ending
in **Compact**. Its configuration is separate from Standalone; see
[Configuration](configuration.md). Keep all ZIP contents together, including
the bundled backend and Node executable.

## Install and launch

### macOS

To install from a DMG:

1. Download the DMG from the official release page;
2. verify the GitHub-published SHA-256 digest if your workflow requires an
   integrity check;
3. open the DMG;
4. drag `VelocitySimulator.app` to `/Applications`; and
5. open the application from `/Applications`.

The Standalone bundle is `VelocitySimulator.app`; the Compact bundle is
`ArcGIS Velocity Simulator Compact.app`. Use the selected bundle name throughout
the following examples.

Alternatively, extract the macOS ZIP and move the application bundle into
`/Applications`. Quit any running copy before replacing it, then launch the
installed application rather than a copy inside the mounted DMG.

To check the downloaded DMG, set `VERSION` to the version you downloaded
(use the version shown on the selected release):

```bash
VERSION=x.y.z
EDITION=standalone
ARCH=arm64
hdiutil verify \
  "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-${EDITION}-mac-${ARCH}.dmg"
shasum -a 256 \
  "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-${EDITION}-mac-${ARCH}.dmg"
```

`hdiutil verify` checks the disk image's internal integrity. Compare the
`shasum` value with the asset's SHA-256 digest on GitHub; neither check
establishes Apple signing or notarization.

#### Unsigned package workaround

Browser downloads can carry a quarantine attribute. Without Developer ID
signing and notarization, Gatekeeper may block the application or report it as
damaged even when its download is intact. An ad hoc bundle signature does not
provide Developer ID trust or notarization.

Try opening the installed application normally first. Only if Gatekeeper
blocks a trusted official package whose checksum you have verified, quit the
application and use this workaround:

```bash
xattr -dr com.apple.quarantine \
  "/Applications/VelocitySimulator.app"

open "/Applications/VelocitySimulator.app"
```

Afterward, launch this installed copy normally from Finder. Quarantine removal
is not a command to repeat on every launch; a replacement download may be
quarantined again. No manual log-directory creation or `logFile` argument is
required. See [Find diagnostic logs](#find-diagnostic-logs).

> [!WARNING]
> Removing quarantine bypasses a macOS security control. Use this workaround
> only after confirming that the application came from the official Esri
> release page and its checksum matches the published digest. This does not
> notarize the application. Do not use `sudo` or disable Gatekeeper globally.

### Windows

Run the setup executable for a standard installation, or run the portable
executable directly. For the Windows ZIP, extract the entire archive into a
writable folder and run `VelocitySimulator.exe` there; keep its supporting files
together. Windows can show a SmartScreen warning when a package is
unsigned or its signing certificate has not established reputation. Verify the
publisher and obtain packages only from the official release page.

### Linux

Run these commands from the download directory, replacing `x.y.z` with the
downloaded version. The package architecture must match your system.

For an AppImage:

```bash
VERSION=x.y.z
EDITION=standalone
ARCH=x64
chmod +x "arcgis-velocity-simulator-${VERSION}-${EDITION}-linux-${ARCH}.AppImage"
"./arcgis-velocity-simulator-${VERSION}-${EDITION}-linux-${ARCH}.AppImage"
```

For Debian or Ubuntu:

```bash
VERSION=x.y.z
sudo apt install "./arcgis-velocity-simulator-${VERSION}-${EDITION}-linux-${ARCH}.deb"
```

## Find diagnostic logs

Packaged applications automatically create the diagnostic log directory and
write timestamped files in both UI and headless modes:

| Platform | Default directory |
|---|---|
| macOS | `~/Library/Logs/arcgis-velocity-simulator/` |
| Windows | `%APPDATA%\arcgis-velocity-simulator\logs\` |
| Linux | `~/.config/arcgis-velocity-simulator/logs/` |

For example, the same timestamped log is written as:

```text
macOS:  /Users/alice/Library/Logs/arcgis-velocity-simulator/velocity-simulator-20260922T224947.log
Windows: C:\Users\Alice\AppData\Roaming\arcgis-velocity-simulator\logs\velocity-simulator-20260922T224947.log
Linux:  /home/alice/.config/arcgis-velocity-simulator/logs/velocity-simulator-20260922T224947.log
```

This behavior applies to every packaged platform, not only macOS. Packaged
applications do not depend on the launcher's working directory. An explicit
`logFile=<path>` argument always takes precedence.
Relative overrides resolve against the process working directory; use an
absolute path when launching through a desktop shortcut. On Linux, the
application-data base follows `XDG_CONFIG_HOME` when set; the table shows the
usual default.

## Troubleshooting

| Symptom | Cause and action |
|---|---|
| macOS says the application is damaged. | Check disk-image integrity and the published SHA-256 digest first. Do not bypass a checksum mismatch. For an intact, trusted official package blocked by Gatekeeper, see [Unsigned package workaround](#unsigned-package-workaround). |
| macOS shows `ENOENT: no such file or directory, mkdir '/logs'`. | Install a current release and launch the copy in `/Applications`. Packaged default logs do not depend on Finder's working directory. If the error persists, check for an explicit `logFile` override; do not create `/logs` or run the app with `sudo`. |
| macOS says the application is unsupported. | The package architecture does not match the Mac. The current package requires Apple silicon. |
| Windows shows a SmartScreen warning. | Confirm the package came from the official release page and verify its publisher before continuing. |
| Linux cannot execute the AppImage. | Add execute permission with `chmod +x` and confirm the distribution supports AppImage. |
| The application starts but cannot connect. | Open [Protocol settings and presets](connection-presets.md), then use the guide for the selected transport. |

## Related documentation

| Guide | Purpose |
|---|---|
| [Configuration](configuration.md) | Persisted settings and launch configuration files. |
| [Command-line reference](command-line.md) | Parameters including `logFile` and `logLevel`. |
| [Protocol settings and presets](connection-presets.md) | Configure a connection after installation. |
| [Build and release](build-and-release.md) | Build, sign, notarize, and publish packages. |
| [Developer guide](developer-guide.md) | Logging implementation, development, and tests. |
