# Debugging Guide

## Debug Commands

| Command | Purpose | Ports |
|---------|---------|-------|
| `npm run debug-main` | Main process only | 9229 |
| `npm run debug-main-brk` | Main + break on start | 9229 |
| `npm run debug-renderer` | Renderer only | 9222 |
| `npm run debug-both` | Both processes | 9229, 9222 |
| `npm run debug-both-brk` | Both + break on start | 9229, 9222 |
| `npm run debug-verbose` | Both + verbose Electron logging | 9229, 9222 |

## Connecting

**Chrome DevTools (renderer):**

1. Run `npm run debug-renderer`
2. Open `chrome://inspect` → inspect the Electron renderer target, or navigate to `http://localhost:9222`

**Chrome DevTools (main/backend):**

1. Run `npm run debug-main`
2. Open `chrome://inspect` → configure `localhost:9229` → inspect

**VSCode:** Pre-configured via `.vscode/launch.json`. Run and Debug → select a config → Play.
Available configs: Debug Main, Debug Renderer, Debug Both, Launch and Debug Main, Launch and Debug Both.

**Built-in DevTools (quick):** `Cmd+Option+I` / `Ctrl+Shift+I` while the app is running.

## Headless Mode Debugging

Headless never creates a BrowserWindow — attach to the main process only:

```bash
electron --inspect-brk=9229 . runMode=headless \
  filename=./data.csv protocol=tcp mode=client ip=127.0.0.1 port=5565 logLevel=debug

# or via the npm script:
npm run debug-main -- runMode=headless filename=./data.csv \
  protocol=tcp mode=client ip=127.0.0.1 port=5565 logLevel=debug
```

Useful runtime options while debugging headless:
- `logLevel=debug` — verbose diagnostics
- `logFile=/tmp/runner.log` — mirror diagnostics to a file
- `doneFile=/tmp/run.done.json` — inspect the JSON summary after the run
- `exitOnComplete=true` — auto-exit when the file finishes streaming

Exit codes: `0` success, `1` config error, `2` runtime error.

## Common Issues

### Port conflicts (TCP/UDP)

| Command | Purpose |
|---------|---------|
| `lsof -i :<port>` | Check if a specific port is in use |
| `netstat -an \| grep <port>` | Alternative port check |
| `lsof -i :9229` | Check if inspector port is in use |

### Debugger won't connect

| Command | Purpose |
|---------|---------|
| `lsof -i :9229` | Check port is free |
| `pkill -f "electron.*inspect"` | Kill stale inspector process |
| `node -c src/main.js` | Check for syntax errors |

If the app fails immediately on start, use `npm run debug-main-brk` to trace the startup sequence.

### Theme not applying
Use `npm run debug-renderer` → Elements tab → check CSS variables on `body`; Sources tab for breakpoints in `renderer.js`.

### File loading issues
Use `npm run debug-renderer` → Console tab — the app logs file name, size, line count, and CSV parse errors on load.

### Gesture / voice control issues
Use `npm run debug-renderer` → Console → check camera/microphone permissions:
```javascript
navigator.mediaDevices.getUserMedia({video: true}).then(() => console.log('ok')).catch(console.error);
```

### Performance / memory
Use Chrome DevTools Performance tab (renderer) or add a memory log to main:
```javascript
setInterval(() => console.log('Memory:', Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB'), 30000);
```

## Production Log Files

- **macOS**: `~/Library/Logs/arcgis-velocity-simulator/`
- **Windows**: `%APPDATA%\arcgis-velocity-simulator\logs\`
- **Linux**: `~/.config/arcgis-velocity-simulator/logs/`

## Related

- [TESTING.md](./TESTING.md) — automated tests
- [ARCHITECTURE.md](./ARCHITECTURE.md) — component overview
