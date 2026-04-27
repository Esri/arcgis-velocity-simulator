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
 * @file simulation-engine.js
 * @description
 * Core replay/session engine for headless execution.
 *
 * Purpose:
 * - load an input file without renderer/UI dependencies
 * - apply line-window constraints such as `startLine`, `endLine`, and `maxLines`
 * - coordinate connection setup with the transport layer
 * - schedule timed sends at `intervalMs`
 * - control edge cases like looping, waiting for recipients, and send-error behavior
 *
 * Typical usage:
 * 1. Construct `SimulationEngine` with a `TransportManager`, logger, and normalized options.
 * 2. Call `run()` to initialize, connect, and optionally start streaming.
 * 3. Subscribe to events such as `initialized`, `line-sent`, `completed`, and `failed`.
 * 4. Call `pause()` or `stop()` if an external orchestrator needs runtime control.
 */
const { EventEmitter } = require('events');
const { loadLinesFromFile } = require('./file-source.js');

/**
 * Backend replay engine used by headless runs.
 *
 * The engine owns file/range state and scheduling, while transport-specific delivery is
 * delegated to `TransportManager`. This separation keeps session behavior testable and
 * allows future reuse from UI or service-style entry points.
 */
class SimulationEngine extends EventEmitter {
  constructor({ transport, logger = null, options = {}, loadLines = loadLinesFromFile } = {}) {
	super();
	this.transport = transport;
	this.logger = logger;
	this.loadLines = loadLines;
	this.options = {
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
	  onError: 'exit',
	  ...options,
	};

	this.lines = [];
	this.startIndex = 0;
	this.endIndex = 0;
	this.currentLineIndex = 0;
	this.linesSentCount = 0;
	this.errorCount = 0;
	this.isInitialized = false;
	this.isSending = false;
	this.tickInFlight = false;
	this.intervalHandle = null;
	this.lastNoRecipientReason = null;
	this.runPromise = null;
	this.resolveRun = null;
	this.rejectRun = null;

	if (this.transport) {
	  this.transport.on('status', ({ status, message }) => {
		this.log(status === 'disconnected' ? 'warn' : 'info', message);
		this.emit('transport-status', { status, message });
	  });
	  this.transport.on('data-received', (payload) => this.emit('data-received', payload));
	  this.transport.on('client-connected', (payload) => this.emit('client-connected', payload));
	  this.transport.on('client-disconnected', (payload) => this.emit('client-disconnected', payload));
	}
  }

		  /**
		   * Emits a log event and forwards the message to the injected logger, if any.
		   */
  log(level, message) {
	if (this.logger && typeof this.logger[level] === 'function') {
	  this.logger[level](message);
	}
	this.emit('log', { level, message });
  }

		  /**
		   * Loads the source file and computes the effective replay window.
		   *
		   * Important behaviors:
		   * - blank lines are already filtered by the file loader
		   * - `startLine` is required to fall within the file
		   * - `endLine` is clamped to the last available line if it is too large
		   * - the engine maintains zero-based internal indexes but reports one-based line numbers
		   */
  async initialize() {
	if (this.isInitialized) {
	  return this.getSummary('initialized');
	}

	this.lines = await this.loadLines(this.options.filename);
	if (this.lines.length === 0) {
	  throw new Error(`Input file '${this.options.filename}' does not contain any non-empty lines.`);
	}

	this.startIndex = this.options.startLine - 1;
	if (this.startIndex >= this.lines.length) {
	  throw new Error(`startLine (${this.options.startLine}) exceeds file length (${this.lines.length}).`);
	}

	this.endIndex = this.options.endLine ? this.options.endLine - 1 : this.lines.length - 1;
	if (this.endIndex >= this.lines.length) {
	  this.log('warn', `endLine (${this.options.endLine}) exceeds file length (${this.lines.length}); clamping to the last line.`);
	  this.endIndex = this.lines.length - 1;
	}

	if (this.endIndex < this.startIndex) {
	  throw new Error('The effective end line cannot be before the start line.');
	}

	this.currentLineIndex = this.startIndex;
	this.isInitialized = true;

	this.log('info', `Loaded ${this.lines.length} lines from ${this.options.filename}. Active range: ${this.startIndex + 1}-${this.endIndex + 1}.`);
	this.emit('initialized', {
	  filePath: this.options.filename,
	  totalLines: this.lines.length,
	  startLine: this.startIndex + 1,
	  endLine: this.endIndex + 1,
	});

	return this.getSummary('initialized');
  }

