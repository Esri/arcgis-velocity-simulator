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
    <button id="plain">Plain</button>
    <dialog id="modal"><button id="dialog-control" data-tooltip="Dialog Tooltip">Dialog control</button></dialog>
  </body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });

  const pointer = (target, type, x = 0, y = 0, relatedTarget = null) => {
    const event = new dom.window.MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      relatedTarget,
    });
    Object.defineProperty(event, 'pointerType', { value: 'mouse' });
    target.dispatchEvent(event);
  };

  dom.window.matchMedia = () => ({ matches: false });
  dom.window.eval(script);
  dom.window.initCustomTooltips();

  const staticButton = dom.window.document.getElementById('static');
  assert.strictEqual(staticButton.getAttribute('title'), null, 'native titles should be migrated');
  assert.strictEqual(staticButton.getAttribute('data-tooltip'), 'Static Tooltip\nMode: Test');
  assert.strictEqual(staticButton.getAttribute('aria-label'), null, 'visible button text should remain its accessible name');

  const footerButton = dom.window.document.getElementById('footer');
  assert.strictEqual(footerButton.getAttribute('title'), null, 'controls with data-tooltip should not keep a native title');
  assert.strictEqual(footerButton.getAttribute('data-tooltip'), 'Custom Footer Tooltip', 'explicit custom text should win');
  assert.strictEqual(dom.window.document.getElementById('plain').getAttribute('data-tooltip'), null,
    'visible labels should not be duplicated into fallback tooltips');

  assert.match(styleCss, /\.custom-tooltip\.visible\s*{[^}]*pointer-events:\s*none/s,
    'hover tooltips must not intercept normal interaction');
  assert.match(styleCss, /\.custom-tooltip-copy\s*{[^}]*display:\s*none/s,
    'intent tooltips are informational rather than interactive');

  const dynamicButton = dom.window.document.createElement('button');
  dynamicButton.textContent = 'Dynamic';
  dom.window.document.body.appendChild(dynamicButton);
  dynamicButton.title = 'Dynamic Tooltip\nStatus: Ready';
  assert.strictEqual(dynamicButton.getAttribute('title'), null, 'dynamic native titles should be suppressed');

  pointer(dynamicButton, 'pointerover', 20, 20);
  await delay(550);
  const tooltip = dom.window.document.querySelector('.custom-tooltip');
  assert(!tooltip.classList.contains('visible'), 'ordinary short hovers should not show a tooltip');
  await delay(400);
  assert(tooltip.classList.contains('visible'), 'a stationary intentional hover should show the tooltip');
  assert(tooltip.querySelector('.custom-tooltip-title'), 'tooltip should render a title line');
  assert(tooltip.querySelector('.custom-tooltip-row'), 'tooltip should format Label: Value rows');
  assert.strictEqual(tooltip.getAttribute('aria-hidden'), 'false');

  pointer(dynamicButton, 'pointermove', 30, 30);
  assert(!tooltip.classList.contains('visible'), 'meaningful movement should dismiss a visible tooltip');

  pointer(dynamicButton, 'pointerover', 30, 30);
  await delay(300);
  pointer(dynamicButton, 'pointermove', 40, 40);
  await delay(650);
  assert(!tooltip.classList.contains('visible'), 'movement should restart the stationary-hover delay');
  await delay(300);
  assert(tooltip.classList.contains('visible'), 'the tooltip should appear after the pointer becomes stationary again');

  dynamicButton.dataset.tooltip = 'Token On — Velocity token will be sent.\nAction: Click to turn token sending off.';
  dynamicButton.dataset.tooltipIcon = '🔑';
  dynamicButton.dataset.tooltipKind = 'auth';
  await delay(20);
  assert.match(tooltip.textContent, /Token On/, 'visible dynamic content should refresh');
  assert.strictEqual(tooltip.querySelector('.custom-tooltip-icon').textContent, '🔑');
  assert(tooltip.classList.contains('custom-tooltip-auth'));

  pointer(dynamicButton, 'pointerdown', 40, 40);
  assert(!tooltip.classList.contains('visible'), 'pointer interaction should dismiss the tooltip immediately');
  dynamicButton.focus();
  await delay(20);
  assert(!tooltip.classList.contains('visible'), 'focus alone should not show a visual tooltip');
  assert.match(dynamicButton.getAttribute('aria-describedby') || '', /\bcustom-tooltip\b/,
    'focused controls should retain the tooltip as an accessible description');
  assert.match(tooltip.textContent, /Token On/, 'the hidden accessible description should contain the current tooltip');
  dynamicButton.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.match(dynamicButton.getAttribute('aria-describedby') || '', /\bcustom-tooltip\b/,
    'keyboard interaction should preserve the focused control description');
  dynamicButton.dataset.tooltip = 'Updated focused description';
  await delay(20);
  assert.match(tooltip.textContent, /Updated focused description/,
    'dynamic content should refresh while serving as a focused description');

  const modal = dom.window.document.getElementById('modal');
  modal.setAttribute('open', '');
  const dialogControl = dom.window.document.getElementById('dialog-control');
  pointer(dialogControl, 'pointerover', 10, 10);
  await delay(950);
  assert(!tooltip.classList.contains('visible'), 'hover tooltips should stay suppressed while a modal dialog is open');

  assert.match(script, /HOVER_INTENT_DELAY_MS = 900/);
  assert.match(script, /HOVER_MOVE_TOLERANCE_PX = 4/);
  assert.match(script, /INTERACTION_COOLDOWN_MS = 600/);
  assert.doesNotMatch(script, /addEventListener\('focusin'[\s\S]{0,160}showTooltip/,
    'focus handling should never arm the visual tooltip');

  console.log('tooltip-utils tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
