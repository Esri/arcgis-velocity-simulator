/**
 * Help and Command Line Interface Dialog Unit Tests
 * Run with: node test/help.test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const helpHtmlPath = path.resolve(__dirname, '../src/help.html');
const cliHtmlPath = path.resolve(__dirname, '../src/cli.html');
const helpCssPath = path.resolve(__dirname, '../src/help.css');
const cliCssPath = path.resolve(__dirname, '../src/cli.css');
const helpHtml = fs.readFileSync(helpHtmlPath, 'utf-8');
const cliHtml = fs.readFileSync(cliHtmlPath, 'utf-8');
const helpCss = fs.readFileSync(helpCssPath, 'utf-8');
const cliCss = fs.readFileSync(cliCssPath, 'utf-8');

const mockCliReference = {
  overview: [
    'No parameters start the app in normal UI mode.',
    'Headless mode requires filename once headless mode is selected.',
  ],
  helpLayouts: [
    'help=true prints the compact ASCII-table help without the example column.',
    'help-table-wide=true prints the wide table help output.',
  ],
  parameters: [
    {
      name: 'help',
      supportedValues: 'true, false',
      required: 'No',
      defaultValue: 'false',
      example: 'help=true',
      purpose: 'Print a compact ASCII-table parameter summary without the example column and exit. Also available as --help and -h.',
      usageCategory: 'help',
    },
    {
      name: 'runMode',
      supportedValues: 'ui, headless, silent',
      required: 'Only when using the normal app entry point',
      defaultValue: 'ui',
      example: 'runMode=headless',
      purpose: 'Select startup mode. Use it when switching from the normal launcher into headless mode.',
      usageCategory: 'launcher',
    },
    {
      name: 'filename',
      supportedValues: 'absolute-or-relative-path',
      required: 'Yes',
      defaultValue: '(none)',
      example: 'filename=./data.csv',
      purpose: 'Input CSV/TXT file to replay. Also accepted as a startup file path in UI mode.',
      usageCategory: 'shared',
    },
    {
      name: 'protocol',
      supportedValues: 'tcp, udp',
      required: 'No',
      defaultValue: 'tcp',
      example: 'protocol=tcp',
      purpose: 'Choose the network transport for headless replay. Headless-only transport selection.',
      usageCategory: 'headless-only',
    },
  ],
  notes: [
    'runMode=silent is treated the same as runMode=headless.',
    '127.0.0.1 is local-only; 0.0.0.0 is commonly used for server mode.',
  ],
  examples: [
    'electron .',
    'electron . help-table-wide=true',
  ],
};

function createDialogDom(html, { includeCliApi = false } = {}) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'file://' + path.resolve(__dirname, '../src/'),
    beforeParse(window) {
      window.URL.createObjectURL = () => {
        window._exportObjectUrlCreated = true;
        return 'blob:test-visible-rows';
      };
      window.URL.revokeObjectURL = (url) => {
        window._revokedObjectUrl = url;
      };
      window.navigator.clipboard = {
        writeText: async (text) => {
          window._copiedText = text;
        },
      };
      window.api = {
        ...(includeCliApi
          ? {
              getCliHelpReference: () => {
                window.api._getCliHelpReferenceCalled = true;
                return Promise.resolve(mockCliReference);
              },
            }
          : {}),
        onSetTheme: (callback) => {
          window.api._themeCallback = callback;
        },
        themeApplied: () => {
          window.api._themeAppliedCalled = true;
        },
      };
      window.close = () => {
        window._closeCalled = true;
      };
    },
  });
}

async function runHelpTests() {
  console.log('\n=== Help + Command Line Interface Dialog Test Suite ===');
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

  const runAsyncTest = async (testName, testFn) => {
    try {
      const result = await testFn();
      if (result) {
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

  const helpDom = createDialogDom(helpHtml);
  global.window = helpDom.window;
  global.document = helpDom.window.document;

  console.log('\nWaiting for Help dialog setup...');
  await new Promise((resolve) => setTimeout(resolve, 50));

  console.log('\n--- Test 1: Help dialog content and shortcuts ---');
  runTest('Help dialog title is rendered', () => document.querySelector('.help-title')?.textContent.includes('ArcGIS Velocity Simulator Help'));
  runTest('Help dialog keeps general product help sections', () => document.body.textContent.includes('Quick Start') && document.body.textContent.includes('Voice Controls'));
  runTest('Help dialog points users to the dedicated Command Line Interface dialog', () => document.body.textContent.includes('Command Line Interface dialog') && document.body.textContent.includes('F3'));
  runTest('Help dialog no longer renders the embedded CLI filter', () => document.getElementById('cli-filter-input') === null);
  runTest('Keyboard shortcuts table lists F3 for the Command Line Interface dialog', () => document.querySelector('.shortcuts-table')?.textContent.includes('Command Line Interface') && document.querySelector('.shortcuts-table')?.textContent.includes('F3'));
  runTest('Keyboard shortcuts table no longer lists the CLI filter shortcut inside Help', () => !document.querySelector('.shortcuts-table')?.textContent.includes('Focus CLI Filter'));
  runTest('Close button exists in Help dialog', () => document.getElementById('close-button') !== null);
  runTest('Help theme callback is registered', () => typeof global.window.api._themeCallback === 'function');
  runTest('Help theme application works and acknowledges the main process', () => {
    global.window.api._themeAppliedCalled = false;
    global.window.api._themeCallback(null, 'dark');
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled === true;
  });
  runTest('Help close button closes the dialog', () => {
    global.window._closeCalled = false;
    document.getElementById('close-button').click();
    return global.window._closeCalled === true;
  });
  await runAsyncTest('Escape key closes the Help dialog', async () => {
    global.window._closeCalled = false;
    document.dispatchEvent(new helpDom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return global.window._closeCalled === true;
  });

  const cliDom = createDialogDom(cliHtml, { includeCliApi: true });
  const originalClick = cliDom.window.HTMLAnchorElement.prototype.click;
  cliDom.window.HTMLAnchorElement.prototype.click = function() {
    global.window._lastDownload = {
      href: this.href,
      download: this.download,
    };
  };

  global.window = cliDom.window;
  global.document = cliDom.window.document;

  console.log('\nWaiting for Command Line Interface dialog setup...');
  await new Promise((resolve) => setTimeout(resolve, 50));

  console.log('\n--- Test 2: Command-line reference rendering ---');
  runTest('CLI reference loader is called', () => global.window.api._getCliHelpReferenceCalled === true);
  runTest('CLI dialog title is rendered', () => document.querySelector('.help-title')?.textContent.includes('Command Line Interface'));
  runTest('CLI reference table body exists', () => document.getElementById('cli-reference-body') !== null);
  runTest('CLI reference rows are rendered', () => document.querySelectorAll('#cli-reference-body tr').length === mockCliReference.parameters.length);
  runTest('CLI reference includes parameter names and defaults', () => {
    const bodyText = document.getElementById('cli-reference-body').textContent;
    return bodyText.includes('runMode') && bodyText.includes('ui') && bodyText.includes('filename') && bodyText.includes('protocol');
  });
  runTest('CLI reference is sorted by parameter name ascending by default', () => {
    const firstRowText = document.querySelector('#cli-reference-body tr')?.textContent || '';
    return firstRowText.includes('filename');
  });
  runTest('Sticky table header styling is present', () => helpCss.includes('.cli-reference-table thead th') && helpCss.includes('position: sticky'));
  runTest('Active filter pill styling is present', () => helpCss.includes('.cli-active-filter-pill') && helpCss.includes('.cli-filter-chip-count'));
  runTest('Wrap-safe CLI table and code styling is present', () => helpCss.includes('overflow-wrap: anywhere') && helpCss.includes('.cli-reference-table td:nth-child(5) code'));
  runTest('Resizable CLI table wrapper styling is present', () => cliCss.includes('.cli-reference-table-wrapper') && cliCss.includes('resize: vertical'));

  console.log('\n--- Test 3: Notes, examples, and interactions ---');
  runTest('Overview and help layout bullets are rendered', () => document.getElementById('cli-overview-list').textContent.includes('without the example column'));
  runTest('CLI notes are rendered', () => document.getElementById('cli-notes-list').textContent.includes('runMode=silent'));
  runTest('CLI examples are rendered as code entries', () => document.getElementById('cli-examples-list').textContent.includes('help-table-wide=true'));runTest('Notes details section starts collapsed', () => {
    const notesDetails = Array.from(document.querySelectorAll('.cli-reference-details')).find((details) =>
      details.querySelector('summary')?.textContent.includes('Notes')
    );
    return notesDetails && !notesDetails.open;
  });
  runTest('Example Commands details section starts expanded', () => {
    const examplesDetails = Array.from(document.querySelectorAll('.cli-reference-details')).find((details) =>
      details.querySelector('summary')?.textContent.includes('Example Commands')
    );
    return Boolean(examplesDetails?.open);
  });
  runTest('Filter input exists', () => document.getElementById('cli-filter-input') !== null);
  runTest('Clear filters button exists and is disabled initially', () => {
    const clearButton = document.getElementById('cli-clear-filters');
    return clearButton !== null && clearButton.disabled === true;
  });
  runTest('Quick filter chips exist', () => document.querySelectorAll('.cli-filter-chip').length === 5);
  runTest('Quick filter chips show result counts', () => {
    const allCount = document.querySelector('.cli-filter-chip-count[data-chip-count-for="all"]')?.textContent;
    const helpCount = document.querySelector('.cli-filter-chip-count[data-chip-count-for="help"]')?.textContent;
    return allCount === '4' && helpCount === '1';
  });
  runTest('Active filter row shows the default sort pill', () => document.getElementById('cli-active-filters').textContent.includes('Sort: Name ↑'));
  runTest('Bulk action buttons exist', () => document.getElementById('cli-copy-visible-rows') !== null && document.getElementById('cli-export-visible-rows') !== null);
  runTest('Visible-row format selector exists and defaults to TSV', () => {
    const formatSelect = document.getElementById('cli-visible-rows-format');
    return formatSelect !== null && formatSelect.value === 'tsv';
  });
  runTest('CLI table resize hint is rendered and wired to the wrapper for accessibility', () => {
    const wrapper = document.getElementById('cli-reference-table-wrapper');
    const hint = document.getElementById('cli-reference-table-resize-hint');
    return hint !== null
      && hint.textContent.includes('Drag the table’s bottom edge')
      && wrapper?.getAttribute('aria-describedby') === 'cli-reference-table-resize-hint';
  });
  runTest('CLI table wrapper auto-sizes to fit visible rows before user resizing', () => {
    const wrapper = document.getElementById('cli-reference-table-wrapper');
    const table = document.querySelector('.cli-reference-table');
    const filterInput = document.getElementById('cli-filter-input');
    Object.defineProperty(table, 'offsetHeight', {
      configurable: true,
      get: () => 428,
    });
    filterInput.value = 'protocol';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    return wrapper.style.height === '430px';
  });
  runTest('CLI details sections are collapsible', () => document.querySelectorAll('.cli-reference-details').length >= 3);
  runTest('Sortable column buttons exist', () => document.querySelectorAll('.sortable-column').length === 6);

  runTest('Ctrl/Cmd+F focuses the CLI filter', () => {
    const filterInput = document.getElementById('cli-filter-input');
    document.body.focus();
    document.dispatchEvent(new cliDom.window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    return document.activeElement === filterInput;
  });

  runTest('Slash shortcut focuses the CLI filter when not typing elsewhere', () => {
    const filterInput = document.getElementById('cli-filter-input');
    document.body.focus();
    document.dispatchEvent(new cliDom.window.KeyboardEvent('keydown', { key: '/', bubbles: true }));
    return document.activeElement === filterInput;
  });

  runTest('Filtering reduces visible parameter rows', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'startup file';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    const rows = document.querySelectorAll('#cli-reference-body tr');
    return rows.length === 1
      && rows[0].textContent.includes('filename')
      && document.getElementById('cli-clear-filters').disabled === false
      && document.getElementById('cli-active-filters').textContent.includes('Search: startup file');
  });

  runTest('Filtering with no matches shows the empty state', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'does-not-exist';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    return document.getElementById('cli-reference-body').textContent.includes('No command-line parameters match the current filter.');
  });

  runTest('Clearing the filter restores all parameter rows', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = '';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    return document.querySelectorAll('#cli-reference-body tr').length === mockCliReference.parameters.length;
  });

  runTest('Required chip filters to required-only parameters', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="required"]').click();
    const rows = document.querySelectorAll('#cli-reference-body tr');
    return rows.length === 1
      && rows[0].textContent.includes('filename')
      && document.getElementById('cli-active-filters').textContent.includes('Category: Required');
  });

  runTest('Optional chip filters to optional parameters', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="optional"]').click();
    const rows = document.querySelectorAll('#cli-reference-body tr');
    return rows.length === 2 && document.getElementById('cli-reference-body').textContent.includes('help') && document.getElementById('cli-reference-body').textContent.includes('protocol');
  });

  runTest('Headless-only chip filters to headless-only parameters', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="headless-only"]').click();
    const rows = document.querySelectorAll('#cli-reference-body tr');
    return rows.length === 1 && rows[0].textContent.includes('protocol');
  });

  runTest('Help-related chip filters to help parameters', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="help"]').click();
    const rows = document.querySelectorAll('#cli-reference-body tr');
    return rows.length === 1 && rows[0].textContent.includes('help=true');
  });

  runTest('Clear filters button resets search text and chip filters', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'tcp';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    document.querySelector('.cli-filter-chip[data-chip-filter="headless-only"]').click();
    document.getElementById('cli-clear-filters').click();
    const allChip = document.querySelector('.cli-filter-chip[data-chip-filter="all"]');
    return filterInput.value === ''
      && allChip.classList.contains('is-active')
      && document.querySelectorAll('#cli-reference-body tr').length === mockCliReference.parameters.length
      && document.getElementById('cli-clear-filters').disabled === true
      && !document.getElementById('cli-active-filters').textContent.includes('Category:');
  });

  runTest('Removing the search pill clears only the search filter', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'tcp';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    const searchPill = Array.from(document.querySelectorAll('.cli-active-filter-pill.is-removable')).find((pill) => pill.textContent.includes('Search: tcp'));
    searchPill.click();
    return filterInput.value === '' && !document.getElementById('cli-active-filters').textContent.includes('Search: tcp');
  });

  runTest('Removing the category pill resets only the chip filter', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="help"]').click();
    const categoryPill = Array.from(document.querySelectorAll('.cli-active-filter-pill.is-removable')).find((pill) => pill.textContent.includes('Category: Help-related'));
    categoryPill.click();
    return document.querySelector('.cli-filter-chip[data-chip-filter="all"]').classList.contains('is-active')
      && !document.getElementById('cli-active-filters').textContent.includes('Category: Help-related');
  });

  runTest('Clicking a sortable header toggles sort direction', () => {
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    const parameterSortButton = document.querySelector('.sortable-column[data-sort-key="name"]');
    parameterSortButton.click();
    const firstRowText = document.querySelector('#cli-reference-body tr')?.textContent || '';
    return parameterSortButton.classList.contains('is-desc')
      && firstRowText.includes('runMode')
      && document.getElementById('cli-active-filters').textContent.includes('Sort: Name ↓');
  });

  runTest('Current search and sort state persist across rerenders while the dialog stays open', () => {
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'help';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    document.querySelector('.sortable-column[data-sort-key="required"]').click();
    document.querySelector('.sortable-column[data-sort-key="required"]').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="help"]').click();
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    return filterInput.value === 'help'
      && document.querySelector('.sortable-column[data-sort-key="required"]').classList.contains('is-desc')
      && document.querySelector('.cli-filter-chip[data-chip-filter="help"]').classList.contains('is-active')
      && document.getElementById('cli-active-filters').textContent.includes('Sort: Required in Headless Mode ↓');
  });

  runTest('Manual CLI table resize is preserved across rerenders', () => {
    const wrapper = document.getElementById('cli-reference-table-wrapper');
    const table = document.querySelector('.cli-reference-table');
    const filterInput = document.getElementById('cli-filter-input');

    Object.defineProperty(table, 'offsetHeight', {
      configurable: true,
      get: () => 180,
    });

    wrapper.getBoundingClientRect = () => ({ bottom: 300, height: 240 });
    wrapper.dispatchEvent(new cliDom.window.MouseEvent('mousedown', { bubbles: true, clientY: 295 }));
    wrapper.style.height = '320px';
    wrapper.getBoundingClientRect = () => ({ bottom: 320, height: 320 });
    cliDom.window.dispatchEvent(new cliDom.window.MouseEvent('mouseup', { bubbles: true, clientY: 320 }));

    filterInput.value = 'help';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));

    return wrapper.style.height === '320px';
  });

  await runAsyncTest('Copy button copies an example command', async () => {
    global.window._copiedText = null;
    document.querySelector('.cli-copy-button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return global.window._copiedText === 'electron .' && document.getElementById('cli-copy-status').textContent.includes('Copied example command');
  });

  await runAsyncTest('Copy visible rows copies the filtered table as TSV', async () => {
    document.getElementById('cli-clear-filters').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    document.getElementById('cli-visible-rows-format').value = 'tsv';
    document.getElementById('cli-visible-rows-format').dispatchEvent(new cliDom.window.Event('change', { bubbles: true }));
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'protocol';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    global.window._copiedText = null;
    document.getElementById('cli-copy-visible-rows').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return global.window._copiedText.includes('Name\tSupported Values\tDefault')
      && global.window._copiedText.includes('protocol')
      && document.getElementById('cli-copy-status').textContent.includes('as TSV');
  });

  await runAsyncTest('Copy visible rows can use Markdown output', async () => {
    document.getElementById('cli-clear-filters').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    const formatSelect = document.getElementById('cli-visible-rows-format');
    formatSelect.value = 'markdown';
    formatSelect.dispatchEvent(new cliDom.window.Event('change', { bubbles: true }));
    global.window._copiedText = null;
    document.getElementById('cli-copy-visible-rows').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return global.window._copiedText.startsWith('| Name | Supported Values | Default |')
      && document.getElementById('cli-copy-status').textContent.includes('as MARKDOWN');
  });

  await runAsyncTest('Copy visible rows can use JSON output', async () => {
    document.getElementById('cli-clear-filters').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    const formatSelect = document.getElementById('cli-visible-rows-format');
    formatSelect.value = 'json';
    formatSelect.dispatchEvent(new cliDom.window.Event('change', { bubbles: true }));
    global.window._copiedText = null;
    document.getElementById('cli-copy-visible-rows').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const parsed = JSON.parse(global.window._copiedText);
    return Array.isArray(parsed)
      && parsed.some((entry) => entry.name === 'help')
      && document.getElementById('cli-copy-status').textContent.includes('as JSON');
  });

  runTest('Export visible rows creates a CSV download for the filtered rows', () => {
    document.getElementById('cli-clear-filters').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    const formatSelect = document.getElementById('cli-visible-rows-format');
    formatSelect.value = 'csv';
    formatSelect.dispatchEvent(new cliDom.window.Event('change', { bubbles: true }));
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'help';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    global.window._lastDownload = null;
    global.window._exportObjectUrlCreated = false;
    global.window._revokedObjectUrl = null;
    document.getElementById('cli-export-visible-rows').click();
    return global.window._exportObjectUrlCreated === true
      && global.window._lastDownload
      && global.window._lastDownload.download === 'arcgis-velocity-simulator-visible-cli-rows.csv'
      && global.window._revokedObjectUrl === 'blob:test-visible-rows'
      && document.getElementById('cli-copy-status').textContent.includes('as CSV');
  });

  runTest('Export visible rows can create a JSON download for the current visible rows', () => {
    document.getElementById('cli-clear-filters').click();
    document.querySelector('.cli-filter-chip[data-chip-filter="all"]').click();
    const formatSelect = document.getElementById('cli-visible-rows-format');
    formatSelect.value = 'json';
    formatSelect.dispatchEvent(new cliDom.window.Event('change', { bubbles: true }));
    const filterInput = document.getElementById('cli-filter-input');
    filterInput.value = 'help';
    filterInput.dispatchEvent(new cliDom.window.Event('input', { bubbles: true }));
    global.window._lastDownload = null;
    global.window._exportObjectUrlCreated = false;
    global.window._revokedObjectUrl = null;
    document.getElementById('cli-export-visible-rows').click();
    return global.window._exportObjectUrlCreated === true
      && global.window._lastDownload
      && global.window._lastDownload.download === 'arcgis-velocity-simulator-visible-cli-rows.json'
      && global.window._revokedObjectUrl === 'blob:test-visible-rows'
      && document.getElementById('cli-copy-status').textContent.includes('as JSON');
  });

  console.log('\n--- Test 4: Command Line Interface dialog close and theme handling ---');
  runTest('CLI close button exists', () => document.getElementById('close-button') !== null);
  runTest('CLI close button closes the dialog', () => {
    global.window._closeCalled = false;
    document.getElementById('close-button').click();
    return global.window._closeCalled === true;
  });
  runTest('CLI theme callback is registered', () => typeof global.window.api._themeCallback === 'function');
  runTest('CLI theme application works and acknowledges the main process', () => {
    global.window.api._themeAppliedCalled = false;
    global.window.api._themeCallback(null, 'dark');
    return document.body.className === 'dark' && global.window.api._themeAppliedCalled === true;
  });

  console.log('\n--- Test 5: Escape key closes the Command Line Interface dialog ---');
  await runAsyncTest('Escape key closes the CLI dialog', async () => {
    global.window._closeCalled = false;
    document.dispatchEvent(new cliDom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    return global.window._closeCalled === true;
  });

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  cliDom.window.HTMLAnchorElement.prototype.click = originalClick;
  helpDom.window.close();
  cliDom.window.close();

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runHelpTests().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = { runHelpTests };