		  /**
		   * Ensures the requested transport is connected before any sending begins.
		   */
  async connect() {
	if (this.transport.isConnected()) {
	  return;
	}

	await this.transport.connect({
	  protocol: this.options.protocol,
	  mode: this.options.mode,
	  ip: this.options.ip,
	  port: this.options.port,
	  grpcSerialization: this.options.grpcSerialization,
	  headerPathKey: this.options.grpcHeaderPathKey,
	  headerPath: this.options.grpcHeaderPath,
	  useTls: this.options.useTls,
	  tlsCaPath: this.options.tlsCaPath,
	  tlsCertPath: this.options.tlsCertPath,
	  tlsKeyPath: this.options.tlsKeyPath,
	  connectTimeoutMs: this.options.connectTimeoutMs,
	  connectWaitForServer: this.options.connectWaitForServer,
	  connectRetryIntervalMs: this.options.connectRetryIntervalMs,
	});
  }

		  /**
		   * Waits for at least one recipient when `waitForClient=true` in server mode.
		   *
		   * This prevents the replay cursor from advancing before delivery is possible.
		   */
  async waitForRecipientsIfNeeded() {
	if (!this.options.waitForClient || !this.transport.requiresRecipients()) {
	  return;
	}

	if (this.transport.hasRecipients()) {
	  return;
	}

	this.log('info', 'Waiting for at least one client before sending data...');
	await this.transport.waitForRecipients({ timeoutMs: this.options.connectTimeoutMs });
	this.log('info', 'Client detected. Starting transmission.');
  }

		  /**
		   * Main entry point for a session.
		   *
		   * Lifecycle:
		   * - initialize file/range state
		   * - connect transport when `autoConnect=true`
		   * - if `autoStart=false`, finish in a `ready` state instead of sending
		   * - otherwise wait for recipients if required and start the interval scheduler
		   *
		   * The returned promise resolves with a final session summary or rejects on fatal failure.
		   */
  async run() {
	if (!this.runPromise) {
	  this.runPromise = new Promise((resolve, reject) => {
		this.resolveRun = resolve;
		this.rejectRun = reject;
	  });
	}

	try {
	  await this.initialize();

	  if (this.options.autoConnect) {
		await this.connect();
	  }

	  if (!this.options.autoStart) {
		this.log('info', 'Headless session initialized and ready. autoStart=false, so no data will be sent.');
		this.finishRun('ready', 'Headless session initialized.');
		return this.runPromise;
	  }

	  if (!this.transport.isConnected()) {
		this.failRun(new Error('Cannot start sending because no active connection is available.'));
		return this.runPromise;
	  }

	  await this.waitForRecipientsIfNeeded();
	  this.startSchedule();
	} catch (error) {
	  this.failRun(error);
	}

	return this.runPromise;
  }

		  /**
		   * Starts the interval-based replay scheduler.
		   *
		   * A single in-flight tick is enforced to avoid overlapping send loops when a send takes
		   * longer than `intervalMs`.
		   */
  startSchedule() {
	if (this.isSending) {
	  return;
	}

	this.isSending = true;
	this.log('info', `Starting transmission (${this.options.linesPerInterval} line(s) every ${this.options.intervalMs}ms).`);

	this.intervalHandle = setInterval(() => {
	  if (this.tickInFlight) {
		return;
	  }
	  this.processTick().catch((error) => this.failRun(error));
	}, this.options.intervalMs);

	this.processTick().catch((error) => this.failRun(error));
  }

		  /**
		   * Pauses active scheduling without marking the run as failed.
		   * Used directly for `onError=pause` and can also support future external control.
		   */
  pause(reason = 'Transmission paused.') {
	if (this.intervalHandle) {
	  clearInterval(this.intervalHandle);
	  this.intervalHandle = null;
	}
	this.isSending = false;
	this.log('warn', reason);
	this.emit('paused', { reason });
  }

