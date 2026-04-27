# Testing Guide

Tests run with Node.js only — no Electron environment required.

## Run Tests

| Command | What it tests |
|---------|---------------|
| `npm test` | All suites |
| `npm run test:config` | Config management |
| `npm run test:cli` | CLI parsing / help |
| `npm run test:engine` | Headless simulation engine |
| `npm run test:headless-runner` | Headless app entry path |
| `npm run test:help` | Help + CLI dialog |
| `npm run test:renderer` | UI / DOM |
| `npm run test:preload` | Preload API bridge |
| `npm run test:about` | About dialog |
| `npm run test:grpc` | gRPC transport (all 3 formats) |

Or run a file directly: `node test/cli-options.test.js`

Exit code non-zero = failure.

## Test Suites

| Suite | File | What it covers |
|-------|------|----------------|
| Configuration | `config.test.js` | File I/O, defaults, error handling |
| CLI Options | `cli-options.test.js` | Parsing, defaults, validation, help mode |
| Headless Runner | `headless-runner.test.js` | Entry path, help short-circuiting, engine handoff |
| Help / CLI Dialog | `help.test.js` | Filters, sorting, copy/export, shortcuts, theme behavior |
| Simulation Engine | `simulation-engine.test.js` | Replay scheduling, ranges, wait-for-client, error modes |
| Renderer | `renderer.test.js` | UI logic, DOM manipulation, state changes |
| Preload | `preload.test.js` | IPC bridge, channel validation |
| About Dialog | `about.test.js` | Dialog rendering, version display |
| gRPC Transport | `grpc-transport.test.js` | Protobuf/kryo/text; client→server; server Watch push; disconnect; header path |

## Manual Smoke Tests

### Help output

| Command | Layout |
|---------|--------|
| `npm run help:cli` | Compact |
| `npm run help:cli:wide` | Wide ASCII table |
| `npm run help:cli:narrow` | Narrow ASCII table |
| `npm start -- help=true` | Compact (via launcher) |
| `npm start -- -h` | Short alias |
| `npm start -- help-table-wide=true` | Wide table (via launcher) |
| `npm start -- help-table-narrow=true` | Narrow table (via launcher) |

All must exit 0 and print without errors.

### UI launch

```bash
npm start
```

App opens in UI mode with saved config (theme, window size/position, compact/full view). Console shows startup explanation.

### Invalid parameter handling

```bash
npm start -- mysteryOption=true     # should print clear error + help, exit
npm start -- hhh                    # should print name=value syntax error, exit
npm start -- port=6000 protocol=udp # UI launches; CLI warning logged per ignored param
npm start -- explain=false          # no startup explanation printed
```

### Headless session

```bash
npm run start:headless -- filename=./data.csv
```

Expected: streams data and exits cleanly.

### CLI Reference dialog (in-app)

- `F3` → dialog opens, all parameters listed
- Search, quick chips, active pills, sortable columns, copy/export all respond correctly

## Troubleshooting

- **Dependencies**: `npm install`
- **Node version**: requires Node 18+
- **Debug a specific test**: `node --inspect test/config.test.js` then connect Chrome DevTools

## Related

- [DEBUGGING.md](./DEBUGGING.md) — debugger setup and common issues
- [COMMAND-LINE.md](./COMMAND-LINE.md) — full CLI parameter reference

