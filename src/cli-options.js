/**
 * Copyright 2026 Esri
 *
 * Licensed under the Apache License Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @file cli-options.js
 * @description
 * Command-line parsing and validation for UI and headless startup paths.
 *
 * Purpose:
 * - parse the app's `name=value` command-line convention
 * - normalize aliases such as `runMode=silent` and `rateMs`
 * - merge an optional JSON launch-config file with CLI overrides
 * - validate headless-only options before startup begins
 * - generate user-facing help output for terminal usage
 *
 * Precedence model:
 * 1. defaults
 * 2. optional `config=/path/to/file.json`
 * 3. explicit CLI values
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_WINDOWS_CONSOLE = os.platform() === 'win32';
const CLI_SYMBOLS = {
  divider: IS_WINDOWS_CONSOLE ? '-' : '─',
  separator: IS_WINDOWS_CONSOLE ? ' - ' : ' — ',
  warning: IS_WINDOWS_CONSOLE ? '!' : '⚠',
  error: IS_WINDOWS_CONSOLE ? 'x' : '✖',
};

function cliDivider(width) {
  return CLI_SYMBOLS.divider.repeat(width);
}

const BOOLEAN_TRUE = new Set(['true', '1', 'yes', 'y', 'on']);
const BOOLEAN_FALSE = new Set(['false', '0', 'no', 'n', 'off']);
const VALID_RUN_MODES = new Set(['ui', 'silent', 'headless']);
const VALID_PROTOCOLS = new Set(['tcp', 'udp', 'grpc', 'http', 'ws']);
const VALID_MODES = new Set(['server', 'client']);
const VALID_SERIALIZATIONS = new Set(['protobuf', 'kryo', 'text']);
const VALID_GRPC_SEND_METHODS = new Set(['stream', 'unary']);
const VALID_LOG_LEVELS = new Set(['error', 'warn', 'info', 'debug']);
const VALID_ON_ERROR = new Set(['exit', 'continue', 'pause']);
const VALID_DATA_FORMATS = new Set(['json', 'delimited', 'esriJson', 'geojson', 'xml']);
const CLI_OPTION_KEYS = new Set([
  'runMode',
  'filename',
  'protocol',
  'mode',
  'ip',
  'port',
  'linesPerInterval',
  'intervalMs',
  'loop',
  'autoConnect',
  'autoStart',
  'exitOnComplete',
  'explain',
  'waitForClient',
  'connectWaitForServer',
  'connectRetryIntervalMs',
  'startLine',
  'endLine',
  'maxLines',
  'connectTimeoutMs',
  'logLevel',
  'logFile',
  'config',
  'onError',
  'doneFile',
  'runId',
  'grpcHeaderPath',
  'grpcHeaderPathKey',
  'grpcSerialization',
  'grpcSendMethod',
  'useTls',
  'tlsCaPath',
  'tlsCertPath',
  'tlsKeyPath',
  'httpFormat',
  'httpTls',
  'httpPath',
  'httpTlsCaPath',
  'httpTlsCertPath',
  'httpTlsKeyPath',
  'wsFormat',
  'wsTls',
  'wsPath',
  'wsTlsCaPath',
  'wsTlsCertPath',
  'wsTlsKeyPath',
  'wsSubscriptionMsg',
  'wsIgnoreFirstMsg',
  'wsHeaders',
  'stdout',
  'help',
  'help-detailed',
  'help-table-narrow',
  'help-table-wide',
  'help-wide',
]);

const DEFAULT_HEADLESS_OPTIONS = {
  runMode: 'headless',
  filename: null,
  protocol: 'tcp',
  mode: 'server',
  ip: '127.0.0.1',
  port: 5565,
  linesPerInterval: 1,
  intervalMs: 1000,
  loop: false,
  autoConnect: true,
  autoStart: true,
  exitOnComplete: true,
  waitForClient: false,
  connectWaitForServer: false,
  connectRetryIntervalMs: 1000,
  startLine: 1,
  endLine: null,
  maxLines: null,
  connectTimeoutMs: 0,
  logLevel: 'info',
  logFile: null,
  config: null,
  onError: 'exit',
  doneFile: null,
  runId: null,
  grpcHeaderPath: 'replace.with.dedicated.uid',
  grpcHeaderPathKey: 'grpc-path',
  grpcSerialization: 'protobuf',
  grpcSendMethod: 'stream',
  useTls: true,
  tlsCaPath: null,
  tlsCertPath: null,
  tlsKeyPath: null,
  httpFormat: 'delimited',
  httpTls: true,
  httpPath: '/',
  httpTlsCaPath: null,
  httpTlsCertPath: null,
  httpTlsKeyPath: null,
  wsFormat: 'delimited',
  wsTls: true,
  wsPath: '/',
  wsTlsCaPath: null,
  wsTlsCertPath: null,
  wsTlsKeyPath: null,
  wsSubscriptionMsg: null,
  wsIgnoreFirstMsg: false,
  wsHeaders: null,
  stdout: true,
};

const HELP_LAYOUTS = Object.freeze({
  standard: 'standard',   // --help          : one line per param, no example column
  wide: 'wide',           // --help-wide     : one line per param with example column
  detailed: 'detailed',   // --help-detailed : full parameter-by-parameter text
  tableWide: 'table-wide',
  tableNarrow: 'table-narrow',
});

const HELP_COMMAND = 'electron . help=true';

/**
 * Explains why each headless-only parameter is ignored when the app starts in UI mode.
 * Used to emit a per-parameter warning instead of a single grouped message.
 */
const UI_PARAMETER_IGNORE_REASONS = {
  autoConnect: 'only used by the headless startup sequence; in UI mode connections are initiated manually through the interface',
  autoStart: 'only used by the headless startup sequence; in UI mode streaming is started manually through the interface',
  connectRetryIntervalMs: 'only used by the headless client-mode connection retry; has no effect in UI mode',
  connectTimeoutMs: 'only used by the headless transport connection; has no effect in UI mode',
  connectWaitForServer: 'only used by the headless client-mode transport; in UI mode server connection retry is managed through the interface',
  doneFile: 'only used by the headless runner to write a completion artifact; has no effect in UI mode',
  endLine: 'only used by the headless streaming scheduler to define a replay window; has no effect in UI mode',
  exitOnComplete: 'only applies to the headless runner process lifecycle; the UI stays open after a run',
  intervalMs: 'only used by the headless streaming scheduler; in UI mode configure the interval through the interface',
  ip: 'only used by the headless network transport; in UI mode configure the IP address through the interface',
  linesPerInterval: 'only used by the headless streaming scheduler; in UI mode configure the rate through the interface',
  logFile: 'only used by the headless logger; the UI does not write to a log file',
  logLevel: 'only used by the headless logger; in UI mode all events are shown in the status log',
  loop: 'only used by the headless streaming scheduler; in UI mode toggle loop mode through the interface',
  maxLines: 'only used by the headless streaming scheduler; has no effect in UI mode',
  mode: 'only used by the headless network transport; in UI mode select server or client mode through the interface',
  onError: 'only used by the headless streaming error handler; in UI mode errors are shown in the status log',
  port: 'only used by the headless network transport; in UI mode configure the port through the interface',
  protocol: 'only used by the headless network transport; in UI mode connection settings are managed through the interface',
  runId: 'only used by the headless runner for log and done-file tagging; has no effect in UI mode',
  grpcSerialization: 'only used by the headless gRPC transport; in UI mode select the serialization format through the interface',
  grpcHeaderPath: 'only used by the headless gRPC transport when mode=client; in UI mode configure the header path through the gRPC Client interface',
  grpcHeaderPathKey: 'only used by the headless gRPC transport when mode=client; in UI mode configure the header path key through the gRPC Client interface',
  grpcSendMethod: 'only used by the headless gRPC transport; in UI mode select the RPC type through the gRPC interface',
  startLine: 'only used by the headless streaming scheduler to define a replay window; has no effect in UI mode',
  stdout: 'only used by the headless logger to control console output; has no effect in UI mode',
  tlsCaPath: 'only used by the headless gRPC transport; in UI mode configure TLS through the gRPC interface',
  tlsCertPath: 'only used by the headless gRPC transport; in UI mode configure TLS through the gRPC interface',
  tlsKeyPath: 'only used by the headless gRPC transport; in UI mode configure TLS through the gRPC interface',
  useTls: 'only used by the headless gRPC transport; in UI mode configure TLS through the gRPC interface',
  httpFormat: 'only used by the headless HTTP transport; in UI mode select the format through the HTTP interface',
  httpTls: 'only used by the headless HTTP transport; in UI mode configure TLS through the HTTP interface',
  httpPath: 'only used by the headless HTTP transport; in UI mode configure the path through the HTTP interface',
  httpTlsCaPath: 'only used by the headless HTTP transport; in UI mode configure TLS through the HTTP interface',
  httpTlsCertPath: 'only used by the headless HTTP transport; in UI mode configure TLS through the HTTP interface',
  httpTlsKeyPath: 'only used by the headless HTTP transport; in UI mode configure TLS through the HTTP interface',
  wsFormat: 'only used by the headless WebSocket transport; in UI mode select the format through the WebSocket interface',
  wsTls: 'only used by the headless WebSocket transport; in UI mode configure TLS through the WebSocket interface',
  wsPath: 'only used by the headless WebSocket transport; in UI mode configure the path through the WebSocket interface',
  wsTlsCaPath: 'only used by the headless WebSocket transport; in UI mode configure TLS through the WebSocket interface',
  wsTlsCertPath: 'only used by the headless WebSocket transport; in UI mode configure TLS through the WebSocket interface',
  wsTlsKeyPath: 'only used by the headless WebSocket transport; in UI mode configure TLS through the WebSocket interface',
  wsSubscriptionMsg: 'only used by the headless WebSocket transport; in UI mode configure through the WebSocket interface',
  wsIgnoreFirstMsg: 'only used by the headless WebSocket transport; in UI mode configure through the WebSocket interface',
  wsHeaders: 'only used by the headless WebSocket transport; in UI mode configure through the WebSocket interface',
  waitForClient: 'only used by the headless server-mode transport; in UI mode client connections are managed through the interface',
};

