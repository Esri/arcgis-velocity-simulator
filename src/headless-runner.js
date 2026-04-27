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
 * @file headless-runner.js
 * @description
 * High-level orchestrator for true no-UI execution.
 *
 * Purpose:
 * - construct the backend logger, transport, and simulation engine
 * - run a fully automated replay session from validated CLI options
 * - write optional completion/failure metadata to a done file
 * - map outcomes to stable process exit codes
 *
 * This module is intentionally small: it coordinates lifecycle and process-facing behavior,
 * while the detailed replay logic lives in `simulation-engine.js` and networking lives in
 * `transport-manager.js`.
 */
const fs = require('fs');
const path = require('path');
const { SimulationEngine } = require('./simulation-engine.js');
const { TransportManager } = require('./transport-manager.js');
const { RunLogger } = require('./run-logger.js');

/**
 * Exit codes used when headless mode is launched from the terminal or Electron main process.
 */
const EXIT_CODES = {
  success: 0,
  configurationError: 1,
  runtimeError: 2,
};

/**
 * Persists a JSON status artifact for CI, scripting, or external orchestration.
 *
 * The done file is optional and is written for both success and failure paths.
 */
function writeDoneFile(doneFile, payload) {
  if (!doneFile) {
    return;
  }

  const resolvedPath = path.resolve(doneFile);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, JSON.stringify(payload, null, 2), 'utf8');
}

/**
 * Runs one fully configured headless session.
 *
 * Behavior summary:
 * - builds logger/transport/engine instances from normalized options
 * - executes the engine and records a final summary
 * - disconnects transport resources on both success and failure paths
 * - writes a done file when requested
 * - optionally exits the Electron app with a stable exit code
 *
 * Special case:
 * - if `autoStart=false` and `exitOnComplete=false`, the session remains in a ready state
 *   and this function intentionally returns a never-resolving promise so the process stays alive
 *   for external control or inspection.
 */
async function runHeadlessSession(options, { app = null } = {}) {
  const logger = new RunLogger({
    logLevel: options.logLevel,
    stdout: options.stdout,
    logFile: options.logFile,
    runId: options.runId,
  });

  const transport = new TransportManager({ logger });
  const engine = new SimulationEngine({
    transport,
    logger,
    options,
  });

  const baseDonePayload = {
    runId: options.runId || null,
    filePath: options.filename,
    protocol: options.protocol,
    mode: options.mode,
    ip: options.ip,
    port: options.port,
  };

  try {
    logger.info(`Starting headless run using file ${options.filename}`);
    const summary = await engine.run();

    if (summary.status === 'ready' && !options.autoStart && !options.exitOnComplete) {
      logger.info('Headless run is initialized and will remain active because autoStart=false and exitOnComplete=false.');
      writeDoneFile(options.doneFile, {
        ...baseDonePayload,
        success: true,
        summary,
      });
      return new Promise(() => {});
    }

    await transport.disconnect();
    logger.info(`Headless run finished with status '${summary.status}'. Lines processed: ${summary.linesSent}`);
    writeDoneFile(options.doneFile, {
      ...baseDonePayload,
      success: true,
      summary,
    });

    if (app && options.exitOnComplete !== false) {
      app.exit(EXIT_CODES.success);
      return EXIT_CODES.success;
    }

    return EXIT_CODES.success;
  } catch (error) {
    logger.error(`Headless run failed: ${error.message}`);
    try {
      await transport.disconnect();
    } catch (disconnectError) {
      logger.warn(`Additional disconnect error: ${disconnectError.message}`);
    }

    writeDoneFile(options.doneFile, {
      ...baseDonePayload,
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
      },
      failedAt: new Date().toISOString(),
    });

    if (app) {
      app.exit(EXIT_CODES.runtimeError);
    }

    return EXIT_CODES.runtimeError;
  }
}

module.exports.EXIT_CODES = EXIT_CODES;
module.exports.runHeadlessSession = runHeadlessSession;
module.exports.writeDoneFile = writeDoneFile;

