# Installing and running the application

[← Documentation index](README.md) · [Repository overview](../README.md#documentation)

This guide explains how users install and start ArcGIS Velocity Simulator from
a release package on macOS, Windows, or Linux. It also covers first-launch
security warnings, deployed log locations, and startup troubleshooting.

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

The current macOS release package is for Apple silicon (`arm64`). An Intel Mac
requires an `x64` or universal package.

## Install and launch

### macOS

1. Download the DMG from the official release page;
2. verify the GitHub-published SHA-256 digest if your workflow requires an
   integrity check;
3. open the DMG;
4. drag `VelocitySimulator.app` to `/Applications`; and
5. open the application from `/Applications`.

The DMG itself is valid when this command completes successfully:

```bash
VERSION=x.y.z
hdiutil verify \
  "$HOME/Downloads/arcgis-velocity-simulator-${VERSION}-mac.dmg"
```

#### Unsigned package workaround

A browser adds a quarantine attribute to downloaded applications. When a
package is not signed with an Apple Developer ID and notarized, Gatekeeper can
report the application as damaged even though the DMG checksum is valid.

The supported distribution fix is a signed and notarized package. For a trusted
test package downloaded from the official Esri release page, use this temporary
workaround:

```bash
mkdir -p "$HOME/Library/Logs/arcgis-velocity-simulator"

xattr -dr com.apple.quarantine \
  "/Applications/VelocitySimulator.app"

open "/Applications/VelocitySimulator.app" --args \
  "logFile=$HOME/Library/Logs/arcgis-velocity-simulator/velocity-simulator.log"
```

The absolute `logFile` argument also avoids an `ENOENT` error for an affected
package that tries to create `/logs` when Finder starts it with `/` as the
working directory. Use the command for each launch until a corrected package is
installed.

> [!WARNING]
> Removing quarantine bypasses a macOS security control. Use this workaround
> only after confirming that the application came from the official Esri
> release page and its checksum matches the published digest. Do not use `sudo`
> and do not create a `/logs` folder at the filesystem root.

### Windows

Run the setup executable for a standard installation, or run the portable
executable directly. Windows can show a SmartScreen warning when a package is
unsigned or its signing certificate has not established reputation. Verify the
publisher and obtain packages only from the official release page.

### Linux

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

Packaged applications write timestamped diagnostic logs to a writable,
platform-specific directory:

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

## Troubleshooting

| Symptom | Cause and action |
|---|---|
| macOS says the application is damaged. | The package is not Developer ID-signed and notarized, or the download is corrupt. Run `hdiutil verify`, confirm the published SHA-256 digest, and use [Unsigned package workaround](#unsigned-package-workaround) only for a trusted official package. |
| macOS shows `ENOENT: no such file or directory, mkdir '/logs'`. | The package resolved a relative log directory from Finder's `/` working directory. Use [Unsigned package workaround](#unsigned-package-workaround), including its absolute `logFile` argument. |
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