const CLI_EXAMPLE_USAGES = Object.freeze([
  { label: 'UI default', command: 'electron .' },
  { label: 'UI + file', command: 'electron . filename=/absolute/path/to/data.csv' },
  { label: 'Headless server', command: 'electron . runMode=headless filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 waitForClient=true doneFile=./run.done.json' },
  { label: 'Config override', command: 'electron . runMode=headless config=./docs/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override' },
  { label: 'Help', command: 'electron . help=true' },
  { label: 'Help wide', command: 'electron . help-wide=true' },
  { label: 'Help detailed', command: 'electron . help-detailed=true' },
  { label: 'Table wide', command: 'electron . help-table-wide=true' },
  { label: 'Table narrow', command: 'electron . help-table-narrow=true' },
]);

/**
 * Shared CLI parameter metadata used by terminal help output and documentation.
 *
 * Required-in-headless rules:
 * - `filename` is always required once headless mode is selected.
 * - `runMode` is only needed when the user is launching from the regular app entry point
 *   and wants to switch from the default UI mode into headless mode.
 * - all other headless parameters are optional because they have defaults.
 */
const CLI_PARAMETER_DEFINITIONS = [
  {
    key: 'autoConnect',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.autoConnect,
    options: ['true', 'false'],
    example: 'autoConnect=true',
    requiredInHeadless: 'No',
    purpose: 'Connect automatically before streaming begins.',
  },
  {
    key: 'autoStart',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.autoStart,
    options: ['true', 'false'],
    example: 'autoStart=false',
    requiredInHeadless: 'No',
    purpose: 'Start streaming immediately after initialization instead of stopping in a ready state.',
  },
  {
    key: 'config',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.config,
    options: ['path', 'omitted'],
    example: 'config=./docs/launch-config.server.sample.json',
    requiredInHeadless: 'No',
    purpose: 'Optional JSON launch-config file. CLI values override config-file values.',
  },
  {
    key: 'connectRetryIntervalMs',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.connectRetryIntervalMs,
    options: ['integer >= 1'],
    example: 'connectRetryIntervalMs=3000',
    requiredInHeadless: 'No',
    purpose: 'Milliseconds to wait between connection retry attempts when connectWaitForServer=true. Has no effect when connectWaitForServer=false.',
  },
  {
    key: 'connectTimeoutMs',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.connectTimeoutMs,
    options: ['integer >= 0'],
    example: 'connectTimeoutMs=5000',
    requiredInHeadless: 'No',
    purpose: 'Timeout for initial connect/bind operations and recipient waiting.',
  },
  {
    key: 'connectWaitForServer',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.connectWaitForServer,
    options: ['true', 'false'],
    example: 'connectWaitForServer=true',
    requiredInHeadless: 'No',
    purpose: 'In client mode, retry the connection on failure (e.g. ECONNREFUSED) until the server is available. When false (the default), a failed connection attempt immediately aborts the run. Use connectTimeoutMs to set an overall deadline and connectRetryIntervalMs to tune the retry interval.',
  },
  {
    key: 'doneFile',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.doneFile,
    options: ['path', 'omitted'],
    example: 'doneFile=./logs/run.done.json',
    requiredInHeadless: 'No',
    purpose: 'Optional JSON completion/failure artifact for schedulers and CI.',
  },
  {
    key: 'endLine',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.endLine,
    options: ['integer >= startLine', 'null/omitted'],
    example: 'endLine=500',
    requiredInHeadless: 'No',
    purpose: '1-based inclusive ending line for the replay window. Defaults to the end of the file.',
  },
  {
    key: 'exitOnComplete',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.exitOnComplete,
    options: ['true', 'false'],
    example: 'exitOnComplete=false',
    requiredInHeadless: 'No',
    purpose: 'Exit the process after a completed headless run when applicable.',
  },
  {
    key: 'explain',
    defaultValue: true,
    options: ['true', 'false'],
    example: 'explain=false',
    requiredInHeadless: 'No',
    purpose: 'Print a detailed startup explanation showing the resolved run mode, active parameters, defaults, and any warnings about ignored parameters. In both UI and headless modes, this includes a configuration section and a Behavior Summary. Enabled by default; set to false to suppress.',
  },
  {
    key: 'filename',
    defaultValue: null,
    options: ['absolute-or-relative-path'],
    example: 'filename=./data.csv',
    requiredInHeadless: 'Yes',
    purpose: 'Input CSV/TXT file to replay. In UI mode it can also be supplied as a startup file.',
  },
  {
    key: 'grpcHeaderPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.grpcHeaderPath,
    options: ['string'],
    example: 'grpcHeaderPath=my.feed.uid',
    requiredInHeadless: 'No',
    purpose: 'Value sent as the gRPC endpoint header path. Injected as metadata on every outgoing gRPC call. Only applies when protocol=grpc and mode=client. Has no effect in server mode.',
  },
  {
    key: 'grpcHeaderPathKey',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.grpcHeaderPathKey,
    options: ['string'],
    example: 'grpcHeaderPathKey=grpc-path',
    requiredInHeadless: 'No',
    purpose: 'Key name for the gRPC endpoint header path metadata entry. Only applies when protocol=grpc and mode=client. Has no effect in server mode.',
  },
  {
    key: 'grpcSendMethod',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.grpcSendMethod,
    options: ['stream', 'unary'],
    example: 'grpcSendMethod=stream',
    requiredInHeadless: 'No',
    purpose: 'gRPC RPC type for client-mode sending. "stream" (default) uses a Client Streaming RPC that multiplexes all messages over a single persistent HTTP/2 stream for higher throughput. "unary" uses a Unary RPC that sends each message as a discrete request/response round-trip, easier to trace and debug. Only applies when protocol=grpc and mode=client.',
  },
  {
    key: 'help',
    defaultValue: false,
    options: ['true', 'false'],
    example: 'help=true',
    requiredInHeadless: 'No',
    purpose: 'Print a compact ASCII-table parameter summary (name, values, default, purpose) without the example column and exit without running the app.',
  },
  {
    key: 'help-detailed',
    defaultValue: false,
    options: ['true', 'false'],
    example: 'help-detailed=true',
    requiredInHeadless: 'No',
    purpose: 'Print full detailed command-line help with all parameter details and exit without running the app.',
  },
  {
    key: 'help-table-narrow',
    defaultValue: false,
    options: ['true', 'false'],
    example: 'help-table-narrow=true',
    requiredInHeadless: 'No',
    purpose: 'Print help in a narrower ASCII table layout for smaller terminals, then exit without running the app.',
  },
  {
    key: 'help-table-wide',
    defaultValue: false,
    options: ['true', 'false'],
    example: 'help-table-wide=true',
    requiredInHeadless: 'No',
    purpose: 'Print help in a wide ASCII table layout for larger terminals, then exit without running the app.',
  },
  {
    key: 'help-wide',
    defaultValue: false,
    options: ['true', 'false'],
    example: 'help-wide=true',
    requiredInHeadless: 'No',
    purpose: 'Print a compact ASCII-table parameter summary (name, values, default, example, purpose) and exit without running the app.',
  },
  {
    key: 'intervalMs',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.intervalMs,
    options: ['integer >= 1'],
    example: 'intervalMs=250',
    requiredInHeadless: 'No',
    purpose: 'Delay in milliseconds between scheduler ticks.',
  },
  {
    key: 'ip',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.ip,
    options: ['IPv4-or-host-bind-address'],
    example: 'ip=127.0.0.1',
    requiredInHeadless: 'No',
    purpose: 'Target address for client mode or bind address for server mode. Default 127.0.0.1 is loopback/local-only; server mode often uses 0.0.0.0 to listen on all interfaces.',
  },
  {
    key: 'linesPerInterval',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.linesPerInterval,
    options: ['integer >= 1'],
    example: 'linesPerInterval=5',
    requiredInHeadless: 'No',
    purpose: 'How many lines are processed during each scheduler tick.',
  },
  {
    key: 'logFile',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.logFile,
    options: ['path', 'omitted'],
    example: 'logFile=./logs/run.log',
    requiredInHeadless: 'No',
    purpose: 'Optional file path for persisted headless logs.',
  },
  {
    key: 'logLevel',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.logLevel,
    options: ['error', 'warn', 'info', 'debug'],
    example: 'logLevel=debug',
    requiredInHeadless: 'No',
    purpose: 'Minimum headless log level written to stdout/logFile.',
  },
  {
    key: 'loop',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.loop,
    options: ['true', 'false'],
    example: 'loop=true',
    requiredInHeadless: 'No',
    purpose: 'Restart from startLine when the active range reaches endLine.',
  },
  {
    key: 'maxLines',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.maxLines,
    options: ['integer >= 1', 'null/omitted'],
    example: 'maxLines=1000',
    requiredInHeadless: 'No',
    purpose: 'Optional hard cap on successfully processed lines.',
  },
  {
    key: 'mode',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.mode,
    options: ['server', 'client'],
    example: 'mode=server',
    requiredInHeadless: 'No',
    purpose: 'Choose whether the simulator binds locally as a server or connects outward as a client.',
  },
  {
    key: 'onError',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.onError,
    options: ['exit', 'continue', 'pause'],
    example: 'onError=continue',
    requiredInHeadless: 'No',
    purpose: 'Choose how the headless engine responds to send failures.',
  },
  {
    key: 'port',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.port,
    options: ['1-65535'],
    example: 'port=5565',
    requiredInHeadless: 'No',
    purpose: 'Target or bind port used by the selected transport.',
  },
  {
    key: 'protocol',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.protocol,
    options: ['tcp', 'udp', 'grpc', 'http', 'ws'],
    example: 'protocol=tcp',
    requiredInHeadless: 'No',
    purpose: 'Choose the network transport for headless replay.',
  },
  {
    key: 'runId',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.runId,
    options: ['string', 'omitted'],
    example: 'runId=nightly-01',
    requiredInHeadless: 'No',
    purpose: 'Optional identifier added to logs and done-file output.',
  },
  {
    key: 'runMode',
    defaultValue: 'ui',
    options: ['ui', 'headless', 'silent'],
    example: 'runMode=headless',
    requiredInHeadless: 'Only when using the normal app entry point',
    purpose: 'Select startup mode. No parameters means the app opens in normal UI mode and restores saved UI behavior from configuration, including compact/full view.',
  },
  {
    key: 'grpcSerialization',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.grpcSerialization,
    options: ['protobuf', 'kryo', 'text'],
    example: 'grpcSerialization=protobuf',
    requiredInHeadless: 'No',
    purpose: 'gRPC feature serialization format. "protobuf" uses the Velocity external GrpcFeed protocol with typed Any-wrapped attributes. "kryo" uses the internal GrpcFeatureService protocol with raw bytes. "text" uses the internal protocol with plain UTF-8 text. Only applies when protocol=grpc.',
  },
  {
    key: 'startLine',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.startLine,
    options: ['integer >= 1'],
    example: 'startLine=100',
    requiredInHeadless: 'No',
    purpose: '1-based inclusive starting line for the replay window.',
  },
  {
    key: 'stdout',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.stdout,
    options: ['true', 'false'],
    example: 'stdout=false',
    requiredInHeadless: 'No',
    purpose: 'Enable or disable console log output during headless runs.',
  },
  {
    key: 'tlsCaPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.tlsCaPath,
    options: ['path', 'omitted'],
    example: 'tlsCaPath=./certs/ca.pem',
    requiredInHeadless: 'No',
    purpose: 'Path to a custom CA certificate file (PEM) for gRPC TLS connections. When omitted, the system default CA bundle is used. Only applies when useTls=true and protocol=grpc.',
  },
  {
    key: 'tlsCertPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.tlsCertPath,
    options: ['path', 'omitted'],
    example: 'tlsCertPath=./certs/client.pem',
    requiredInHeadless: 'No',
    purpose: 'Path to a client/server certificate file (PEM) for mutual TLS. Required for TLS server mode. Only applies when useTls=true and protocol=grpc.',
  },
  {
    key: 'tlsKeyPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.tlsKeyPath,
    options: ['path', 'omitted'],
    example: 'tlsKeyPath=./certs/client-key.pem',
    requiredInHeadless: 'No',
    purpose: 'Path to a private key file (PEM) for mutual TLS. Required for TLS server mode. Only applies when useTls=true and protocol=grpc.',
  },
  {
    key: 'useTls',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.useTls,
    options: ['true', 'false'],
    example: 'useTls=true',
    requiredInHeadless: 'No',
    purpose: 'Use TLS (SSL) for gRPC connections. When true, the connection uses SSL credentials instead of plaintext. Only applies when protocol=grpc.',
  },
  {
    key: 'httpFormat',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpFormat,
    options: ['json', 'delimited', 'esriJson', 'geojson', 'xml'],
    example: 'httpFormat=json',
    requiredInHeadless: 'No',
    purpose: 'HTTP data format controlling the Content-Type header. "json" (application/json), "delimited" (text/plain, CSV), "esriJson" (application/json), "geojson" (application/geo+json), or "xml" (application/xml). Only applies when protocol=http.',
  },
  {
    key: 'httpPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpPath,
    options: ['string'],
    example: 'httpPath=/receiver/feed-id',
    requiredInHeadless: 'No',
    purpose: 'URL path appended after host:port. In server mode, only POST requests matching this path are accepted. In client mode, this path is used in outgoing POST URLs. Only applies when protocol=http.',
  },
  {
    key: 'httpTls',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpTls,
    options: ['true', 'false'],
    example: 'httpTls=true',
    requiredInHeadless: 'No',
    purpose: 'Enable HTTPS (port 443 by default). Uses the OS certificate store automatically in client mode. Server mode requires a certificate and key. Only applies when protocol=http.',
  },
  {
    key: 'httpTlsCaPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpTlsCaPath,
    options: ['path', 'omitted'],
    example: 'httpTlsCaPath=./certs/ca.pem',
    requiredInHeadless: 'No',
    purpose: 'Custom CA certificate file (PEM) for HTTP TLS. Leave empty to use the OS certificate store. Only applies when protocol=http and httpTls=true.',
  },
  {
    key: 'httpTlsCertPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpTlsCertPath,
    options: ['path', 'omitted'],
    example: 'httpTlsCertPath=./certs/server.pem',
    requiredInHeadless: 'No',
    purpose: 'Client or server certificate file (PEM) for HTTP TLS. Required for server-mode TLS; only needed in client mode for mutual TLS (mTLS). Only applies when protocol=http and httpTls=true.',
  },
  {
    key: 'httpTlsKeyPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.httpTlsKeyPath,
    options: ['path', 'omitted'],
    example: 'httpTlsKeyPath=./certs/server-key.pem',
    requiredInHeadless: 'No',
    purpose: 'Private key file (PEM) for HTTP TLS. Required for server-mode TLS and client-side mTLS. Only applies when protocol=http and httpTls=true.',
  },
  {
    key: 'wsFormat',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsFormat,
    options: ['json', 'delimited', 'esriJson', 'geojson', 'xml'],
    example: 'wsFormat=json',
    requiredInHeadless: 'No',
    purpose: 'WebSocket data format. "json" (application/json), "delimited" (text/plain, CSV), "esriJson" (application/json), "geojson" (application/geo+json), or "xml" (application/xml). Only applies when protocol=ws.',
  },
  {
    key: 'wsHeaders',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsHeaders,
    options: ['JSON string', 'omitted'],
    example: 'wsHeaders={"Authorization":"Bearer token"}',
    requiredInHeadless: 'No',
    purpose: 'Optional JSON object of custom HTTP headers for the WebSocket upgrade request (client mode only). Only applies when protocol=ws and mode=client.',
  },
  {
    key: 'wsIgnoreFirstMsg',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsIgnoreFirstMsg,
    options: ['true', 'false'],
    example: 'wsIgnoreFirstMsg=true',
    requiredInHeadless: 'No',
    purpose: 'When true, the first message received after connecting is silently discarded. Useful when the server sends an initial handshake or acknowledgement. Only applies when protocol=ws.',
  },
  {
    key: 'wsPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsPath,
    options: ['string'],
    example: 'wsPath=/feed',
    requiredInHeadless: 'No',
    purpose: 'URL path appended after host:port for the WebSocket connection. In server mode, only upgrade requests matching this path are accepted. Only applies when protocol=ws.',
  },
  {
    key: 'wsSubscriptionMsg',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsSubscriptionMsg,
    options: ['string', 'omitted'],
    example: 'wsSubscriptionMsg=subscribe:feed1',
    requiredInHeadless: 'No',
    purpose: 'Optional text message sent to the server immediately after the WebSocket connection is established. Useful for subscribing to a specific data feed. Only applies when protocol=ws and mode=client.',
  },
  {
    key: 'wsTls',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsTls,
    options: ['true', 'false'],
    example: 'wsTls=true',
    requiredInHeadless: 'No',
    purpose: 'Enable WSS (WebSocket Secure, port 443 by default). Uses the OS certificate store automatically in client mode. Server mode requires a certificate and key. Only applies when protocol=ws.',
  },
  {
    key: 'wsTlsCaPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsTlsCaPath,
    options: ['path', 'omitted'],
    example: 'wsTlsCaPath=./certs/ca.pem',
    requiredInHeadless: 'No',
    purpose: 'Custom CA certificate file (PEM) for WebSocket TLS. Leave empty to use the OS certificate store. Only applies when protocol=ws and wsTls=true.',
  },
  {
    key: 'wsTlsCertPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsTlsCertPath,
    options: ['path', 'omitted'],
    example: 'wsTlsCertPath=./certs/server.pem',
    requiredInHeadless: 'No',
    purpose: 'Client or server certificate file (PEM) for WebSocket TLS. Required for server-mode TLS; only needed in client mode for mutual TLS (mTLS). Only applies when protocol=ws and wsTls=true.',
  },
  {
    key: 'wsTlsKeyPath',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.wsTlsKeyPath,
    options: ['path', 'omitted'],
    example: 'wsTlsKeyPath=./certs/server-key.pem',
    requiredInHeadless: 'No',
    purpose: 'Private key file (PEM) for WebSocket TLS. Required for server-mode TLS and client-side mTLS. Only applies when protocol=ws and wsTls=true.',
  },
  {
    key: 'waitForClient',
    defaultValue: DEFAULT_HEADLESS_OPTIONS.waitForClient,
    options: ['true', 'false'],
    example: 'waitForClient=true',
    requiredInHeadless: 'No',
    purpose: 'In server mode, wait for at least one recipient before advancing through the file. When false (the default), data is sent immediately and lines are advanced even if no client is connected.',
  },
];