		  /**
		   * Stops the scheduler and finalizes the run with a `stopped` status.
		   */
  async stop(reason = 'Transmission stopped.') {
	if (this.intervalHandle) {
	  clearInterval(this.intervalHandle);
	  this.intervalHandle = null;
	}
	this.isSending = false;
	this.finishRun('stopped', reason);
  }

		  /**
		   * Processes one scheduler tick.
		   *
		   * Each tick may send multiple lines based on `linesPerInterval`. The engine re-checks
		   * completion and recipient availability before each line so it can react cleanly to
		   * late disconnects, exhausted ranges, or max-line boundaries.
		   */
  async processTick() {
	this.tickInFlight = true;

	try {
	  for (let sentThisTick = 0; sentThisTick < this.options.linesPerInterval; sentThisTick += 1) {
		if (this.shouldCompleteBeforeSend()) {
		  this.finishRun('completed', 'Configured data range has been fully transmitted.');
		  break;
		}

		if (this.options.waitForClient && this.transport.requiresRecipients() && !this.transport.hasRecipients()) {
		  if (this.lastNoRecipientReason !== 'waiting') {
			this.lastNoRecipientReason = 'waiting';
			this.log('info', 'No clients are currently connected. Waiting before advancing the stream.');
		  }
		  break;
		}

		const line = this.lines[this.currentLineIndex];
		let sendResult;

		// If the connection was lost between ticks (or before the very first send
		// after a restart) and connectWaitForServer is enabled, reconnect now before
		// attempting to send.  This is the primary path for server-restart recovery.
		if (!this.transport.isConnected() && this.options.connectWaitForServer && this.options.mode === 'client') {
		  this.log('warn', 'Connection to server lost. Attempting to reconnect...');
		  try {
			await this.connect();
			this.log('info', 'Reconnected to server. Resuming transmission.');
		  } catch (reconnectError) {
			this.log('error', `Reconnect attempt failed: ${reconnectError.message}`);
			const shouldContinue = await this.handleSendError(reconnectError);
			if (!shouldContinue) {
			  break;
			}
			continue;
		  }
		}

		try {
		  sendResult = await this.transport.send(line);
		} catch (error) {
		  // If the socket dropped during an in-flight write and connectWaitForServer is
		  // enabled, end this tick cleanly so the next tick triggers a reconnect
		  // rather than immediately failing the run.
		  if (this.options.connectWaitForServer && this.options.mode === 'client' && !this.transport.isConnected()) {
			this.log('warn', `Send failed because the connection was lost (${error.message}). Will reconnect on the next tick.`);
			break;
		  }
		  const shouldContinue = await this.handleSendError(error);
		  if (!shouldContinue) {
			break;
		  }
		  continue;
		}

		if (!sendResult.delivered && sendResult.reason === 'no-clients') {
		  if (this.options.waitForClient) {
			if (this.lastNoRecipientReason !== 'waiting') {
			  this.lastNoRecipientReason = 'waiting';
			  this.log('info', 'No clients are currently connected. Waiting before advancing the stream.');
			}
			break;
		  }

		  if (this.lastNoRecipientReason !== 'advance-without-recipient') {
			this.lastNoRecipientReason = 'advance-without-recipient';
			this.log('warn', 'No clients are connected. Advancing through the file because waitForClient=false.');
		  }
		} else {
		  this.lastNoRecipientReason = null;
		}

		this.advanceAfterSuccessfulSend(line, sendResult);
		if (!this.resolveRun) {
		  break;
		}
	  }
	} finally {
	  this.tickInFlight = false;
	}
  }

		  /**
		   * Determines whether the replay should stop before attempting another send.
		   */
  shouldCompleteBeforeSend() {
	if (this.options.maxLines !== null && this.linesSentCount >= this.options.maxLines) {
	  return true;
	}

	return !this.options.loop && this.currentLineIndex > this.endIndex;
  }

