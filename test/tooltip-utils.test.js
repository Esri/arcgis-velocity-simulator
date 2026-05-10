const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const script = fs.readFileSync(path.join(__dirname, '../src/tooltip-utils.js'), 'utf8');
  const styleCss = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
  const dom = new JSDOM(`<!doctype html><html lang="en"><head></head><body>
    <button id="static" title="Static Tooltip&#10;Mode: Test">Static</button>
    <button id="footer" data-tooltip="Custom Footer Tooltip" title="Native Footer Tooltip">Footer</button>
  </body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });

  dom.window.eval(script);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));

  const staticButton = dom.window.document.getElementById('static');
  assert.strictEqual(staticButton.getAttribute('title'), null, 'native title should be removed during migration');
  assert.strictEqual(staticButton.getAttribute('data-tooltip'), 'Static Tooltip\nMode: Test');
  assert.strictEqual(staticButton.getAttribute('aria-label'), 'Static Tooltip Mode: Test');

  const footerButton = dom.window.document.getElementById('footer');
  assert.strictEqual(footerButton.getAttribute('title'), null, 'controls with data-tooltip should not keep a native title');
  assert.strictEqual(footerButton.getAttribute('data-tooltip'), 'Custom Footer Tooltip', 'existing custom tooltip text should win over static title text');

  assert.match(styleCss, /\.tls-badge-popover\s*{[^}]*display:\s*none !important;/s, 'legacy TLS/auth footer popover should stay disabled');
  assert.doesNotMatch(styleCss, /\.tls-badge:hover\s+\.tls-badge-popover\s*{[^}]*opacity:\s*1/s, 'legacy footer hover popover should not be re-enabled');

  const dynamicButton = dom.window.document.createElement('button');
  dom.window.document.body.appendChild(dynamicButton);
  dynamicButton.title = 'Dynamic Tooltip\nStatus: Ready';
  assert.strictEqual(dynamicButton.getAttribute('title'), null, 'dynamic title property should not create a native title');
  assert.strictEqual(dynamicButton.getAttribute('data-tooltip'), 'Dynamic Tooltip\nStatus: Ready');

  dynamicButton.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true }));
  await delay(550);

  const tooltip = dom.window.document.getElementById('custom-tooltip');
  assert(tooltip.classList.contains('visible'), 'custom tooltip should become visible after hover delay');
  assert(tooltip.querySelector('.custom-tooltip-title'), 'tooltip should render a title line');
  assert(tooltip.querySelector('.custom-tooltip-row'), 'tooltip should format Label: Value rows');
  assert(tooltip.querySelector('.custom-tooltip-copy'), 'tooltip should include a copy affordance');
  assert.strictEqual(tooltip.getAttribute('aria-hidden'), 'false');

  dynamicButton.dataset.tooltip = 'Token On — Velocity token will be sent.\nAction: Click to turn token sending off.';
  dynamicButton.dataset.tooltipIcon = '🔑';
  dynamicButton.dataset.tooltipKind = 'auth';
  await delay(20);

  assert(tooltip.classList.contains('visible'), 'tooltip should remain visible after active control tooltip changes');
  assert.match(tooltip.textContent, /Token On/, 'visible tooltip should refresh to the updated state title');
  assert.match(tooltip.textContent, /turn token sending off/, 'visible tooltip should refresh updated action text');
  assert.strictEqual(tooltip.querySelector('.custom-tooltip-icon').textContent, '🔑');
  assert(tooltip.classList.contains('custom-tooltip-auth'), 'visible tooltip should refresh kind styling');

  console.log('tooltip-utils tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