function formatDefaultValue(value) {
  return value === null ? '(none)' : String(value);
}

function wrapTableText(value, width) {
  const text = String(value ?? '');
  if (text.length === 0) {
    return [''];
  }

  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  const pushChunkedWord = (word) => {
    for (let index = 0; index < word.length; index += width) {
      lines.push(word.slice(index, index + width));
    }
  };

  for (const word of words) {
    if (word.length > width) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      pushChunkedWord(word);
      continue;
    }

    if (!currentLine) {
      currentLine = word;
      continue;
    }

    if (`${currentLine} ${word}`.length <= width) {
      currentLine = `${currentLine} ${word}`;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

function buildAsciiTable(headers, rows, widths) {
  const border = `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const formatLine = (cells) => `| ${cells.map((cell, index) => String(cell ?? '').padEnd(widths[index])).join(' | ')} |`;

  const output = [border, formatLine(headers), border];

  rows.forEach((row) => {
    const wrappedCells = row.map((cell, index) => wrapTableText(cell, widths[index]));
    const maxHeight = Math.max(...wrappedCells.map((cellLines) => cellLines.length));

    for (let lineIndex = 0; lineIndex < maxHeight; lineIndex += 1) {
      output.push(formatLine(wrappedCells.map((cellLines) => cellLines[lineIndex] || '')));
    }

    output.push(border);
  });

  return output.join('\n');
}

function wrapParagraph(text, width, indent = '') {
  return wrapTableText(text, width).map((line) => `${indent}${line}`);
}

function formatLabeledWrappedLine(label, value, { indent = '    ', width = 96 } = {}) {
  const prefix = `${indent}${label.padEnd(8)}: `;
  const continuationPrefix = ' '.repeat(prefix.length);
  const wrappedLines = wrapTableText(value, Math.max(width - prefix.length, 12));

  return wrappedLines.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
}

function buildHelpSection(title, lines = []) {
  return [title, ...lines, ''];
}

function getExampleUsageCommands() {
  return CLI_EXAMPLE_USAGES.map((entry) => entry.command);
}

function formatExampleUsageLines({ indent = '  ', labelWidth = 16, width = 118 } = {}) {
  return CLI_EXAMPLE_USAGES.flatMap(({ label, command }) => {
    const prefix = `${indent}${label.padEnd(labelWidth)} : `;
    const continuationPrefix = ' '.repeat(prefix.length);
    const wrappedLines = wrapTableText(command, Math.max(width - prefix.length, 24));

    return wrappedLines.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
  });
}

function getHelpRows() {
  const parameterRows = CLI_PARAMETER_DEFINITIONS.map((entry) => [
    'parameter',
    entry.key,
    formatDefaultValue(entry.defaultValue),
    entry.requiredInHeadless,
    `${Array.isArray(entry.options) ? entry.options.join(' | ') : String(entry.options || '')}; e.g. ${entry.example}`,
    entry.purpose,
  ]);

  return [
    ['behavior', 'no parameters', 'ui', 'No', 'electron .', 'Starts in normal UI mode and restores saved UI behavior from configuration, including compact/full view.'],
    ['behavior', 'headless launch', 'headless', 'Yes for regular launcher', 'runMode=headless', 'Use runMode=headless (or runMode=silent) unless you use npm run start:headless.'],
    ['requirement', 'headless filename', '(none)', 'Yes', 'filename=/path/to/file.csv', 'Headless mode requires filename once headless mode is selected.'],
    ['requirement', 'all other headless params', '(varies)', 'No', 'optional', 'All other headless parameters are optional; defaults are applied automatically.'],
    ...parameterRows,
    ['alias', 'runMode=silent', 'headless', 'No', 'runMode=silent', 'Alias for runMode=headless.'],
    ['alias', 'help / h / --help / -h', 'false', 'No', 'help=true', 'Print help (compact ASCII table, no example column) and exit without running the app.'],
    ['alias', '--help-detailed', 'false', 'No', '--help-detailed', 'Print full detailed help and exit without running the app.'],
    ['alias', '--help-table-wide', 'false', 'No', '--help-table-wide', 'Print wide table help and exit without running the app.'],
    ['alias', '--help-table-narrow', 'false', 'No', '--help-table-narrow', 'Print narrow table help and exit without running the app.'],
    ['alias', '--help-wide', 'false', 'No', '--help-wide', 'Print help-wide (compact ASCII table with example column) and exit without running the app.'],
    ['alias', 'rateMs', '(alias)', 'No', 'rateMs=250', 'Accepted as an alias for intervalMs.'],
    ['note', 'config support', '(none)', 'No', 'config=/path/to/file.json', 'Accepts JSON with either top-level keys or nested headless/connection/streaming/output sections. CLI values override config-file values.'],
    ['note', '127.0.0.1', 'default ip', 'No', 'ip=127.0.0.1', 'Loopback/local-only. Use it when sender and receiver are on the same machine.'],
    ['note', '0.0.0.0', 'server bind', 'No', 'ip=0.0.0.0', 'Typical server bind value; listens on all interfaces so other machines can connect.'],
    ['note', 'help layouts', 'help', 'No', 'help=true / help-detailed=true / help-table-narrow=true / help-table-wide=true / help-wide=true', 'help omits the example column. help-wide adds the example column. help-detailed is the full text layout. Use help-table-* for ASCII table layouts.'],
    ['note', 'unknown parameters', 'startup error', 'No', HELP_COMMAND, 'Unknown CLI parameters abort startup with an error. Use help=true to review the supported parameter set.'],
    ['example', 'UI default', '-', '-', 'electron .', 'Launch the app in normal UI mode.'],
    ['example', 'UI + file', '-', '-', 'electron . filename=/absolute/path/to/data.csv', 'Launch UI mode with a startup file.'],
    ['example', 'headless server', '-', '-', 'electron . runMode=headless filename=./data.csv protocol=tcp mode=server ip=0.0.0.0 port=5565 waitForClient=true doneFile=./run.done.json', 'Headless TCP server listening beyond localhost.'],
    ['example', 'config override', '-', '-', 'electron . runMode=headless config=./docs/launch-config.client.sample.json ip=192.168.1.25 port=6000 runId=manual-override', 'Headless run using a config file plus CLI overrides.'],
    ['example', 'help only', '-', '-', 'electron . help=true', 'Print help and exit without running the app.'],
    ['example', 'help wide', '-', '-', 'electron . help-wide=true', 'Print help-wide and exit without running the app.'],
    ['example', 'help detailed', '-', '-', 'electron . help-detailed=true', 'Print detailed help and exit without running the app.'],
    ['example', 'wide table help', '-', '-', 'electron . help-table-wide=true', 'Print help in a wider table layout for large terminals.'],
    ['example', 'narrow table help', '-', '-', 'electron . help-table-narrow=true', 'Print help in a narrower table layout for smaller terminals.'],
  ];
}

function getParameterComment(entry) {
  switch (entry.key) {
    case 'help':
      return 'Also available as h=true, help, h, --help, and -h.';
    case 'help-detailed':
      return 'Also available as --help-detailed.';
    case 'help-table-wide':
      return 'Also available as --help-table-wide and npm run help:cli:wide.';
    case 'help-table-narrow':
      return 'Also available as --help-table-narrow and npm run help:cli:narrow.';
    case 'help-wide':
      return 'Also available as --help-wide.';
    case 'runMode':
      return 'Use runMode=headless (or runMode=silent) only when switching from the normal launcher.';
    case 'filename':
      return 'Also accepted as a startup file path in UI mode.';
    case 'ip':
      return '127.0.0.1 is local-only; 0.0.0.0 is commonly used for server-mode listening on all interfaces.';
    case 'loop':
      return 'exitOnComplete has no effect while loop=true.';
    case 'waitForClient':
      return 'Ignored in client mode.';
    case 'connectWaitForServer':
      return 'Ignored in server mode. Pair with connectTimeoutMs for a deadline and connectRetryIntervalMs to control retry spacing.';
    case 'config':
      return 'CLI values override config-file values.';
    case 'onError':
      return 'onError=pause may keep the process alive until it is externally stopped.';
    default:
      return '';
  }
}

function getParameterUsageCategory(entry) {
  if (entry.key === 'help' || entry.key === 'help-detailed' || entry.key === 'help-wide' || entry.key.startsWith('help-table-')) {
    return 'help';
  }

  if (entry.key === 'runMode') {
    return 'launcher';
  }

  if (entry.key === 'filename') {
    return 'shared';
  }

  return 'headless-only';
}

function getCommandLineReferenceData() {
  return {
    title: 'ArcGIS Velocity Simulator command-line reference',
    overview: [
      'No parameters start the app in normal UI mode and restore saved UI behavior from configuration, including compact/full view.',
      'Headless mode requires filename once headless mode is selected.',
      'All other headless parameters are optional because documented defaults are applied automatically.',
    ],
    helpLayouts: [
      'help=true, h=true, help, h, --help, or -h prints the compact ASCII-table help without the example column.',
      'help-wide=true or --help-wide prints the compact ASCII-table help with the example column.',
      'help-detailed=true or --help-detailed prints the full detailed parameter-by-parameter help.',
      'help-table-wide=true, --help-table-wide, or npm run help:cli:wide prints the wide ASCII table help output.',
      'help-table-narrow=true, --help-table-narrow, or npm run help:cli:narrow prints the narrow ASCII table help output.',
    ],
    parameters: CLI_PARAMETER_DEFINITIONS.map((entry) => ({
      name: entry.key,
      supportedValues: Array.isArray(entry.options) ? entry.options.join(', ') : String(entry.options || ''),
      required: entry.requiredInHeadless,
      defaultValue: formatDefaultValue(entry.defaultValue),
      example: entry.example,
      purpose: getParameterComment(entry)
        ? `${entry.purpose} ${getParameterComment(entry)}`
        : entry.purpose,
      usageCategory: getParameterUsageCategory(entry),
    })),
    notes: [
      'runMode=silent is treated the same as runMode=headless.',
      'rateMs is accepted as an alias for intervalMs.',
      'config=/path/to/file.json accepts top-level or nested headless/connection/streaming/output sections.',
      '127.0.0.1 is the default loopback/local-only address; 0.0.0.0 is a typical server bind value when remote clients should connect.',
      `Unknown CLI parameters abort startup with an error. Review the supported parameter set with ${HELP_COMMAND}.`,
      'Headless-only parameters (e.g. port, protocol, logLevel) are ignored in UI mode; a per-parameter warning is logged to the console for each one explaining why it has no effect.',
      'In headless mode, connectRetryIntervalMs is ignored and a warning is logged when connectWaitForServer=false. waitForClient is ignored in client mode. connectWaitForServer is ignored in server mode.',
      'When multiple help layouts are requested together, help-table-narrow wins, then help-table-wide, then help-detailed, then help-wide, then help.',
    ],
    examples: getExampleUsageCommands(),
  };
}

function getDetailedHelpText() {
  const lines = [
    'ArcGIS Velocity Simulator command-line help',
    'Layout: help-detailed (full parameter details)',
    '',
    ...buildHelpSection('Behavior', [
      '  - No parameters: starts in normal UI mode and restores saved UI behavior from configuration, including compact/full view.',
      '  - Headless launch: use runMode=headless (or runMode=silent) unless you are using npm run start:headless.',
      '  - Headless requirement: filename is required once headless mode is selected; all other headless parameters are optional because defaults are applied.',
    ]),
    ...buildHelpSection('Help layouts', [
      '  - help=true, h=true, help, h, --help, or -h: prints the compact ASCII-table help layout without the example column.',
      '  - help-wide=true or --help-wide: prints the compact ASCII-table help layout with the example column.',
      '  - help-detailed=true or --help-detailed: prints this full detailed layout.',
      '  - help-table-wide=true or --help-table-wide: prints a wide ASCII table layout for larger terminals.',
      '  - help-table-narrow=true or --help-table-narrow: prints a narrower ASCII table layout for smaller terminals.',
    ]),
    'Parameters',
  ];

  CLI_PARAMETER_DEFINITIONS.forEach((entry) => {
    lines.push(`  ${entry.key}`);
    lines.push(`    default : ${formatDefaultValue(entry.defaultValue)}`);
    lines.push(`    required: ${entry.requiredInHeadless}`);
    lines.push(`    values  : ${Array.isArray(entry.options) ? entry.options.join(' | ') : String(entry.options || '')}`);
    lines.push(`    example : ${entry.example}`);
    lines.push(...formatLabeledWrappedLine('purpose', entry.purpose));
    lines.push('');
  });

  lines.push(...buildHelpSection('Aliases and notes', [
    '  - runMode=silent is treated the same as runMode=headless.',
    '  - rateMs is accepted as an alias for intervalMs.',
    '  - config=/path/to/file.json accepts top-level or nested headless/connection/streaming/output sections; CLI values override config-file values.',
    '  - Default ip is 127.0.0.1 for loopback/local-only use. 0.0.0.0 is a typical server bind value when other machines should be allowed to connect.',
    `  - Unknown CLI parameters abort startup with an error. Review the supported parameter set with ${HELP_COMMAND}.`,
    '  - Headless-only parameters passed in UI mode (e.g. port, protocol, logLevel) are not treated as errors; instead a warning is logged per parameter explaining why it is ignored.',
    '  - In headless mode: connectRetryIntervalMs is warned and ignored when connectWaitForServer=false; waitForClient is ignored in client mode; connectWaitForServer is ignored in server mode.',
    '  - When multiple help layouts are requested, help-table-narrow wins, then help-table-wide, then help-detailed, then help-wide, then help.',
  ]));

  lines.push(...buildHelpSection('Examples', getExampleUsageCommands().map((command) => `  ${command}`)));

  return lines.join('\n').trimEnd();
}

function getWideHelpText() {
  const NAME_WIDTH = 24;
  const VALUES_WIDTH = 28;
  const DEFAULT_WIDTH = 14;
  const EXAMPLE_WIDTH = 44;
  const PURPOSE_WIDTH = 40;
  const widths = [NAME_WIDTH, VALUES_WIDTH, DEFAULT_WIDTH, EXAMPLE_WIDTH, PURPOSE_WIDTH];
  const rows = CLI_PARAMETER_DEFINITIONS.map((entry) => {
    const firstSentence = entry.purpose
      .replace(/\. [A-Z][a-z].*$/, '')
      .replace(/\.$/, '');
    return [
      entry.key,
      Array.isArray(entry.options) ? entry.options.join(' | ') : String(entry.options || ''),
      formatDefaultValue(entry.defaultValue),
      entry.example,
      firstSentence,
    ];
  });

  const footer = [
    '',
    'Example usages:',
    ...formatExampleUsageLines(),
    '',
    'Aliases: runMode=silent = runMode=headless | rateMs = intervalMs',
    'Bare flags: --help | --help-detailed | --help-table-wide | --help-table-narrow | --help-wide',
    'Warnings: headless-only params in UI mode log a per-parameter warning and are ignored; connectRetryIntervalMs warns when connectWaitForServer=false',
  ];

  return [
    'ArcGIS Velocity Simulator command-line help',
    'Layout: help-wide (Name | Supported Values | Default | Example | Purpose)',
    '',
    buildAsciiTable(
      ['Name', 'Supported Values', 'Default', 'Example', 'Purpose'],
      rows,
      widths,
    ),
    ...footer,
  ].join('\n');
}

function getStandardHelpText() {
  const NAME_WIDTH = 24;
  const VALUES_WIDTH = 28;
  const DEFAULT_WIDTH = 14;
  const PURPOSE_WIDTH = 40;
  const widths = [NAME_WIDTH, VALUES_WIDTH, DEFAULT_WIDTH, PURPOSE_WIDTH];
  const rows = CLI_PARAMETER_DEFINITIONS.map((entry) => {
    const firstSentence = entry.purpose
      .replace(/\. [A-Z][a-z].*$/, '')
      .replace(/\.$/, '');
    return [
      entry.key,
      Array.isArray(entry.options) ? entry.options.join(' | ') : String(entry.options || ''),
      formatDefaultValue(entry.defaultValue),
      firstSentence,
    ];
  });

  const footer = [
    '',
    'Example usages:',
    ...formatExampleUsageLines(),
    '',
    'Aliases: runMode=silent = runMode=headless | rateMs = intervalMs',
    'Bare flags: --help | --help-detailed | --help-table-wide | --help-table-narrow | --help-wide',
    'Warnings: headless-only params in UI mode log a per-parameter warning and are ignored; connectRetryIntervalMs warns when connectWaitForServer=false',
  ];

  return [
    'ArcGIS Velocity Simulator command-line help',
    'Layout: help (Name | Supported Values | Default | Purpose)',
    '',
    buildAsciiTable(
      ['Name', 'Supported Values', 'Default', 'Purpose'],
      rows,
      widths,
    ),
    ...footer,
  ].join('\n');
}

function getTableHelpText({ layout = HELP_LAYOUTS.tableWide } = {}) {
  const widths = layout === HELP_LAYOUTS.tableNarrow
    ? [10, 16, 10, 16, 28, 44]
    : [11, 20, 12, 24, 38, 62];

  const layoutLabel = layout === HELP_LAYOUTS.tableNarrow
    ? 'Layout: table-narrow (ASCII table for narrower terminals)'
    : 'Layout: table-wide (ASCII table for wider terminals)';

  return [
    'ArcGIS Velocity Simulator command-line help',
    layoutLabel,
    '',
    buildAsciiTable(
      ['Kind', 'Name', 'Default', 'Required', 'Values / Example', 'Details'],
      getHelpRows(),
      widths,
    ),
  ].join('\n');
}

function getHelpLayoutPriority(layout) {
  if (layout === HELP_LAYOUTS.tableNarrow) {
    return 5;
  }

  if (layout === HELP_LAYOUTS.tableWide) {
    return 4;
  }

  if (layout === HELP_LAYOUTS.detailed) {
    return 3;
  }

  if (layout === HELP_LAYOUTS.wide) {
    return 2;
  }

  return 1; // help
}

function mergeHelpLayout(currentLayout, nextLayout) {
  if (!currentLayout) {
    return nextLayout;
  }

  return getHelpLayoutPriority(nextLayout) >= getHelpLayoutPriority(currentLayout)
    ? nextLayout
    : currentLayout;
}

function formatUnknownCliParametersError(unknownParameters) {
  const parameterList = [...new Set(unknownParameters)].sort();
  const label = parameterList.length === 1 ? 'parameter' : 'parameters';

  return `Unknown CLI ${label}: ${parameterList.join(', ')}. These parameters are not supported. Review valid CLI parameters with: ${HELP_COMMAND}`;
}

function formatCliStartupErrorOutput(cliArgs) {
  const normalizedErrors = Array.isArray(cliArgs?.errors) ? cliArgs.errors : [];
  const helpText = cliArgs?.helpText || getCommandHelpText();
  const helpReviewText = `Review valid CLI parameters with: ${HELP_COMMAND}`;

  const startupLines = [
    'CLI startup aborted due to invalid command-line parameters. The application will exit without launching.',
  ];

  normalizedErrors.forEach((error) => {
    let detail = String(error || '').trim();
    if (!detail.includes(helpReviewText)) {
      detail = `${detail} ${helpReviewText}`.trim();
    }
    startupLines.push(`CLI error: ${detail}`);
  });

  return `${startupLines.join('\n')}\n\n${helpText}`;
}

/**
 * Expands `~` so command-line paths work naturally across shells and platforms.
 */
function expandHomeDir(value) {
  if (typeof value !== 'string') {
    return value;
  }

  if (value === '~') {
    return os.homedir();
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

/**
 * Normalizes a potentially relative path into an absolute path.
 */
function resolvePathValue(value) {
  if (!value) {
    return value;
  }

  return path.resolve(expandHomeDir(value));
}

/**
 * Parses boolean-like strings accepted by this CLI, e.g. true/false, yes/no, 1/0.
 * Validation errors are collected instead of thrown so startup can report all issues at once.
 */
function parseBoolean(value, key, errors) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    errors.push(`Missing boolean value for '${key}'.`);
    return null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (BOOLEAN_TRUE.has(normalized)) {
    return true;
  }

  if (BOOLEAN_FALSE.has(normalized)) {
    return false;
  }

  errors.push(`Invalid boolean value for '${key}': '${value}'. Use true/false.`);
  return null;
}

/**
 * Parses integer parameters with optional bounds checking.
 */
function parseInteger(value, key, errors, { min = null, max = null, allowNull = false } = {}) {
  if ((value === undefined || value === null || value === '') && allowNull) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    errors.push(`Invalid integer value for '${key}': '${value}'.`);
    return null;
  }

  if (min !== null && parsed < min) {
    errors.push(`'${key}' must be >= ${min}.`);
    return null;
  }

  if (max !== null && parsed > max) {
    errors.push(`'${key}' must be <= ${max}.`);
    return null;
  }

  return parsed;
}

/**
 * Flattens supported JSON config sections into a single key/value bag.
 *
 * This lets the launch-config file remain readable while still feeding a simple validator.
 */
function flattenConfigObject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const flattened = { ...input };

  if (input.headless && typeof input.headless === 'object' && !Array.isArray(input.headless)) {
    Object.assign(flattened, input.headless);
  }

  if (input.connection && typeof input.connection === 'object' && !Array.isArray(input.connection)) {
    Object.assign(flattened, input.connection);
  }

  if (input.streaming && typeof input.streaming === 'object' && !Array.isArray(input.streaming)) {
    Object.assign(flattened, input.streaming);
  }

  if (input.output && typeof input.output === 'object' && !Array.isArray(input.output)) {
    Object.assign(flattened, input.output);
  }

  return flattened;
}

/**
 * Loads an optional launch-config JSON file used for headless automation.
 */
function loadRunConfig(configPath, errors) {
  const resolvedConfigPath = resolvePathValue(configPath);

  try {
    const raw = fs.readFileSync(resolvedConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      path: resolvedConfigPath,
      values: flattenConfigObject(parsed),
    };
  } catch (error) {
    errors.push(`Unable to read config file '${resolvedConfigPath}': ${error.message}`);
    return {
      path: resolvedConfigPath,
      values: {},
    };
  }
}

/**
 * Applies backwards-compatible CLI aliases and normalizations.
 *
 * Current examples:
 * - `rateMs` -> `intervalMs`
 * - `silent=true` -> `runMode=headless`
 */
function normalizeKnownKeys(values) {
  const normalized = { ...values };

  if (normalized.h !== undefined && normalized.help === undefined) {
    normalized.help = normalized.h;
  }

  if (normalized.rateMs !== undefined && normalized.intervalMs === undefined) {
    normalized.intervalMs = normalized.rateMs;
  }

  if (normalized.silent !== undefined && normalized.runMode === undefined) {
    normalized.runMode = parseBoolean(normalized.silent, 'silent', []) ? 'headless' : 'ui';
  }

  return normalized;
}

/**
 * Strips the Node/Electron bootstrap arguments and returns only user-supplied args.
 */
function sliceUserArgs(rawArgv, isPackaged) {
  const startIndex = isPackaged ? 1 : 2;
  return rawArgv.slice(startIndex).filter((arg) => arg !== '.');
}

/**
 * Splits raw arguments into named `key=value` entries and positional values.
 * Positional values are still supported so UI mode can open a file directly.
 */
function parseRawArgs(rawArgs) {
  const values = {};
  const positional = [];
  const unknownFlags = [];
  let helpLayout = null;

  rawArgs.forEach((arg) => {
    if (arg === '--help' || arg === '-h' || arg === 'help' || arg === 'h') {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.standard);
      return;
    }

    if (arg === '--help-detailed' || arg === 'help-detailed') {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.detailed);
      return;
    }

    if (arg === '--help-table-wide' || arg === 'help-table-wide') {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableWide);
      return;
    }

    if (arg === '--help-table-narrow' || arg === 'help-table-narrow') {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableNarrow);
      return;
    }

    if (arg === '--help-wide' || arg === 'help-wide') {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.wide);
      return;
    }

    const normalizedArg = arg.startsWith('--') ? arg.slice(2) : arg;
    const separatorIndex = normalizedArg.indexOf('=');

    if (separatorIndex === -1) {
      if (arg.startsWith('-')) {
        unknownFlags.push(arg);
        return;
      }

      positional.push(arg);
      return;
    }

    const key = normalizedArg.slice(0, separatorIndex).trim();
    const value = normalizedArg.slice(separatorIndex + 1).trim();

    if (!key) {
      positional.push(arg);
      return;
    }

    values[key] = value;
    if (key === 'h' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.standard);
    }
    if (key === 'help' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.standard);
    }
    if (key === 'help-detailed' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.detailed);
    }
    if (key === 'help-table-wide' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableWide);
    }
    if (key === 'help-table-narrow' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableNarrow);
    }
    if (key === 'help-wide' && BOOLEAN_TRUE.has(String(value).toLowerCase())) {
      helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.wide);
    }
  });

  return { values, positional, helpLayout, unknownFlags };
}

/**
 * Validates and normalizes headless-mode options.
 *
 * This function also applies a few guardrail adjustments with warnings instead of errors,
 * for example forcing `autoConnect=true` when `autoStart=true`.
 */
function validateHeadlessOptions(values, errors, warnings) {
  const options = { ...DEFAULT_HEADLESS_OPTIONS };
  const normalized = normalizeKnownKeys(values);

  if (normalized.runMode !== undefined) {
    const runMode = String(normalized.runMode).trim().toLowerCase();
    if (!VALID_RUN_MODES.has(runMode)) {
      errors.push(`Invalid runMode '${normalized.runMode}'. Use ui, silent, or headless.`);
    } else {
      options.runMode = runMode === 'silent' ? 'headless' : runMode;
    }
  }

  if (normalized.filename !== undefined) {
    options.filename = resolvePathValue(normalized.filename);
  }

  if (normalized.protocol !== undefined) {
    const protocol = String(normalized.protocol).trim().toLowerCase();
    if (!VALID_PROTOCOLS.has(protocol)) {
      errors.push(`Invalid protocol '${normalized.protocol}'. Use tcp, udp, grpc, http, or ws.`);
    } else {
      options.protocol = protocol;
    }
  }

  if (normalized.mode !== undefined) {
    const mode = String(normalized.mode).trim().toLowerCase();
    if (!VALID_MODES.has(mode)) {
      errors.push(`Invalid mode '${normalized.mode}'. Use server or client.`);
    } else {
      options.mode = mode;
    }
  }

  if (normalized.ip !== undefined) {
    options.ip = String(normalized.ip).trim();
  }

  if (normalized.port !== undefined) {
    options.port = parseInteger(normalized.port, 'port', errors, { min: 1, max: 65535 });
  }

  if (normalized.linesPerInterval !== undefined) {
    options.linesPerInterval = parseInteger(normalized.linesPerInterval, 'linesPerInterval', errors, { min: 1 });
  }

  if (normalized.intervalMs !== undefined) {
    options.intervalMs = parseInteger(normalized.intervalMs, 'intervalMs', errors, { min: 1 });
  }

  if (normalized.loop !== undefined) {
    options.loop = parseBoolean(normalized.loop, 'loop', errors);
  }

  if (normalized.autoConnect !== undefined) {
    options.autoConnect = parseBoolean(normalized.autoConnect, 'autoConnect', errors);
  }

  if (normalized.autoStart !== undefined) {
    options.autoStart = parseBoolean(normalized.autoStart, 'autoStart', errors);
  }

  if (normalized.exitOnComplete !== undefined) {
    options.exitOnComplete = parseBoolean(normalized.exitOnComplete, 'exitOnComplete', errors);
  }

  if (normalized.waitForClient !== undefined) {
    options.waitForClient = parseBoolean(normalized.waitForClient, 'waitForClient', errors);
  }

  if (normalized.connectWaitForServer !== undefined) {
    options.connectWaitForServer = parseBoolean(normalized.connectWaitForServer, 'connectWaitForServer', errors);
  }

  if (normalized.connectRetryIntervalMs !== undefined) {
    options.connectRetryIntervalMs = parseInteger(normalized.connectRetryIntervalMs, 'connectRetryIntervalMs', errors, { min: 1 });
  }

  if (normalized.startLine !== undefined) {
    options.startLine = parseInteger(normalized.startLine, 'startLine', errors, { min: 1 });
  }

  if (normalized.endLine !== undefined && normalized.endLine !== '') {
    options.endLine = parseInteger(normalized.endLine, 'endLine', errors, { min: 1, allowNull: true });
  }

  if (normalized.maxLines !== undefined && normalized.maxLines !== '') {
    options.maxLines = parseInteger(normalized.maxLines, 'maxLines', errors, { min: 1, allowNull: true });
  }

  if (normalized.connectTimeoutMs !== undefined) {
    options.connectTimeoutMs = parseInteger(normalized.connectTimeoutMs, 'connectTimeoutMs', errors, { min: 0 });
  }

  if (normalized.logLevel !== undefined) {
    const logLevel = String(normalized.logLevel).trim().toLowerCase();
    if (!VALID_LOG_LEVELS.has(logLevel)) {
      errors.push(`Invalid logLevel '${normalized.logLevel}'. Use error, warn, info, or debug.`);
    } else {
      options.logLevel = logLevel;
    }
  }

  if (normalized.logFile !== undefined && normalized.logFile !== '') {
    options.logFile = resolvePathValue(normalized.logFile);
  }

  if (normalized.config !== undefined && normalized.config !== '') {
    options.config = resolvePathValue(normalized.config);
  }

  if (normalized.onError !== undefined) {
    const onError = String(normalized.onError).trim().toLowerCase();
    if (!VALID_ON_ERROR.has(onError)) {
      errors.push(`Invalid onError '${normalized.onError}'. Use exit, continue, or pause.`);
    } else {
      options.onError = onError;
    }
  }

  if (normalized.doneFile !== undefined && normalized.doneFile !== '') {
    options.doneFile = resolvePathValue(normalized.doneFile);
  }

  if (normalized.runId !== undefined && normalized.runId !== '') {
    options.runId = String(normalized.runId).trim();
  }

  if (normalized.stdout !== undefined) {
    options.stdout = parseBoolean(normalized.stdout, 'stdout', errors);
  }

  if (normalized.grpcHeaderPathKey !== undefined && normalized.grpcHeaderPathKey !== '') {
    options.grpcHeaderPathKey = String(normalized.grpcHeaderPathKey).trim();
  }

  if (normalized.grpcHeaderPath !== undefined && normalized.grpcHeaderPath !== '') {
    options.grpcHeaderPath = String(normalized.grpcHeaderPath).trim();
  }

  if (normalized.grpcSendMethod !== undefined) {
    const method = String(normalized.grpcSendMethod).trim().toLowerCase();
    if (!VALID_GRPC_SEND_METHODS.has(method)) {
      errors.push(`Invalid grpcSendMethod '${normalized.grpcSendMethod}'. Use stream or unary.`);
    } else {
      options.grpcSendMethod = method;
    }
  }

  if (normalized.useTls !== undefined) {
    options.useTls = normalized.useTls === true || normalized.useTls === 'true';
  }

  if (normalized.tlsCaPath !== undefined && normalized.tlsCaPath !== '') {
    options.tlsCaPath = resolvePathValue(normalized.tlsCaPath);
  }
  if (normalized.tlsCertPath !== undefined && normalized.tlsCertPath !== '') {
    options.tlsCertPath = resolvePathValue(normalized.tlsCertPath);
  }
  if (normalized.tlsKeyPath !== undefined && normalized.tlsKeyPath !== '') {
    options.tlsKeyPath = resolvePathValue(normalized.tlsKeyPath);
  }

  // --- HTTP params ---
  if (normalized.httpFormat !== undefined) {
    const fmt = String(normalized.httpFormat).trim().toLowerCase();
    if (!VALID_DATA_FORMATS.has(fmt)) {
      errors.push(`Invalid httpFormat '${normalized.httpFormat}'. Use json, delimited, esriJson, geojson, or xml.`);
    } else { options.httpFormat = fmt; }
  }
  if (normalized.httpTls !== undefined) {
    options.httpTls = parseBoolean(normalized.httpTls, 'httpTls', errors);
  }
  if (normalized.httpPath !== undefined && normalized.httpPath !== '') {
    options.httpPath = String(normalized.httpPath).trim();
  }
  if (normalized.httpTlsCaPath !== undefined && normalized.httpTlsCaPath !== '') {
    options.httpTlsCaPath = resolvePathValue(normalized.httpTlsCaPath);
  }
  if (normalized.httpTlsCertPath !== undefined && normalized.httpTlsCertPath !== '') {
    options.httpTlsCertPath = resolvePathValue(normalized.httpTlsCertPath);
  }
  if (normalized.httpTlsKeyPath !== undefined && normalized.httpTlsKeyPath !== '') {
    options.httpTlsKeyPath = resolvePathValue(normalized.httpTlsKeyPath);
  }

  // --- WebSocket params ---
  if (normalized.wsFormat !== undefined) {
    const fmt = String(normalized.wsFormat).trim().toLowerCase();
    if (!VALID_DATA_FORMATS.has(fmt)) {
      errors.push(`Invalid wsFormat '${normalized.wsFormat}'. Use json, delimited, esriJson, geojson, or xml.`);
    } else { options.wsFormat = fmt; }
  }
  if (normalized.wsTls !== undefined) {
    options.wsTls = parseBoolean(normalized.wsTls, 'wsTls', errors);
  }
  if (normalized.wsPath !== undefined && normalized.wsPath !== '') {
    options.wsPath = String(normalized.wsPath).trim();
  }
  if (normalized.wsTlsCaPath !== undefined && normalized.wsTlsCaPath !== '') {
    options.wsTlsCaPath = resolvePathValue(normalized.wsTlsCaPath);
  }
  if (normalized.wsTlsCertPath !== undefined && normalized.wsTlsCertPath !== '') {
    options.wsTlsCertPath = resolvePathValue(normalized.wsTlsCertPath);
  }
  if (normalized.wsTlsKeyPath !== undefined && normalized.wsTlsKeyPath !== '') {
    options.wsTlsKeyPath = resolvePathValue(normalized.wsTlsKeyPath);
  }
  if (normalized.wsSubscriptionMsg !== undefined && normalized.wsSubscriptionMsg !== '') {
    options.wsSubscriptionMsg = String(normalized.wsSubscriptionMsg);
  }
  if (normalized.wsIgnoreFirstMsg !== undefined) {
    options.wsIgnoreFirstMsg = parseBoolean(normalized.wsIgnoreFirstMsg, 'wsIgnoreFirstMsg', errors);
  }
  if (normalized.wsHeaders !== undefined && normalized.wsHeaders !== '') {
    options.wsHeaders = String(normalized.wsHeaders);
  }

  if (!options.filename) {
    errors.push("Headless mode requires 'filename=/path/to/file.csv'.");
  }

  if (options.mode === 'client' && !options.ip) {
    errors.push("Client mode requires 'ip=<address>'.");
  }

  if (options.endLine !== null && options.endLine < options.startLine) {
    errors.push("'endLine' must be greater than or equal to 'startLine'.");
  }

  if (!options.autoConnect && options.autoStart) {
    warnings.push("'autoStart=true' requires a connection. 'autoConnect' has been forced to true.");
    options.autoConnect = true;
  }

  if (options.waitForClient && options.mode === 'client') {
    warnings.push("'waitForClient' is ignored in client mode.");
    options.waitForClient = false;
  }

  if (options.connectWaitForServer && options.mode === 'server') {
    warnings.push("'connectWaitForServer' is ignored in server mode.");
    options.connectWaitForServer = false;
  }

  if (!options.connectWaitForServer && normalized.connectRetryIntervalMs !== undefined) {
    warnings.push("'connectRetryIntervalMs' has no effect when 'connectWaitForServer=false'; retry intervals are only used when the simulator is configured to wait for the server.");
  }

  if (options.loop && options.exitOnComplete) {
    warnings.push("'exitOnComplete=true' has no effect while 'loop=true'.");
  }

  if (options.onError === 'pause' && options.exitOnComplete) {
    warnings.push("'onError=pause' may keep the process alive until it is externally stopped.");
  }

  return options;
}

/**
 * Builds terminal help text for the supported help layouts.
 */
function getCommandHelpText({ layout = HELP_LAYOUTS.standard } = {}) {
  if (layout === HELP_LAYOUTS.tableWide) {
    return getTableHelpText({ layout: HELP_LAYOUTS.tableWide });
  }

  if (layout === HELP_LAYOUTS.tableNarrow) {
    return getTableHelpText({ layout: HELP_LAYOUTS.tableNarrow });
  }

  if (layout === HELP_LAYOUTS.detailed) {
    return getDetailedHelpText();
  }

  if (layout === HELP_LAYOUTS.wide) {
    return getWideHelpText();
  }

  return getStandardHelpText();
}

/**
 * Main CLI entry point used by `src/main.js`.
 *
 * Returns a structured object describing:
 * - the resolved startup mode (`ui`, `headless`, `help`, or `error`)
 * - validation errors and non-fatal warnings
 * - UI startup file information
 * - fully normalized headless options when applicable
 */
function parseCommandLineArgs(rawArgv, { isPackaged = false } = {}) {
  const rawArgs = sliceUserArgs(rawArgv, isPackaged);
  const {
    values: rawValues,
    positional,
    helpLayout: rawHelpLayout,
    unknownFlags,
  } = parseRawArgs(rawArgs);
  let helpLayout = rawHelpLayout;

  if (parseBoolean(rawValues.help, 'help', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.standard);
  }

  if (parseBoolean(rawValues.h, 'h', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.standard);
  }

  if (parseBoolean(rawValues['help-detailed'], 'help-detailed', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.detailed);
  }

  if (parseBoolean(rawValues['help-table-wide'], 'help-table-wide', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableWide);
  }

  if (parseBoolean(rawValues['help-table-narrow'], 'help-table-narrow', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.tableNarrow);
  }

  if (parseBoolean(rawValues['help-wide'], 'help-wide', []) === true) {
    helpLayout = mergeHelpLayout(helpLayout, HELP_LAYOUTS.wide);
  }

  const helpRequested = Boolean(helpLayout);

  // Resolve explain: defaults to true when not provided
  const explainRaw = rawValues.explain;
  const explain = explainRaw === undefined ? true : parseBoolean(explainRaw, 'explain', []) !== false;

  if (helpRequested) {
    const startupFilePath = rawValues.filename
      ? resolvePathValue(rawValues.filename)
      : null;

    return {
      mode: 'help',
      explain,
      errors: [],
      warnings: [],
      rawArgs,
      positional,
      ui: {
        startupFilePath,
      },
      headless: null,
      helpText: getCommandHelpText({ layout: helpLayout }),
      configPath: rawValues.config ? resolvePathValue(rawValues.config) : null,
    };
  }

  const errors = [];
  const warnings = [];

  if (positional.length > 0) {
    errors.push(
      `Unknown CLI argument${positional.length === 1 ? '' : 's'}: ${positional.join(', ')}. Use name=value syntax for supported CLI parameters. Review valid CLI parameters with: ${HELP_COMMAND}`,
    );
  }

  const unknownKeys = Object.keys(rawValues).filter((key) => !CLI_OPTION_KEYS.has(key) && key !== 'h' && key !== 'rateMs' && key !== 'silent');
  const unknownParameters = [...unknownKeys, ...unknownFlags];

  if (unknownParameters.length > 0) {
    errors.push(formatUnknownCliParametersError(unknownParameters));
  }

  let configLoad = { path: null, values: {} };
  if (rawValues.config) {
    configLoad = loadRunConfig(rawValues.config, errors);
  }

  const mergedValues = {
    ...configLoad.values,
    ...rawValues,
  };


  const requestedRunMode = (mergedValues.runMode || 'ui').toString().trim().toLowerCase();
  const normalizedRunMode = requestedRunMode === 'silent' ? 'headless' : requestedRunMode;
  const headlessRequested = normalizedRunMode === 'headless';

  if (!VALID_RUN_MODES.has(requestedRunMode)) {
    errors.push(`Invalid runMode '${mergedValues.runMode}'. Use ui, silent, or headless.`);
  }

  const uiStartupFilePath = mergedValues.filename ? resolvePathValue(mergedValues.filename) : null;
  const headlessOptions = headlessRequested ? validateHeadlessOptions(mergedValues, errors, warnings) : null;
  let uiStartupPresets = null;

  if (!headlessRequested) {
    // Keys that can prepopulate the UI when passed in UI mode.
    const uiPresetKeys = new Set([
      'protocol', 'mode', 'ip', 'port', 'grpcSerialization', 'grpcSendMethod',
      'grpcHeaderPath', 'grpcHeaderPathKey', 'useTls', 'tlsCaPath', 'tlsCertPath', 'tlsKeyPath',
      'httpFormat', 'httpTls', 'httpPath', 'httpTlsCaPath', 'httpTlsCertPath', 'httpTlsKeyPath',
      'wsFormat', 'wsTls', 'wsPath', 'wsTlsCaPath', 'wsTlsCertPath', 'wsTlsKeyPath',
      'wsSubscriptionMsg', 'wsIgnoreFirstMsg', 'wsHeaders',
      'intervalMs', 'linesPerInterval', 'loop',
    ]);
    const uiRecognizedKeys = new Set(['filename', 'runMode', 'config', 'explain', 'help', 'help-detailed', 'help-table-narrow', 'help-table-wide', 'help-wide', ...uiPresetKeys]);
    const ignoredKeys = Object.keys(mergedValues).filter((key) => CLI_OPTION_KEYS.has(key) && !uiRecognizedKeys.has(key));
    ignoredKeys.sort().forEach((key) => {
      const reason = UI_PARAMETER_IGNORE_REASONS[key] || 'not used in UI mode';
      warnings.push(`CLI parameter '${key}' is ignored in UI mode: ${reason}.`);
    });

    // Build a presets object for UI prepopulation
    const presets = {};
    for (const key of uiPresetKeys) {
      if (mergedValues[key] !== undefined) {
        presets[key] = mergedValues[key];
      }
    }
    // Normalize rateMs alias
    if (mergedValues.rateMs !== undefined && presets.intervalMs === undefined) {
      presets.intervalMs = mergedValues.rateMs;
    }
    uiStartupPresets = Object.keys(presets).length > 0 ? presets : null;
  }

  let mode = 'ui';
  if (helpRequested) {
    mode = 'help';
  } else if (headlessRequested) {
    mode = 'headless';
  }

  if (errors.length > 0) {
    mode = 'error';
  }

  return {
    mode,
    explain,
    errors,
    warnings,
    rawArgs,
    positional,
    ui: {
      startupFilePath: uiStartupFilePath,
      presets: uiStartupPresets,
    },
    headless: headlessOptions,
    helpText: getCommandHelpText(),
    configPath: configLoad.path,
  };
}

/**
 * Builds a well-formatted startup explanation describing how the app will run
 * based on the resolved CLI options, including active parameters and warnings.
 */
function formatExplainOutput(cliOptions) {
  const divider = cliDivider(72);
  const sectionDivider = '  ' + cliDivider(40);
  const lines = [];

  lines.push('');
  lines.push(divider);
  lines.push(`  ArcGIS Velocity Simulator${CLI_SYMBOLS.separator}Startup Explanation`);
  lines.push(divider);
  lines.push('');

  // --- Mode ---
  const modeLabel = {
    ui: 'UI (interactive)',
    headless: 'Headless (no UI)',
    help: 'Help (print help and exit)',
    error: 'Error (startup aborted)',
  }[cliOptions.mode] || cliOptions.mode;

  lines.push(`  Run mode : ${modeLabel}`);

  // --- Config file ---
  if (cliOptions.configPath) {
    lines.push(`  Config   : ${cliOptions.configPath}`);
  }

  // --- UI mode details ---
  if (cliOptions.mode === 'ui') {
    const presets = cliOptions.ui && cliOptions.ui.presets;

    lines.push('');
    lines.push('  UI Configuration');
    lines.push(sectionDivider);

    const d = DEFAULT_HEADLESS_OPTIONS;
    const configLines = [
      ['startupFile', (cliOptions.ui && cliOptions.ui.startupFilePath) || '(none)'],
      ['protocol', (presets && presets.protocol) || `(default: ${d.protocol})`],
      ['mode', (presets && presets.mode) || `(default: ${d.mode})`],
      ['ip', (presets && presets.ip) || `(default: ${d.ip})`],
      ['port', (presets && presets.port) || `(default: ${d.port})`],
      ['grpcSerialization', (presets && presets.grpcSerialization) || `(default: ${d.grpcSerialization})`],
      ['grpcSendMethod', (presets && presets.grpcSendMethod) || `(default: ${d.grpcSendMethod})`],
      ['grpcHeaderPath', (presets && presets.grpcHeaderPath) || `(default: ${d.grpcHeaderPath})`],
      ['grpcHeaderPathKey', (presets && presets.grpcHeaderPathKey) || `(default: ${d.grpcHeaderPathKey})`],
      ['useTls', presets && presets.useTls !== undefined ? presets.useTls : `(default: ${d.useTls})`],
      ['httpFormat', (presets && presets.httpFormat) || `(default: ${d.httpFormat})`],
      ['httpTls', presets && presets.httpTls !== undefined ? presets.httpTls : `(default: ${d.httpTls})`],
      ['httpPath', (presets && presets.httpPath) || `(default: ${d.httpPath})`],
      ['wsFormat', (presets && presets.wsFormat) || `(default: ${d.wsFormat})`],
      ['wsTls', presets && presets.wsTls !== undefined ? presets.wsTls : `(default: ${d.wsTls})`],
      ['wsPath', (presets && presets.wsPath) || `(default: ${d.wsPath})`],
      ['linesPerInterval', (presets && presets.linesPerInterval) || `(default: ${d.linesPerInterval})`],
      ['intervalMs', presets && presets.intervalMs ? `${presets.intervalMs}ms` : `(default: ${d.intervalMs}ms)`],
      ['loop', presets && presets.loop !== undefined ? presets.loop : `(default: ${d.loop})`],
    ];

    const maxKeyLen = Math.max(...configLines.map(([key]) => key.length));
    configLines.forEach(([key, value]) => {
      lines.push(`    ${key.padEnd(maxKeyLen)}  ${value}`);
    });

    // --- UI behavior summary ---
    lines.push('');
    lines.push('  Behavior Summary');
    lines.push(sectionDivider);
    lines.push('    The app will open in normal UI mode and restore saved behavior');
    lines.push('    from the configuration file, including the compact/full view.');

    if (presets && presets.protocol && presets.mode) {
      const addr = `${presets.ip || 'localhost'}:${presets.port || '5000'}`;
      if (presets.mode === 'server') {
        lines.push(`    Transport : ${presets.protocol.toUpperCase()} server listening on ${addr}`);
      } else {
        lines.push(`    Transport : ${presets.protocol.toUpperCase()} client connecting to ${addr}`);
      }
    } else {
      lines.push('    Transport : will use UI-selected protocol and mode');
    }

    if (presets && presets.linesPerInterval) {
      const interval = presets.intervalMs || '1000';
      lines.push(`    Streaming : ${presets.linesPerInterval} line(s) every ${interval}ms`);
    } else {
      lines.push('    Streaming : will use UI-configured rate');
    }

    const loopVal = presets && presets.loop !== undefined ? presets.loop : null;
    if (loopVal !== null) {
      lines.push(`    Loop      : ${loopVal ? `yes${CLI_SYMBOLS.separator}restarts from beginning after reaching end` : `no${CLI_SYMBOLS.separator}stops after one pass`}`);
    } else {
      lines.push('    Loop      : will use UI-configured setting');
    }

    if (cliOptions.ui && cliOptions.ui.startupFilePath) {
      lines.push(`    File      : ${cliOptions.ui.startupFilePath} (auto-loaded on startup)`);
    } else {
      lines.push('    File      : none (select via UI)');
    }
  }

  // --- Headless mode details ---
  if (cliOptions.mode === 'headless' && cliOptions.headless) {
    const h = cliOptions.headless;
    lines.push('');
    lines.push('  Headless Configuration');
    lines.push(sectionDivider);

    const paramLines = [
      ['filename', h.filename || '(none)'],
      ['grpcHeaderPath', h.grpcHeaderPath || DEFAULT_HEADLESS_OPTIONS.grpcHeaderPath],
      ['grpcHeaderPathKey', h.grpcHeaderPathKey || DEFAULT_HEADLESS_OPTIONS.grpcHeaderPathKey],
      ['grpcSendMethod', h.grpcSendMethod || DEFAULT_HEADLESS_OPTIONS.grpcSendMethod],
      ['protocol', h.protocol],
      ['mode', h.mode],
      ['ip', h.ip],
      ['port', h.port],
      ['linesPerInterval', h.linesPerInterval],
      ['intervalMs', `${h.intervalMs}ms`],
      ['loop', h.loop],
      ['autoConnect', h.autoConnect],
      ['autoStart', h.autoStart],
      ['exitOnComplete', h.exitOnComplete],
      ['waitForClient', h.waitForClient],
      ['connectWaitForServer', h.connectWaitForServer],
      ['connectRetryIntervalMs', `${h.connectRetryIntervalMs}ms`],
      ['connectTimeoutMs', h.connectTimeoutMs === 0 ? '0 (indefinite)' : `${h.connectTimeoutMs}ms`],
      ['startLine', h.startLine],
      ['endLine', h.endLine === null ? '(end of file)' : h.endLine],
      ['maxLines', h.maxLines === null ? '(unlimited)' : h.maxLines],
      ['logLevel', h.logLevel],
      ['logFile', h.logFile || '(none)'],
      ['stdout', h.stdout],
      ['onError', h.onError],
      ['doneFile', h.doneFile || '(none)'],
      ['runId', h.runId || '(none)'],
    ];

    const maxKeyLen = Math.max(...paramLines.map(([key]) => key.length));
    paramLines.forEach(([key, value]) => {
      lines.push(`    ${key.padEnd(maxKeyLen)}  ${value}`);
    });

    // --- Headless behavior summary ---
    lines.push('');
    lines.push('  Behavior Summary');
    lines.push(sectionDivider);

    if (h.mode === 'server') {
      lines.push(`    Transport : ${h.protocol.toUpperCase()} server listening on ${h.ip}:${h.port}`);
      if (h.waitForClient) {
        lines.push('    Wait      : will wait for at least one client before streaming');
      } else {
        lines.push('    Wait      : streaming starts immediately (data discarded if no clients)');
      }
    } else {
      lines.push(`    Transport : ${h.protocol.toUpperCase()} client connecting to ${h.ip}:${h.port}`);
      if (h.connectWaitForServer) {
        const deadline = h.connectTimeoutMs === 0 ? 'indefinitely' : `up to ${h.connectTimeoutMs}ms`;
        lines.push(`    Retry     : will retry every ${h.connectRetryIntervalMs}ms, waiting ${deadline}`);
      } else {
        lines.push('    Retry     : disabled (a failed connection attempt aborts the run)');
      }
    }

    lines.push(`    Streaming : ${h.linesPerInterval} line(s) every ${h.intervalMs}ms`);
    const rangeEnd = h.endLine === null ? 'end of file' : `line ${h.endLine}`;
    lines.push(`    Range     : line ${h.startLine} through ${rangeEnd}${h.maxLines !== null ? `, capped at ${h.maxLines} lines` : ''}`);
    lines.push(`    Loop      : ${h.loop ? `yes${CLI_SYMBOLS.separator}restarts from startLine after reaching endLine` : `no${CLI_SYMBOLS.separator}stops after one pass`}`);
    lines.push(`    On error  : ${h.onError}`);
    lines.push(`    Exit      : ${h.exitOnComplete ? `yes${CLI_SYMBOLS.separator}process exits after completion` : `no${CLI_SYMBOLS.separator}process stays alive after completion`}`);
    if (h.doneFile) {
      lines.push(`    Done file : ${h.doneFile}`);
    }
  }

  // --- Warnings ---
  if (cliOptions.warnings && cliOptions.warnings.length > 0) {
    lines.push('');
    lines.push('  Warnings');
    lines.push(sectionDivider);
    cliOptions.warnings.forEach((w) => {
      lines.push(`    ${CLI_SYMBOLS.warning}  ${w}`);
    });
  }

  // --- Errors ---
  if (cliOptions.errors && cliOptions.errors.length > 0) {
    lines.push('');
    lines.push('  Errors');
    lines.push(sectionDivider);
    cliOptions.errors.forEach((e) => {
      lines.push(`    ${CLI_SYMBOLS.error}  ${e}`);
    });
  }

  lines.push('');
  lines.push(divider);
  lines.push('');

  return lines.join('\n');
}

module.exports.DEFAULT_HEADLESS_OPTIONS = DEFAULT_HEADLESS_OPTIONS;
module.exports.formatCliStartupErrorOutput = formatCliStartupErrorOutput;
module.exports.formatExplainOutput = formatExplainOutput;
module.exports.getCommandLineReferenceData = getCommandLineReferenceData;
module.exports.getCommandHelpText = getCommandHelpText;
module.exports.parseCommandLineArgs = parseCommandLineArgs;
module.exports.resolvePathValue = resolvePathValue;