		  /**
		   * Records successful delivery state, emits progress events, and advances the replay cursor.
		   *
		   * If the active range is exhausted, the engine either loops back to `startLine` or
		   * completes the run depending on the `loop` option.
		   */
  advanceAfterSuccessfulSend(line, sendResult) {
	this.linesSentCount += 1;

	const lineNumber = this.currentLineIndex + 1;
	this.emit('line-sent', {
	  line,
	  lineNumber,
	  recipients: sendResult.recipients,
	  delivered: sendResult.delivered,
	  linesSentCount: this.linesSentCount,
	});

	this.log('debug', `Processed line ${lineNumber}. delivered=${sendResult.delivered} recipients=${sendResult.recipients}`);

	this.currentLineIndex += 1;

	if (this.options.maxLines !== null && this.linesSentCount >= this.options.maxLines) {
	  this.finishRun('completed', `Reached maxLines limit (${this.options.maxLines}).`);
	  return;
	}

	if (this.currentLineIndex > this.endIndex) {
	  if (this.options.loop) {
		this.log('info', 'End of configured range reached. Looping back to the starting line.');
		this.currentLineIndex = this.startIndex;
	  } else {
		this.finishRun('completed', 'Configured data range has been fully transmitted.');
	  }
	}
  }

		  /**
		   * Applies the configured fatal/non-fatal send error policy.
		   *
		   * - `continue`: skip the failed line and keep going
		   * - `pause`: stop scheduling but keep the process alive
		   * - `exit`: rethrow so the session fails immediately
		   */
  async handleSendError(error) {
	this.errorCount += 1;
	const message = `Error sending line ${this.currentLineIndex + 1}: ${error.message}`;

	if (this.options.onError === 'continue') {
	  this.log('error', `${message}. Continuing because onError=continue.`);
	  this.currentLineIndex += 1;
	  if (this.currentLineIndex > this.endIndex) {
		if (this.options.loop) {
		  this.currentLineIndex = this.startIndex;
		} else {
		  this.finishRun('completed', 'Configured data range ended after a skipped line.');
		}
	  }
	  return true;
	}

	if (this.options.onError === 'pause') {
	  this.pause(`${message}. Pausing because onError=pause.`);
	  return false;
	}

	throw error;
  }

		  /**
		   * Resolves the run promise with a final summary.
		   */
  finishRun(status, message) {
	if (!this.resolveRun) {
	  return;
	}

	if (this.intervalHandle) {
	  clearInterval(this.intervalHandle);
	  this.intervalHandle = null;
	}

	this.isSending = false;

	const summary = this.getSummary(status, message);
	this.resolveRun(summary);
	this.resolveRun = null;
	this.rejectRun = null;
	this.emit('completed', summary);
  }

		  /**
		   * Rejects the run promise and emits a failure event.
		   */
  failRun(error) {
	if (!this.rejectRun) {
	  return;
	}

	if (this.intervalHandle) {
	  clearInterval(this.intervalHandle);
	  this.intervalHandle = null;
	}

	this.isSending = false;
	this.rejectRun(error);
	this.resolveRun = null;
	this.rejectRun = null;
	this.emit('failed', { error });
  }

		  /**
		   * Builds a serializable summary object for logs, tests, and done-file output.
		   */
  getSummary(status, message = null) {
	const currentLine = this.currentLineIndex <= this.endIndex ? this.currentLineIndex + 1 : this.endIndex + 1;
	return {
	  status,
	  message,
	  filePath: this.options.filename,
	  protocol: this.options.protocol,
	  mode: this.options.mode,
	  ip: this.options.ip,
	  port: this.options.port,
	  startLine: this.startIndex + 1,
	  endLine: this.endIndex + 1,
	  currentLine,
	  linesSent: this.linesSentCount,
	  totalAvailableLines: this.lines.length,
	  maxLines: this.options.maxLines,
	  loop: this.options.loop,
	  waitForClient: this.options.waitForClient,
	  errorCount: this.errorCount,
	  completedAt: new Date().toISOString(),
	};
  }
}

module.exports = {
  SimulationEngine,
};

