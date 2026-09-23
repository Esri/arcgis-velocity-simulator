# Installing and running the application

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide explains how users install and start ArcGIS Velocity Simulator from
a release package on macOS, Windows, or Linux. It also covers first-launch
security warnings, deployed log locations, and startup troubleshooting.

Release packages include the application runtime; Node.js and npm are not
required to run them.

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
| macOS | `arcgis-velocity-simulator-<version>-mac.dmg` | Drag-to-Applications installation. |
| macOS | `arcgis-velocity-simulator-<version>-mac.zip` | Scripted extraction or environments that do not use DMG files. |
| Windows | `arcgis-velocity-simulator-<version>-setup.exe` | Standard installation with shortcuts and an uninstaller. |
| Windows | `arcgis-velocity-simulator-<version>-portable.exe` | Run without installation. |
| Windows | `arcgis-velocity-simulator-<version>-win.zip` | Extract the packaged application manually. |
| Linux | `arcgis-velocity-simulator-<version>-linux.AppImage` | Portable launch on AppImage-compatible distributions. |
| Debian and Ubuntu | `arcgis-velocity-simulator-<version>-linux.deb` | Installation through `apt` or `dpkg`. |

Check the release's architecture before downloading. The v1.0.6 macOS packages
are for Apple silicon (`arm64`), Windows packages are `x64`, and Linux packages
are `arm64`. An Intel Mac requires an `x64` or universal macOS package; an
`x86_64` Linux system requires a matching Linux package.

## Install and launch

### macOS

To install from a DMG:

1. Download the DMG from the official release page;
2. verify the GitHub-published SHA-256 digest if your workflow requires an
   integrity check;
3. open the DMG;
4. drag `VelocitySimulator.app` to `/Applications`; and
5. open the application from `/Applications`.

Alternatively, extract the macOS ZIP and move `VelocitySimulator.app` into
`/Applications`. Quit any running copy before replacing it, then launch the
installed application rather than a copy inside the mounted DMG.

To check the downloaded DMG, set `VERSION` to the version you downloaded
(for example, `1.0.6`):

```bash
VERSION=x.y.z
hdiutil verify \
  "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-mac.dmg"
shasum -a 256 \
  "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-mac.dmg"
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
chmod +x "arcgis-velocity-simulator-${VERSION}-linux.AppImage"
"./arcgis-velocity-simulator-${VERSION}-linux.AppImage"
```

For Debian or Ubuntu:

```bash
VERSION=x.y.z
sudo apt install "./arcgis-velocity-simulator-${VERSION}-linux.deb"
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
| macOS shows `ENOENT: no such file or directory, mkdir '/logs'`. | Install v1.0.6 or later and launch the copy in `/Applications`. Default logs no longer depend on Finder's working directory. If the error persists, check for an explicit `logFile` override; do not create `/logs` or run the app with `sudo`. |
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
