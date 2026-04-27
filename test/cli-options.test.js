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
 * CLI Options Unit Tests
 * Run with: node test/cli-options.test.js
 */

const path = require('path');
const {
  formatCliStartupErrorOutput,
  formatExplainOutput,
  getCommandHelpText,
  getCommandLineReferenceData,
  parseCommandLineArgs,
  resolvePathValue,
} = require('../src/cli-options.js');

function createArgv(args) {
  return ['node', 'main.js', ...args];
}

async function runCliOptionsTests() {
  console.log('\n=== CLI Options Test Suite ===');
  let passed = 0;
  let failed = 0;

  const runTest = (testName, testFn) => {
    try {
      if (testFn()) {
        console.log(`✅ ${testName}`);
        passed += 1;
      } else {
        console.log(`❌ ${testName}`);
        failed += 1;
      }
    } catch (error) {
      console.log(`❌ ${testName} - Error: ${error.message}`);
      failed += 1;
    }
  };

  console.log('\n--- Test 1: Default UI mode ---');
  const defaultUiResult = parseCommandLineArgs(createArgv([]));
  const uiResult = parseCommandLineArgs(createArgv(['filename=./example.csv']));
  runTest('Defaults to UI mode when no parameters are provided', () => defaultUiResult.mode === 'ui');
  runTest('No-argument UI mode has no startup file', () => defaultUiResult.ui.startupFilePath === null);
  runTest('Resolves startup filename for UI mode', () => uiResult.ui.startupFilePath === path.resolve('./example.csv'));
  runTest('resolvePathValue expands relative paths', () => resolvePathValue('./example.csv') === path.resolve('./example.csv'));

  console.log('\n--- Test 2: Headless parsing ---');
  const headlessResult = parseCommandLineArgs(createArgv([
    'runMode=headless',
    'filename=./data.csv',
    'protocol=udp',
    'mode=client',
    'ip=10.0.0.8',
    'port=6000',
    'linesPerInterval=3',
    'intervalMs=250',
    'loop=true',
    'autoConnect=true',
    'autoStart=true',
    'exitOnComplete=false',
    'waitForClient=false',
    'connectWaitForServer=false',
    'startLine=2',
    'endLine=4',
    'maxLines=7',
    'connectTimeoutMs=5000',
    'logLevel=debug',
    'logFile=./runtime.log',
    'onError=continue',
    'doneFile=./run.done.json',
    'runId=test-run',
    'stdout=false',
  ]));

  runTest('Parses headless mode', () => headlessResult.mode === 'headless');
  runTest('Parses protocol', () => headlessResult.headless.protocol === 'udp');
  runTest('Parses port as integer', () => headlessResult.headless.port === 6000);
  runTest('Parses booleans correctly', () => headlessResult.headless.loop === true && headlessResult.headless.stdout === false);
  runTest('Parses limits correctly', () => headlessResult.headless.startLine === 2 && headlessResult.headless.endLine === 4 && headlessResult.headless.maxLines === 7);
  runTest('Resolves output paths', () => headlessResult.headless.logFile === path.resolve('./runtime.log') && headlessResult.headless.doneFile === path.resolve('./run.done.json'));

  const silentAliasResult = parseCommandLineArgs(createArgv(['runMode=silent', 'filename=./data.csv']));
  runTest('runMode=silent is treated as headless mode', () => silentAliasResult.mode === 'headless' && silentAliasResult.headless.runMode === 'headless');

  console.log('\n--- Test 3: Help output ---');
  const helpResult = parseCommandLineArgs(createArgv(['--help']));
  const helpShortAliasResult = parseCommandLineArgs(createArgv(['-h']));
  const helpParameterAliasResult = parseCommandLineArgs(createArgv(['h=true']));
  const helpWideResult = parseCommandLineArgs(createArgv(['help-wide=true']));
  const helpDetailedResult = parseCommandLineArgs(createArgv(['help-detailed=true']));
  const helpTableWideResult = parseCommandLineArgs(createArgv(['help-table-wide=true']));
  const helpNarrowResult = parseCommandLineArgs(createArgv(['help-table-narrow=true']));
  const helpMixedResult = parseCommandLineArgs(createArgv(['help=true', 'help-wide=true', 'help-detailed=true', 'help-table-wide=true', 'help-table-narrow=true']));
  const helpWithInvalidArgsResult = parseCommandLineArgs(createArgv(['help=true', 'runMode=headless', 'protocol=sctp']));
  runTest('Parses --help as help mode', () => helpResult.mode === 'help');
  runTest('Parses -h as help mode', () => helpShortAliasResult.mode === 'help');
  runTest('Parses h=true as help mode', () => helpParameterAliasResult.mode === 'help' && helpParameterAliasResult.errors.length === 0);
  runTest('Help text mentions headless mode', () => helpResult.helpText.includes('runMode=headless'));
  runTest('Help layout uses a full ASCII table without the example column', () => helpResult.helpText.includes('Layout: help (Name | Supported Values | Default | Purpose)') && helpResult.helpText.includes('+--------------------------+') && !helpResult.helpText.includes('| Kind'));
  runTest('Help-wide uses a full ASCII table with example column', () => helpWideResult.helpText.includes('Layout: help-wide') && helpWideResult.helpText.includes('Example') && helpWideResult.helpText.includes('+--------------------------+') && !helpWideResult.helpText.includes('| Kind'));
  runTest('Help layout wraps long purpose text onto continuation table rows', () => /\| autoConnect[\s\S]*Connect automatically before streaming\s+\|\n\|\s+\|\s+\|\s+\| begins\s+\|/.test(helpResult.helpText));
  runTest('Help-wide layout wraps long purpose text onto continuation table rows', () => /\| autoConnect[\s\S]*Connect automatically before streaming\s+\|\n\|\s+\|\s+\|\s+\|\s+\| begins\s+\|/.test(helpWideResult.helpText));
  runTest('Help layout adds bordered row separators between parameter blocks', () => /\|\s+begins\s+\|\n\+[-+]+\+\n\| autoStart/.test(helpResult.helpText));
  runTest('Help-wide layout adds bordered row separators between parameter blocks', () => /\|\s+begins\s+\|\n\+[-+]+\+\n\| autoStart/.test(helpWideResult.helpText));
  runTest('Help layout includes example usages after the table and before aliases', () => helpResult.helpText.includes('Example usages:') && helpResult.helpText.indexOf('Example usages:') > helpResult.helpText.lastIndexOf('+--------------------------+') && helpResult.helpText.indexOf('Example usages:') < helpResult.helpText.indexOf('Aliases:'));
  runTest('Help-wide includes example usages after the table and before aliases', () => helpWideResult.helpText.includes('Example usages:') && helpWideResult.helpText.indexOf('Example usages:') > helpWideResult.helpText.lastIndexOf('+--------------------------+') && helpWideResult.helpText.indexOf('Example usages:') < helpWideResult.helpText.indexOf('Aliases:'));
  runTest('Help examples include varied useful commands', () => helpResult.helpText.includes('UI default') && helpResult.helpText.includes('Headless server') && helpResult.helpText.includes('Config override') && helpResult.helpText.includes('help-table-narrow=true'));
  runTest('Help-detailed uses the full detailed layout', () => helpDetailedResult.helpText.includes('Layout: help-detailed (full parameter details)') && helpDetailedResult.helpText.includes('Parameters'));
  runTest('Detailed help documents the default UI behavior', () => helpDetailedResult.helpText.includes('normal UI mode') && helpDetailedResult.helpText.includes('compact/full view'));
  runTest('Wide table help uses a table-like layout', () => helpTableWideResult.helpText.includes('Layout: table-wide') && helpTableWideResult.helpText.includes('| Kind') && helpTableWideResult.helpText.includes('| parameter'));
  runTest('Narrow table help uses a table-like layout', () => helpNarrowResult.helpText.includes('Layout: table-narrow') && helpNarrowResult.helpText.includes('| Kind') && helpNarrowResult.helpText.includes('| parameter'));
  runTest('Help text shows default values', () => helpResult.helpText.includes('runMode') && helpResult.helpText.includes('ui') && helpResult.helpText.includes('port') && helpResult.helpText.includes('5565'));
  runTest('Detailed help explains 127.0.0.1 vs 0.0.0.0', () => helpDetailedResult.helpText.includes('127.0.0.1') && helpDetailedResult.helpText.includes('0.0.0.0') && helpDetailedResult.helpText.includes('loopback/local-only'));
  runTest('Direct help generator returns the command-line heading', () => getCommandHelpText().includes('ArcGIS Velocity Simulator command-line help'));
  runTest('Direct help generator can render help, help-wide, help-detailed, and table layouts', () => getCommandHelpText({ layout: 'standard' }).includes('Layout: help') && getCommandHelpText({ layout: 'wide' }).includes('Layout: help-wide') && getCommandHelpText({ layout: 'detailed' }).includes('Layout: help-detailed') && getCommandHelpText({ layout: 'table-wide' }).includes('Layout: table-wide') && getCommandHelpText({ layout: 'table-narrow' }).includes('Layout: table-narrow'));
  runTest('Command-line reference data exposes parameter rows for UI/help reuse', () => {
    const reference = getCommandLineReferenceData();
    return Array.isArray(reference.parameters)
      && reference.parameters.some((entry) => entry.name === 'runMode' && entry.defaultValue === 'ui')
      && reference.parameters.some((entry) => entry.name === 'help-wide')
      && Array.isArray(reference.notes)
      && reference.notes.length > 0;
  });
  runTest('Most specific help layout wins when help flags are mixed', () => helpMixedResult.mode === 'help' && helpMixedResult.helpText.includes('Layout: table-narrow'));
  runTest('help=true takes precedence over validation errors', () => helpWithInvalidArgsResult.mode === 'help' && helpWithInvalidArgsResult.errors.length === 0);

  console.log('\n--- Test 4: Validation ---');
  const invalidResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'protocol=sctp']));
  const unknownParameterResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'mysteryOption=true']));
  const unknownFlagResult = parseCommandLineArgs(createArgv(['--bogus']));
  const formattedUnknownParameterOutput = formatCliStartupErrorOutput(unknownParameterResult);
  runTest('Invalid protocol produces error mode', () => invalidResult.mode === 'error');
  runTest('Validation error is descriptive', () => invalidResult.errors.some((error) => error.includes('Invalid protocol')));
  runTest('Headless mode requires filename', () => parseCommandLineArgs(createArgv(['runMode=headless'])).errors.some((error) => error.includes('filename')));
  runTest('Unknown key=value CLI parameters produce error mode', () => unknownParameterResult.mode === 'error');
  runTest('Unknown CLI parameter errors include the help example', () => unknownParameterResult.errors.some((error) => error.includes('mysteryOption') && error.includes('electron . help=true')));
  runTest('Unknown CLI parameters do not also show UI ignore warnings', () => unknownParameterResult.warnings.length === 0);
  runTest('Unknown bare CLI flags produce error mode', () => unknownFlagResult.mode === 'error');
  runTest('Unknown bare CLI flags are reported verbatim', () => unknownFlagResult.errors.some((error) => error.includes('--bogus')));
  const unknownPositionalResult = parseCommandLineArgs(createArgv(['hhh']));
  runTest('Unknown positional argument produces error mode', () => unknownPositionalResult.mode === 'error');
  runTest('Unknown positional argument error mentions name=value syntax', () => unknownPositionalResult.errors.some((error) => error.includes('hhh') && error.includes('name=value')));
  const multiPositionalResult = parseCommandLineArgs(createArgv(['abc', 'def']));
  runTest('Multiple unknown positional arguments are all reported', () => multiPositionalResult.mode === 'error' && multiPositionalResult.errors.some((error) => error.includes('abc') && error.includes('def')));
  runTest('Formatted CLI startup errors include the startup banner, the unknown parameter details, and help text', () => formattedUnknownParameterOutput.includes('CLI startup aborted due to invalid command-line parameters. The application will exit without launching.') && formattedUnknownParameterOutput.includes('CLI error: Unknown CLI parameter: mysteryOption. These parameters are not supported. Review valid CLI parameters with: electron . help=true') && formattedUnknownParameterOutput.includes('\n\nArcGIS Velocity Simulator command-line help\n'));
  const formattedPositionalOutput = formatCliStartupErrorOutput(unknownPositionalResult);
  runTest('Formatted CLI startup errors for positional args include guidance and help', () => formattedPositionalOutput.includes('CLI error: Unknown CLI argument: hhh. Use name=value syntax') && formattedPositionalOutput.includes('ArcGIS Velocity Simulator command-line help'));

  console.log('\n--- Test 5: Ignored-parameter warnings ---');
  // logLevel, maxLines, and startLine are simulator headless-only params and should be warned in UI mode.
  // Note: port and protocol are recognized as UI preset keys (they pre-populate the UI form)
  // so they do not produce "ignored" warnings.
  const uiIgnoredResult = parseCommandLineArgs(createArgv(['logLevel=debug', 'maxLines=100', 'startLine=5']));
  runTest('UI mode produces per-parameter warnings for headless-only params', () => uiIgnoredResult.mode === 'ui' && uiIgnoredResult.warnings.length === 3);
  runTest('UI mode warning for maxLines explains it is not used', () => uiIgnoredResult.warnings.some((w) => w.includes("'maxLines'") && w.includes('UI mode') && w.includes('ignored')));
  runTest('UI mode warning for startLine explains it is not used', () => uiIgnoredResult.warnings.some((w) => w.includes("'startLine'") && w.includes('UI mode') && w.includes('ignored')));
  runTest('UI mode warning for logLevel explains it is not used', () => uiIgnoredResult.warnings.some((w) => w.includes("'logLevel'") && w.includes('UI mode') && w.includes('ignored')));
  runTest('UI mode ignored-param warnings do not produce an error', () => uiIgnoredResult.errors.length === 0);

  const headlessRetryWarningResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'connectRetryIntervalMs=3000']));
  runTest('Headless mode warns that connectRetryIntervalMs has no effect when connectWaitForServer=false', () => headlessRetryWarningResult.mode === 'headless' && headlessRetryWarningResult.warnings.some((w) => w.includes("'connectRetryIntervalMs'") && w.includes("'connectWaitForServer=false'")));

  const headlessWaitForClientIgnoredResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'mode=client', 'ip=127.0.0.1', 'waitForClient=true']));
  runTest('Headless mode warns that waitForClient is ignored in client mode', () => headlessWaitForClientIgnoredResult.warnings.some((w) => w.includes("'waitForClient'") && w.includes('client mode')));

  const headlessConnectWaitIgnoredResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'mode=server', 'connectWaitForServer=true']));
  runTest('Headless mode warns that connectWaitForServer is ignored in server mode', () => headlessConnectWaitIgnoredResult.warnings.some((w) => w.includes("'connectWaitForServer'") && w.includes('server mode')));

  console.log('\n--- Test 6: Explain parameter ---');
  const defaultExplainResult = parseCommandLineArgs(createArgv([]));
  runTest('explain defaults to true when not provided', () => defaultExplainResult.explain === true);
  const explainFalseResult = parseCommandLineArgs(createArgv(['explain=false']));
  runTest('explain=false sets explain to false', () => explainFalseResult.explain === false);
  const explainTrueResult = parseCommandLineArgs(createArgv(['explain=true']));
  runTest('explain=true sets explain to true', () => explainTrueResult.explain === true);
  const explainNotWarnedResult = parseCommandLineArgs(createArgv(['explain=true', 'port=6000']));
  runTest('explain is not treated as a UI-ignored parameter', () => !explainNotWarnedResult.warnings.some((w) => w.includes("'explain'")));

  const uiExplainOutput = formatExplainOutput(defaultExplainResult);
  runTest('UI explain output includes mode and run mode label', () => uiExplainOutput.includes('Run mode') && uiExplainOutput.includes('UI (interactive)'));
  runTest('UI explain output includes startup explanation heading', () => uiExplainOutput.includes('Startup Explanation'));

  const uiPresetsResult = parseCommandLineArgs(createArgv(['protocol=grpc', 'ip=192.168.1.10', 'port=6000']));
  const uiPresetsExplainOutput = formatExplainOutput(uiPresetsResult);
  runTest('UI explain output shows UI Configuration section when CLI presets are provided', () => uiPresetsExplainOutput.includes('UI Configuration'));
  runTest('UI explain output shows preset key-value pairs', () => uiPresetsExplainOutput.includes('protocol') && uiPresetsExplainOutput.includes('grpc'));
  runTest('UI explain output shows preset ip value', () => uiPresetsExplainOutput.includes('192.168.1.10'));
  runTest('UI explain output shows Behavior Summary section when CLI presets are provided', () => uiPresetsExplainOutput.includes('Behavior Summary'));
  runTest('UI explain output shows UI Configuration section even without presets', () => uiExplainOutput.includes('UI Configuration'));

  const headlessExplainResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'protocol=tcp', 'mode=server', 'ip=0.0.0.0', 'port=5565']));
  const headlessExplainOutput = formatExplainOutput(headlessExplainResult);
  runTest('Headless explain output shows Headless mode', () => headlessExplainOutput.includes('Headless (no UI)'));
  runTest('Headless explain output shows transport summary', () => headlessExplainOutput.includes('TCP server listening on 0.0.0.0:5565'));
  runTest('Headless explain output shows streaming rate', () => headlessExplainOutput.includes('1 line(s) every 1000ms'));
  runTest('Headless explain output shows parameter values', () => headlessExplainOutput.includes('protocol') && headlessExplainOutput.includes('tcp'));

  const warnExplainResult = parseCommandLineArgs(createArgv(['logLevel=debug', 'maxLines=100']));
  const warnExplainOutput = formatExplainOutput(warnExplainResult);
  runTest('Explain output includes warnings section when there are warnings', () => warnExplainOutput.includes('Warnings') && warnExplainOutput.includes("'logLevel'") && warnExplainOutput.includes("'maxLines'"));

  console.log('\n--- Test 7: gRPC header path CLI options ---');
  const grpcHeaderResult = parseCommandLineArgs(createArgv([
    'runMode=headless',
    'filename=./data.csv',
    'protocol=grpc',
    'mode=client',
    'ip=127.0.0.1',
    'grpcHeaderPathKey=my-header',
    'grpcHeaderPath=my.feed.uid',
  ]));
  runTest('grpcHeaderPathKey is parsed in headless mode', () => grpcHeaderResult.headless.grpcHeaderPathKey === 'my-header');
  runTest('grpcHeaderPath is parsed in headless mode', () => grpcHeaderResult.headless.grpcHeaderPath === 'my.feed.uid');

  const grpcDefaultsResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'protocol=grpc', 'mode=client', 'ip=127.0.0.1']));
  runTest('grpcHeaderPathKey defaults to grpc-path', () => grpcDefaultsResult.headless.grpcHeaderPathKey === 'grpc-path');
  runTest('grpcHeaderPath defaults to replace.with.dedicated.uid', () => grpcDefaultsResult.headless.grpcHeaderPath === 'replace.with.dedicated.uid');

  runTest('grpcHeaderPathKey and grpcHeaderPath appear in CLI parameter definitions', () => {
    const reference = getCommandLineReferenceData();
    return reference.parameters.some((p) => p.name === 'grpcHeaderPathKey') &&
           reference.parameters.some((p) => p.name === 'grpcHeaderPath');
  });

  const uiGrpcHeaderResult = parseCommandLineArgs(createArgv(['grpcHeaderPathKey=custom']));
  runTest('grpcHeaderPathKey in UI mode is recognized as a UI preset, not an ignored param', () => uiGrpcHeaderResult.mode === 'ui' && !uiGrpcHeaderResult.warnings.some((w) => w.includes('grpcHeaderPathKey')));

  const headlessExplainGrpcResult = parseCommandLineArgs(createArgv(['runMode=headless', 'filename=./data.csv', 'protocol=grpc', 'mode=client', 'ip=127.0.0.1']));
  const headlessGrpcExplainOutput = formatExplainOutput(headlessExplainGrpcResult);
  runTest('Headless gRPC explain output shows grpcHeaderPath and grpcHeaderPathKey', () => headlessGrpcExplainOutput.includes('grpcHeaderPath') && headlessGrpcExplainOutput.includes('grpcHeaderPathKey'));

  // --- grpcSendMethod tests ---
  const grpcSendMethodResult = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=grpc', 'mode=client', 'ip=127.0.0.1',
    'grpcSendMethod=unary',
  ]));
  runTest('grpcSendMethod=unary is parsed in headless mode', () => grpcSendMethodResult.headless.grpcSendMethod === 'unary');

  runTest('grpcSendMethod defaults to stream', () => grpcDefaultsResult.headless.grpcSendMethod === 'stream');

  const invalidSendMethodResult = parseCommandLineArgs(createArgv([
    'runMode=headless', 'filename=./data.csv', 'protocol=grpc', 'mode=client', 'ip=127.0.0.1',
    'grpcSendMethod=invalid',
  ]));
  runTest('Invalid grpcSendMethod produces an error', () => invalidSendMethodResult.errors.some((e) => e.includes('grpcSendMethod')));

  runTest('grpcSendMethod appears in CLI parameter definitions', () => {
    const reference = getCommandLineReferenceData();
    return reference.parameters.some((p) => p.name === 'grpcSendMethod');
  });

  const uiSendMethodResult = parseCommandLineArgs(createArgv(['grpcSendMethod=unary']));
  runTest('grpcSendMethod in UI mode is recognized as a UI preset', () => uiSendMethodResult.mode === 'ui' && !uiSendMethodResult.warnings.some((w) => w.includes('grpcSendMethod')));

  runTest('Headless gRPC explain output shows grpcSendMethod', () => headlessGrpcExplainOutput.includes('grpcSendMethod'));

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runCliOptionsTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}


