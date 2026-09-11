/**
 * Secondary window theme propagation tests.
 * Run with: node test/secondary-window-theme.test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const helperSource = fs.readFileSync(path.resolve(__dirname, '../src/secondary-window-theme.js'), 'utf-8');
const helpHtml = fs.readFileSync(path.resolve(__dirname, '../src/help.html'), 'utf-8');
const cliHtml = fs.readFileSync(path.resolve(__dirname, '../src/cli.html'), 'utf-8');
const configHtml = fs.readFileSync(path.resolve(__dirname, '../src/config.html'), 'utf-8');
const errorHtml = fs.readFileSync(path.resolve(__dirname, '../src/error.html'), 'utf-8');
const launchConfigHtml = fs.readFileSync(path.resolve(__dirname, '../src/launch-config.html'), 'utf-8');
const velocityLoginHtml = fs.readFileSync(path.resolve(__dirname, '../src/velocity-login.html'), 'utf-8');
const velocityLoginScript = fs.readFileSync(path.resolve(__dirname, '../src/velocity-login-renderer.js'), 'utf-8');
const velocityEndpointScript = fs.readFileSync(path.resolve(__dirname, '../src/velocity-endpoint-ui.js'), 'utf-8');

function createDom(html, url, setup) {
  return new JSDOM(html, {
    runScripts: 'dangerously',
    url,
    beforeParse(window) {
      window.eval(helperSource);
      window.close = () => {};
      if (setup) setup(window);
    },
  });
}

function createLoginDom() {
  const dom = new JSDOM(velocityLoginHtml, {
    runScripts: 'dangerously',
    url: 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/velocity-login.html?theme=theme-light-gray',
    beforeParse(window) {
      window.eval(helperSource);
      window.velocityApi = {
        getStoredCredentials: () => Promise.resolve(null),
        getSessionState: () => Promise.resolve({ authenticated: false }),
        login: () => Promise.resolve({ success: true }),
        loginOAuth: () => Promise.resolve({ success: true }),
        listItems: () => Promise.resolve([]),
        getItemDetails: () => Promise.resolve(null),
        applyItem: () => {},
        storeCredentials: () => Promise.resolve(),
        hideWindow: () => {},
        onLoadSavedTheme: (callback) => {
          window.velocityApi._savedThemeCallback = callback;
        },
      };
    },
  });
  dom.window.eval(velocityEndpointScript);
  dom.window.eval(velocityLoginScript);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('Config dialog applies data and live theme updates', () => {
  const dom = createDom(configHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/config.html', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
      configThemeApplied: () => {},
    };
    window.electronAPI = {
      onLoadConfigData: (callback) => {
        window.electronAPI._loadCallback = callback;
      },
    };
  });
  dom.window.api.onLoadSavedTheme((theme) => dom.window.SecondaryWindowTheme.applyTheme(theme));
  dom.window.electronAPI._loadCallback({ theme: 'rose-dark' });
  if (dom.window.document.documentElement.dataset.theme !== 'rose-dark') return false;
  dom.window.api._savedThemeCallback('system');
  return dom.window.document.documentElement.dataset.theme === 'system';
});

test('Error dialog applies data and live theme updates', () => {
  const dom = createDom(errorHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/error.html', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
      errorThemeApplied: () => {},
    };
    window.electronAPI = {
      onLoadErrorData: (callback) => {
        window.electronAPI._loadCallback = callback;
      },
    };
  });
  dom.window.api.onLoadSavedTheme((theme) => dom.window.SecondaryWindowTheme.applyTheme(theme));
  dom.window.electronAPI._loadCallback({ theme: 'blue' });
  if (dom.window.document.documentElement.dataset.theme !== 'blue') return false;
  dom.window.api._savedThemeCallback('system');
  return dom.window.document.documentElement.dataset.theme === 'system';
});

test('Launch configuration dialog applies data and live theme updates', () => {
  const dom = createDom(launchConfigHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/launch-config.html', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
      launchConfigThemeApplied: () => {},
    };
    window.electronAPI = {
      onLoadLaunchConfigData: (callback) => {
        window.electronAPI._loadCallback = callback;
      },
    };
  });
  dom.window.api.onLoadSavedTheme((theme) => dom.window.SecondaryWindowTheme.applyTheme(theme));
  dom.window.electronAPI._loadCallback({ theme: 'green', config: {} });
  if (dom.window.document.documentElement.dataset.theme !== 'green') return false;
  dom.window.api._savedThemeCallback('system');
  return dom.window.document.documentElement.dataset.theme === 'system';
});

test('Velocity login initializes from query theme and reacts to saved theme changes', () => {
  const dom = createLoginDom();
  if (dom.window.document.documentElement.dataset.theme !== 'light-gray') return false;
  dom.window.velocityApi._savedThemeCallback('system');
  return dom.window.document.documentElement.dataset.theme === 'system';
});

test('Theme helper rejects names outside the theme catalog', () => {
  const dom = createDom(
    '<!doctype html><html><body></body></html>',
    'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/help.html',
  );
  dom.window.SecondaryWindowTheme.applyTheme('../../outside');
  return dom.window.document.documentElement.dataset.theme === 'dark';
});

test('Help dialog loads the theme stylesheet after the shared palette', () => {
  const dom = createDom(helpHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/help.html?theme=theme-light-gray', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
    };
    window.electronAPI = {
      send: () => {},
    };
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const { document } = dom.window;
  const themeLink = document.getElementById('current-theme-stylesheet');
  const headChildren = Array.from(document.head.children);
  return Boolean(
    themeLink &&
    themeLink.getAttribute('href') === './themes/theme-light-gray.css' &&
    document.body.className === 'light-gray' &&
    document.documentElement.dataset.theme === 'light-gray' &&
    // themes.css ends with a dark :root fallback palette, so a theme
    // stylesheet inserted ahead of it would lose the cascade on <html>.
    headChildren.indexOf(themeLink) > headChildren.findIndex((node) => node.getAttribute && node.getAttribute('href') === './themes.css') &&
    headChildren.indexOf(themeLink) > headChildren.findIndex((node) => node.getAttribute && node.getAttribute('href') === './help.css'),
  );
});

test('Help dialog updates theme assets and classes live', () => {
  const dom = createDom(helpHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/help.html?theme=theme-rose-dark', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
    };
    window.electronAPI = {
      send: () => {},
    };
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  dom.window.api._savedThemeCallback('system');
  const themeLink = dom.window.document.getElementById('current-theme-stylesheet');
  return Boolean(
    themeLink &&
    themeLink.getAttribute('href') === './themes/theme-system.css' &&
    dom.window.document.body.className === 'system' &&
    dom.window.document.documentElement.dataset.theme === 'system',
  );
});

test('CLI dialog loads the theme stylesheet and keeps body class in sync', () => {
  const dom = createDom(cliHtml, 'file:///Users/hano4470/github/Esri/arcgis-velocity-simulator/src/cli.html?theme=theme-system', (window) => {
    window.api = {
      onLoadSavedTheme: (callback) => {
        window.api._savedThemeCallback = callback;
      },
    };
    window.electronAPI = {
      send: () => {},
    };
  });
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  const themeLink = dom.window.document.getElementById('current-theme-stylesheet');
  return Boolean(
    themeLink &&
    themeLink.getAttribute('href') === './themes/theme-system.css' &&
    dom.window.document.body.className === 'system' &&
    dom.window.document.documentElement.dataset.theme === 'system',
  );
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    if (!fn()) throw new Error('failed');
    console.log(`✅ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`❌ ${name}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(`\n${passed}/${tests.length} secondary-window theme tests passed.`);
