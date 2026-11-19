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
'use strict';

const os = require('os');
const path = require('path');
const { parseCommandLineArgs, formatCliStartupErrorOutput, formatExplainOutput } = require('./cli-options');
const { runHeadlessSession, EXIT_CODES } = require('./headless-runner');
const { RunLogger } = require('./run-logger');
const { resolveAppLogFile } = require('./app-log-path');

async function runCli(parsed) {
  if (parsed.mode === 'help') { console.log(parsed.helpText); return EXIT_CODES.success; }
  if (parsed.mode === 'error') { console.error(formatCliStartupErrorOutput(parsed)); return EXIT_CODES.configurationError; }
  if (parsed.mode !== 'headless') {
    console.error('[Startup] The no-display entry requires runMode=headless or a help option.');
    return EXIT_CODES.configurationError;
  }
  const logFile = resolveAppLogFile({
    explicitLogFile: parsed.logFile, appSlug: 'arcgis-velocity-simulator',
    filePrefix: 'velocity-simulator', isPackaged: Boolean(process.versions.electron), homePath: os.homedir(),
    userDataPath: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'arcgis-velocity-simulator'),
  });
  const logger = new RunLogger({ logLevel: parsed.logLevel, logFile, stdout: parsed.headless.stdout });
  for (const warning of parsed.warnings) logger.warn(`[Startup] ${warning}`);
  if (parsed.explain) logger.info(`[Startup] ${formatExplainOutput(parsed)}`);
  const controller = new AbortController();
  let signalCode;
  const interrupt = () => { signalCode = 130; controller.abort(); };
  const terminate = () => { signalCode = 143; controller.abort(); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  const keepAlive = setInterval(() => {}, 2147483647);
  try {
    const code = await runHeadlessSession({ ...parsed.headless, logFile }, { logger, signal: controller.signal });
    return signalCode || code;
  } finally {
    clearInterval(keepAlive);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

async function main(argv = process.argv) {
  return runCli(parseCommandLineArgs(argv, { isPackaged: false }));
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(`[Startup] ${error.message}`);
  process.exitCode = EXIT_CODES.runtimeError;
});
module.exports = { main, runCli };
