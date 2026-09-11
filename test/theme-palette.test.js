/**
 * Theme Palette Contract Tests
 *
 * These tests resolve the CSS custom-property cascade the way a browser does
 * — per element, with specificity, source order, @media (prefers-color-scheme)
 * and var() substitution — so a palette that is wired to the wrong element
 * fails here instead of only in a screenshot.
 *
 * The regression they guard: help.css used to declare its semantic aliases
 * (--background-color, --surface-color, --help-*) on :root only. A var() inside
 * a custom property is substituted on the element the declaration applies to,
 * and the theme files only set the palette on body.<theme>, so those aliases
 * froze to the dark :root fallback and Help stayed dark under a light theme
 * while inheriting the light theme's near-black --text-color.
 *
 * Run with: node test/theme-palette.test.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '../src');
const THEMES_DIR = path.join(SRC, 'themes');

const THEMES = [
  'blue', 'color-blind', 'dark', 'dark-gray', 'green', 'high-contrast',
  'light', 'light-gray', 'midnight', 'mocha', 'ocean', 'rose', 'rose-dark',
  'sunset', 'system',
];

/* Literal colors that are deliberately theme-independent. */
const LITERAL_COLOR_ALLOWLIST = [
  '.status-text-red',
  '.status-text-orange',
  '.status-text-green',
  '.status-text-blue',
];

const COLOR_PROPERTIES = new Set([
  'color', 'background', 'background-color', 'border-color', 'border-top-color',
  'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color',
  'fill', 'stroke', 'caret-color', 'text-decoration-color',
]);

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const result = fn();
    if (result === true || result === undefined) ok = true;
    else if (typeof result === 'string') detail = result;
    else ok = Boolean(result);
  } catch (error) {
    detail = error && error.message ? error.message : String(error);
  }
  if (ok) {
    passed += 1;
    console.log(`✅ ${name}`);
  } else {
    failed += 1;
    console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/* ------------------------------------------------------------------ */
/* Minimal CSS parsing                                                 */
/* ------------------------------------------------------------------ */

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Flattens a stylesheet into { selector, declarations, media } rule records in
 * source order. Only one level of @media nesting is needed here.
 */
function parseRules(css, mediaCondition = null) {
  const rules = [];
  const source = stripComments(css);
  let index = 0;
  while (index < source.length) {
    const braceStart = source.indexOf('{', index);
    if (braceStart === -1) break;
    const prelude = source.slice(index, braceStart).replace(/^[\s\S]*;/, '').trim();
    let depth = 1;
    let cursor = braceStart + 1;
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth += 1;
      else if (source[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = source.slice(braceStart + 1, cursor - 1);
    if (prelude.startsWith('@media')) {
      const condition = prelude.slice('@media'.length).trim();
      rules.push(...parseRules(body, mediaCondition ? `${mediaCondition} and ${condition}` : condition));
    } else if (!prelude.startsWith('@')) {
      rules.push({ selector: prelude, declarations: parseDeclarations(body), media: mediaCondition });
    }
    index = cursor;
  }
  return rules;
}

function parseDeclarations(body) {
  const declarations = [];
  let buffer = '';
  let depth = 0;
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ';' && depth === 0) {
      pushDeclaration(declarations, buffer);
      buffer = '';
    } else {
      buffer += character;
    }
  }
  pushDeclaration(declarations, buffer);
  return declarations;
}

function pushDeclaration(list, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const colon = trimmed.indexOf(':');
  if (colon === -1) return;
  list.push({
    property: trimmed.slice(0, colon).trim(),
    value: trimmed.slice(colon + 1).trim(),
  });
}

function specificity(selector) {
  const ids = (selector.match(/#[\w-]+/g) || []).length;
  const classes = (selector.match(/\.[\w-]+/g) || []).length
    + (selector.match(/\[[^\]]*\]/g) || []).length
    + (selector.match(/:(?!:)[\w-]+/g) || []).length;
  const types = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/* ------------------------------------------------------------------ */
/* Cascade simulation                                                  */
/* ------------------------------------------------------------------ */

function loadSheet(file) {
  const css = fs.readFileSync(path.join(SRC, file), 'utf-8');
  const withoutImports = stripComments(css).replace(/@import\s+url\(['"]?([^'")]+)['"]?\);?/g, '');
  const imported = [];
  const importPattern = /@import\s+url\(['"]?([^'")]+)['"]?\);?/g;
  let match;
  while ((match = importPattern.exec(stripComments(css))) !== null) {
    imported.push(...parseRules(fs.readFileSync(path.join(SRC, path.dirname(file), match[1]), 'utf-8')));
  }
  return [...imported, ...parseRules(withoutImports)];
}

function mediaApplies(media, colorScheme) {
  if (!media) return true;
  const preference = /prefers-color-scheme:\s*(dark|light)/.exec(media);
  if (preference) return preference[1] === colorScheme;
  if (/prefers-contrast|prefers-reduced-motion|print|max-width|min-width/.test(media)) return false;
  return true;
}

function selectorMatches(selector, element, theme) {
  const compound = selector.trim();
  if (/[\s>+~]/.test(compound)) return false;
  if (element === 'html') {
    if (compound === ':root' || compound === 'html') return true;
    return compound === `:root[data-theme="${theme}"]`
      || compound === `[data-theme="${theme}"]`
      || compound === `html[data-theme="${theme}"]`;
  }
  return compound === 'body' || compound === `body.${theme}`;
}

function collectDeclarations(rules, element, theme, colorScheme) {
  const winners = new Map();
  rules.forEach((rule, order) => {
    if (!mediaApplies(rule.media, colorScheme)) return;
    rule.selector.split(',').forEach((selector) => {
      if (!selectorMatches(selector, element, theme)) return;
      const weight = specificity(selector.trim()) * 1000000 + order;
      rule.declarations.forEach((declaration) => {
        if (!declaration.property.startsWith('--')) return;
        const current = winners.get(declaration.property);
        if (!current || current.weight <= weight) {
          winners.set(declaration.property, { weight, value: declaration.value });
        }
      });
    });
  });
  const map = {};
  winners.forEach((entry, property) => { map[property] = entry.value; });
  return map;
}

function computeProperties(declared, inherited) {
  const cache = new Map();
  const active = new Set();

  function lookup(name) {
    if (cache.has(name)) return cache.get(name);
    if (!(name in declared)) return inherited ? inherited[name] : undefined;
    if (active.has(name)) return undefined;
    active.add(name);
    const value = substitute(declared[name]);
    active.delete(name);
    cache.set(name, value);
    return value;
  }

  function substitute(value) {
    const start = value.indexOf('var(');
    if (start === -1) return value;
    let depth = 0;
    let end = start + 4;
    for (; end < value.length; end += 1) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
    }
    const inner = value.slice(start + 4, end);
    let commaIndex = -1;
    let innerDepth = 0;
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i] === '(') innerDepth += 1;
      else if (inner[i] === ')') innerDepth -= 1;
      else if (inner[i] === ',' && innerDepth === 0) { commaIndex = i; break; }
    }
    const name = (commaIndex === -1 ? inner : inner.slice(0, commaIndex)).trim();
    const fallback = commaIndex === -1 ? undefined : inner.slice(commaIndex + 1).trim();
    let replacement = lookup(name);
    if (replacement === undefined) replacement = fallback === undefined ? '' : substitute(fallback);
    return substitute(value.slice(0, start) + replacement + value.slice(end + 1));
  }

  const names = new Set([...Object.keys(declared), ...Object.keys(inherited || {})]);
  const result = {};
  names.forEach((name) => { result[name] = lookup(name); });
  return result;
}

function resolveTheme(sheets, theme, colorScheme, options = {}) {
  const { rootThemed = true } = options;
  const rules = sheets.flatMap((file) => loadSheet(file));
  const htmlDeclared = collectDeclarations(rules, 'html', rootThemed ? theme : '\u0000unthemed', colorScheme);
  const bodyDeclared = collectDeclarations(rules, 'body', theme, colorScheme);
  const html = computeProperties(htmlDeclared, null);
  const body = computeProperties(bodyDeclared, html);
  return { html, body };
}

/* ------------------------------------------------------------------ */
/* Color math                                                          */
/* ------------------------------------------------------------------ */

function parseColor(input) {
  const value = String(input == null ? '' : input).trim();
  if (!value || value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  const mix = /^color-mix\(\s*in\s+srgb\s*,\s*(.+)\s*\)$/i.exec(value);
  if (mix) return parseColorMix(mix[1]);
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((d) => d + d).join('');
    if (digits.length === 6) digits += 'ff';
    if (digits.length !== 8) throw new Error(`unsupported hex color: ${value}`);
    return {
      r: parseInt(digits.slice(0, 2), 16),
      g: parseInt(digits.slice(2, 4), 16),
      b: parseInt(digits.slice(4, 6), 16),
      a: parseInt(digits.slice(6, 8), 16) / 255,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  const named = { white: '#ffffff', black: '#000000' }[value.toLowerCase()];
  if (named) return parseColor(named);
  throw new Error(`unsupported color: ${value}`);
}

function parseColorMix(body) {
  const parts = splitTopLevel(body);
  if (parts.length !== 2) throw new Error(`unsupported color-mix: ${body}`);
  const first = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(parts[0].trim());
  const second = /^(.*?)(?:\s+([\d.]+)%)?$/.exec(parts[1].trim());
  const firstColor = parseColor(first[1]);
  const secondColor = parseColor(second[1]);
  let firstWeight = first[2] !== undefined ? Number(first[2]) / 100 : undefined;
  let secondWeight = second[2] !== undefined ? Number(second[2]) / 100 : undefined;
  if (firstWeight === undefined && secondWeight === undefined) { firstWeight = 0.5; secondWeight = 0.5; }
  else if (firstWeight === undefined) firstWeight = 1 - secondWeight;
  else if (secondWeight === undefined) secondWeight = 1 - firstWeight;
  const total = firstWeight + secondWeight || 1;
  const wa = firstWeight / total;
  const wb = secondWeight / total;
  const alpha = firstColor.a * wa + secondColor.a * wb;
  const channel = name => alpha
    ? (firstColor[name] * firstColor.a * wa + secondColor[name] * secondColor.a * wb) / alpha : 0;
  return {
    r: channel('r'), g: channel('g'), b: channel('b'),
    a: alpha * Math.min(total, 1),
  };
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let buffer = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) { parts.push(buffer); buffer = ''; } else buffer += character;
  }
  parts.push(buffer);
  return parts;
}

function composite(foreground, background) {
  const alpha = foreground.a;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function relativeLuminance(color) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function controlSpecificity(selector) {
  let remainder = selector;
  let score = 0;
  let match;
  while ((match = /:(where|is|not|has)\(/.exec(remainder))) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < remainder.length && depth) {
      if (remainder[end] === '(') depth++;
      if (remainder[end] === ')') depth--;
      end++;
    }
    if (match[1] !== 'where') score += Math.max(...splitTopLevel(remainder.slice(start, end - 1)).map(controlSpecificity));
    remainder = remainder.slice(0, match.index) + remainder.slice(end);
  }
  return score + specificity(remainder);
}

function resolveDialogControlColors(element, rules, palette, parent) {
  const declarations = new Map();
  rules.forEach((rule, order) => {
    splitTopLevel(rule.selector).forEach(selector => {
      if (selector.includes('::')) return;
      const stateSelector = selector.replace(/:(hover|focus-visible|focus|active)\b/g, '[data-contrast-$1]');
      if (!element.matches(stateSelector)) return;
      const weight = controlSpecificity(selector) * 1000000 + order;
      rule.declarations.forEach(({ property, value }) => {
        const canonical = property === 'background' ? 'background-color' : property;
        if (!['color', 'background-color', 'background-image', 'opacity'].includes(canonical)) return;
        const previous = declarations.get(canonical);
        if (!previous || weight >= previous.weight) declarations.set(canonical, { value, weight });
        if (property === 'background') {
          const image = declarations.get('background-image');
          if (!image || weight >= image.weight) declarations.set('background-image', { value: 'none', weight });
        }
      });
    });
  });
  parseDeclarations(element.getAttribute('style') || '').forEach(({ property, value }) => {
    const canonical = property === 'background' ? 'background-color' : property;
    if (['color', 'background-color', 'background-image', 'opacity'].includes(canonical)) declarations.set(canonical, { value, weight: Infinity });
    if (property === 'background') declarations.set('background-image', { value: 'none', weight: Infinity });
  });
  const value = property => {
    const declaration = declarations.get(property);
    return declaration ? computeProperties({ '--measurement': declaration.value }, palette)['--measurement'] : undefined;
  };
  const foregroundValue = value('color');
  const color = !foregroundValue || ['inherit', 'currentColor'].includes(foregroundValue) ? parent.color : parseColor(foregroundValue);
  const backgroundValue = value('background-color');
  const currentColor = `rgba(${color.r},${color.g},${color.b},${color.a})`;
  const backgroundColor = backgroundValue === 'inherit' ? parent.backgroundColor
    : parseColor(!backgroundValue || backgroundValue === 'none' ? 'transparent' : backgroundValue.replace(/currentColor/g, currentColor));
  const background = composite(backgroundColor, parent.background);
  const opacity = value('opacity') === undefined ? 1 : Number(value('opacity'));
  return {
    color,
    backgroundColor,
    backgroundImage: value('background-image') || 'none',
    opacity,
    background: composite({ ...background, a: opacity }, parent.background),
    foreground: composite({ ...composite(color, background), a: opacity }, parent.background),
    hasOwnColor: declarations.has('color'),
  };
}

const DIALOG_VIEWS = [
  { name: 'Main window', file: 'index.html', main: true },
  { name: 'Main window compact', file: 'index.html', main: true, compact: true },
  { name: 'Velocity Login', file: 'velocity-login.html' },
  { name: 'App Config', file: 'config.html' },
  { name: 'Launch Config', file: 'launch-config.html' },
  { name: 'Error', file: 'error.html' },
  { name: 'About', file: 'about.html' },
  { name: 'Help', file: 'help.html' },
  { name: 'CLI', file: 'cli.html' },
  { name: 'Protocol Settings embedded', file: 'index.html', selector: '#protocol-settings-dialog' },
  { name: 'Protocol Settings detached', file: 'protocol-settings.html', selector: '#protocol-settings-dialog' },
];

function measureDialogButtons(view, theme, colorScheme) {
  const html = fs.readFileSync(path.join(SRC, view.file), 'utf8');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const effectiveTheme = theme === 'system' && ['index.html', 'protocol-settings.html'].includes(view.file) ? colorScheme : theme;
  document.documentElement.dataset.theme = effectiveTheme;
  document.body.classList.add(effectiveTheme);
  document.body.classList.toggle('compact', Boolean(view.compact));
  if (view.main) {
    const count = document.getElementById('protocol-settings-count');
    count.hidden = false;
    count.textContent = '12';
  }
  if (view.file === 'velocity-login.html') {
    const fixtures = document.createElement('div');
    fixtures.innerHTML = '<button class="btn-outline">Outline</button><button class="btn-icon btn-icon-toggle">Icon toggle</button><button class="btn-toggle-text">Text toggle</button>';
    document.querySelector('.velocity-login-dialog').appendChild(fixtures);
  }
  if (view.file === 'cli.html') {
    const fixtures = document.createElement('div');
    fixtures.innerHTML = '<button class="cli-copy-button">Copy example</button><button class="cli-active-filter-pill is-removable">Remove filter</button>';
    document.querySelector('.help-container').appendChild(fixtures);
  }
  if (view.file === 'protocol-settings.html') {
    const main = new JSDOM(fs.readFileSync(path.join(SRC, 'index.html'), 'utf8'));
    document.getElementById('protocol-settings-root').innerHTML = main.window.document.getElementById('protocol-settings-dialog').outerHTML;
    main.window.close();
  }
  const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute('href').replace(/^\.\//, ''));
  const lastThemeSheet = view.file === 'index.html' ? [] : [`themes/theme-${effectiveTheme}.css`];
  sheets.push(...lastThemeSheet);
  const palette = resolveTheme(sheets, effectiveTheme, colorScheme).body;
  const rules = [...document.querySelectorAll('link[rel="stylesheet"], style')].flatMap(node => (
    node.tagName === 'STYLE' ? parseRules(node.textContent) : loadSheet(node.getAttribute('href').replace(/^\.\//, ''))
  )).concat(lastThemeSheet.flatMap(loadSheet)).filter(rule => (
    mediaApplies(rule.media, colorScheme)
      && rule.declarations.some(({ property }) => ['color', 'background', 'background-color', 'background-image', 'opacity'].includes(property))
  ));
  const cache = new Map();
  const canvas = {
    color: parseColor(palette['--text-color']), background: parseColor(palette['--bg-color']),
    backgroundColor: parseColor('transparent'), opacity: 1,
  };
  function ancestorColors(element) {
    if (!element) return canvas;
    if (!cache.has(element)) cache.set(element, resolveDialogControlColors(element, rules, palette, ancestorColors(element.parentElement)));
    return cache.get(element);
  }
  const states = [
    { name: 'normal' }, { name: 'hover', hover: true }, { name: 'focus', focus: true },
    { name: 'hover + focus', hover: true, focus: true }, { name: 'pressed', active: true },
    { name: 'pressed + hover', active: true, hover: true }, { name: 'pressed + focus', active: true, focus: true },
    { name: 'disabled', disabled: true }, { name: 'disabled hover', disabled: true, hover: true },
    { name: 'disabled focus', disabled: true, focus: true },
  ];
  const measurements = [];
  const root = view.selector ? document.querySelector(view.selector) : document;
  if (view.selector) root.setAttribute('open', '');
  const presentations = view.selector ? [false, true] : [false];
  const controls = [...root.querySelectorAll(view.main ? 'button, [role="button"]' : 'button')]
    .filter(button => !view.main || !button.closest('.protocol-settings-dialog'));
  const buttonCases = presentations.flatMap(readOnly => controls.map(button => ({ button, readOnly })));
  for (const { button, readOnly } of buttonCases) {
    if (view.selector && root.dataset.readOnly !== String(readOnly)) {
      root.dataset.readOnly = String(readOnly);
      cache.clear();
    }
    const viewName = `${view.name}${readOnly ? ' read-only' : ''}`;
    let ancestorOpacity = 1;
    for (let parent = button.parentElement; parent; parent = parent.parentElement) ancestorOpacity *= ancestorColors(parent).opacity;
    const activeStates = button.matches('.scope-btn, .auth-tab, .btn-icon-toggle, .btn-toggle-text, .protocol-settings-tab, .cli-filter-chip, .control-button, .tls-badge, #play-pause')
      ? [false, true] : [button.classList.contains('active')];
    const banners = button.classList.contains('status-banner-dismiss') ? ['info', 'success', 'error', 'warning']
      : button.id === 'auth-badge' ? ['off', 'on', 'warning', 'error']
        : button.id === 'protocol-settings-btn' ? ['count', 'warning'] : [''];
    for (const banner of banners) {
      if (button.id === 'auth-badge') {
        button.dataset.authState = banner;
      } else if (button.id === 'protocol-settings-btn') {
        document.getElementById('protocol-settings-count').dataset.warning = String(banner === 'warning');
      } else if (banner) {
        button.parentElement.className = `status-banner ${banner}`;
        cache.delete(button.parentElement);
      }
      for (const selected of activeStates) {
        const activeClass = button.matches('.cli-filter-chip') ? 'is-active'
          : button.matches('.tls-badge') ? 'pinned'
            : button.id === 'play-pause' ? 'is-playing' : 'active';
        if (button.hasAttribute('data-enabled')) button.dataset.enabled = String(selected);
        else button.classList.toggle(activeClass, selected);
        for (const state of states) {
          if (!button.matches('button') && state.disabled) continue;
          button.disabled = Boolean(state.disabled);
          for (const pseudo of ['hover', 'focus-visible', 'focus', 'active']) {
            button.toggleAttribute(`data-contrast-${pseudo}`, Boolean(pseudo.startsWith('focus') ? state.focus : state[pseudo]));
          }
          const paint = resolveDialogControlColors(button, rules, palette, ancestorColors(button.parentElement));
          if (paint.backgroundImage !== 'none') throw new Error(`${button.id || button.className} ${state.name} has an image or gradient background that needs rendered contrast measurement`);
          if (button.matches('button') && !paint.hasOwnColor) throw new Error(`${button.id || button.className} has no explicit foreground`);
          if (view.main) {
            const role = ({
              connect: 'success', disconnect: 'danger', 'play-pause': 'primary',
              'send-manual': 'warning', 'select-file': 'info', 'clear-status': 'info',
            })[button.id] || (button.matches('.control-button') ? (selected ? 'toggle' : 'info') : '');
            if (role) {
              const token = state.disabled ? '--action-button-disabled-' : `--action-${role}-${state.hover ? 'hover-' : ''}`;
              const expectedText = parseColor(palette[`${token}text`]);
              const expectedBackground = parseColor(palette[`${token}bg`]);
              if (['r', 'g', 'b', 'a'].some(channel => (
                paint.color[channel] !== expectedText[channel] || paint.backgroundColor[channel] !== expectedBackground[channel]
              ))) throw new Error(`${button.id} ${state.name} does not use its ${role} role's paired colors`);
            }
          }
          measurements.push({
            name: `${viewName}: ${button.id || button.className}${selected ? ' selected' : ''}${banner ? ` ${banner}` : ''} ${state.name}`,
            ratio: contrastRatio(paint.foreground, paint.background), disabled: Boolean(state.disabled),
            state: state.name, opacity: paint.opacity * ancestorOpacity,
          });
          for (const child of button.querySelectorAll('*')) {
            if (child.closest('.tls-badge-popover')) continue;
            if (![...child.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
            const childPaint = resolveDialogControlColors(child, rules, palette, paint);
            measurements.push({
              name: `${viewName}: ${button.id || button.className}${selected ? ' selected' : ''}${banner ? ` ${banner}` : ''} child ${child.className} ${state.name}`,
              ratio: contrastRatio(childPaint.foreground, childPaint.background), disabled: Boolean(state.disabled),
              state: state.name, opacity: paint.opacity * childPaint.opacity * ancestorOpacity,
            });
          }
        }
      }
    }
  }
  dom.window.close();
  return measurements;
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

const HELP_SHEETS = ['themes.css', 'help.css', 'accessibility.css'];
const CLI_SHEETS = ['themes.css', 'help.css', 'cli.css', 'accessibility.css'];

/* Alias -> the base token it must equal for every theme. */
const ALIAS_CONTRACT = {
  '--background-color': '--bg-color',
  '--surface-color': '--container-bg',
  '--primary-color': '--header-color',
  '--accent-color': '--version-color',
  '--button-border': '--button-bg',
  '--button-hover-bg': '--button-hover',
  '--help-background': '--bg-color',
  '--help-surface': '--container-bg',
  '--help-raised': '--log-bg',
  '--help-text': '--text-color',
  '--help-border': '--border-color',
  '--help-accent': '--version-color',
  '--help-heading': '--header-color',
  '--help-code-bg': '--code-bg',
};

function themeCases() {
  const cases = [];
  THEMES.forEach((theme) => {
    if (theme === 'system') {
      cases.push({ theme, colorScheme: 'dark', label: 'system (OS dark)' });
      cases.push({ theme, colorScheme: 'light', label: 'system (OS light)' });
    } else {
      cases.push({ theme, colorScheme: 'dark', label: theme });
    }
  });
  return cases;
}

function runThemePaletteTests() {
  console.log('🎨 Theme Palette Contract Tests');
  console.log('='.repeat(50));

  console.log('\n--- Test 1: Selected theme reaches the document root ---');
  THEMES.forEach((theme) => {
    runTest(`${theme}: :root carries the theme palette, not the dark fallback`, () => {
      const scheme = theme === 'light' ? 'light' : 'dark';
      const { html } = resolveTheme(HELP_SHEETS, theme, scheme);
      const themeFile = fs.readFileSync(path.join(THEMES_DIR, `theme-${theme}.css`), 'utf-8');
      const expected = /--bg-color:\s*([^;]+);/.exec(
        theme === 'system'
          ? stripComments(themeFile).split('prefers-color-scheme: dark')[1]
          : stripComments(themeFile).split(`data-theme="${theme}"`)[1],
      );
      if (!expected) return `could not read --bg-color from theme-${theme}.css`;
      return html['--bg-color'] === expected[1].trim()
        || `:root resolved --bg-color to ${html['--bg-color']}, expected ${expected[1].trim()}`;
    });
  });

  console.log('\n--- Test 2: Semantic aliases track the active theme ---');
  themeCases().forEach(({ theme, colorScheme, label }) => {
    const { html, body } = resolveTheme(HELP_SHEETS, theme, colorScheme);
    Object.entries(ALIAS_CONTRACT).forEach(([alias, base]) => {
      runTest(`${label}: ${alias} resolves to ${base} on body`, () => (
        body[alias] === body[base]
          || `${alias}=${body[alias]} but ${base}=${body[base]}`
      ));
    });
    runTest(`${label}: <html> and <body> resolve the same Help palette`, () => {
      const mismatch = Object.keys(ALIAS_CONTRACT).find((alias) => html[alias] !== body[alias]);
      return !mismatch || `${mismatch}: html=${html[mismatch]} body=${body[mismatch]}`;
    });
  });

  console.log('\n--- Test 3: Help text stays legible on every themed surface ---');
  themeCases().forEach(({ theme, colorScheme, label }) => {
    const { body } = resolveTheme(HELP_SHEETS, theme, colorScheme);
    const page = parseColor(body['--help-background']);
    const surface = composite(parseColor(body['--help-surface']), page);
    const raised = composite(parseColor(body['--help-raised']), surface);
    const text = composite(parseColor(body['--help-text']), surface);
    const heading = composite(parseColor(body['--help-heading']), surface);
    const muted = composite(parseColor(body['--help-muted']), surface);

    runTest(`${label}: body text over the page background is legible`, () => {
      const ratio = contrastRatio(composite(parseColor(body['--help-text']), page), page);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    /* html, body in help.css paints text with --text-color while the page and
       card backgrounds come from the --help-* aliases. If the aliases resolve
       against a different element than the palette reached, this pair is the
       one that goes dark-on-dark. */
    runTest(`${label}: --text-color over the --help-background page is legible`, () => {
      const ratio = contrastRatio(composite(parseColor(body['--text-color']), page), page);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    runTest(`${label}: --text-color over the --help-surface card is legible`, () => {
      const ratio = contrastRatio(composite(parseColor(body['--text-color']), surface), surface);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    runTest(`${label}: body text over a card surface is legible`, () => {
      const ratio = contrastRatio(text, surface);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    runTest(`${label}: headings over a card surface are legible`, () => {
      const ratio = contrastRatio(heading, surface);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    runTest(`${label}: text over a raised surface (inputs, table headers) is legible`, () => {
      const ratio = contrastRatio(composite(parseColor(body['--help-text']), raised), raised);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
    runTest(`${label}: muted text keeps large-text contrast`, () => {
      const ratio = contrastRatio(muted, surface);
      return ratio >= 3 || `contrast ${ratio.toFixed(2)}:1`;
    });
  });

  console.log('\n--- Test 4: A body theme class alone still themes the views ---');
  themeCases().forEach(({ theme, colorScheme, label }) => {
    const { body } = resolveTheme(HELP_SHEETS, theme, colorScheme, { rootThemed: false });
    runTest(`${label}: aliases re-resolve on <body> when only the class is set`, () => {
      const mismatch = Object.entries(ALIAS_CONTRACT)
        .find(([alias, base]) => body[alias] !== body[base]);
      return !mismatch || `${mismatch[0]}=${body[mismatch[0]]} but ${mismatch[1]}=${body[mismatch[1]]}`;
    });
    runTest(`${label}: class-only theming keeps Help text legible`, () => {
      const page = parseColor(body['--help-background']);
      const ratio = contrastRatio(composite(parseColor(body['--text-color']), page), page);
      return ratio >= 4.5 || `contrast ${ratio.toFixed(2)}:1`;
    });
  });

  console.log('\n--- Test 5: Command Line Interface shares the Help palette ---');  themeCases().forEach(({ theme, colorScheme, label }) => {
    const help = resolveTheme(HELP_SHEETS, theme, colorScheme).body;
    const cli = resolveTheme(CLI_SHEETS, theme, colorScheme).body;
    runTest(`${label}: CLI resolves the same semantic palette as Help`, () => {
      const mismatch = Object.keys(ALIAS_CONTRACT).find((alias) => help[alias] !== cli[alias]);
      return !mismatch || `${mismatch}: help=${help[mismatch]} cli=${cli[mismatch]}`;
    });
  });

  console.log('\n--- Test 6: Palette ownership ---');
  const themesCss = fs.readFileSync(path.join(SRC, 'themes.css'), 'utf-8');
  runTest('themes.css declares the semantic aliases on both :root and body', () => {
    const rules = parseRules(themesCss).filter((rule) => {
      const selectors = rule.selector.split(',').map((part) => part.trim());
      return selectors.includes(':root') && selectors.includes('body');
    });
    if (rules.length === 0) return 'no ":root, body" rule found in themes.css';
    const declared = new Set(rules.flatMap((rule) => rule.declarations.map((d) => d.property)));
    const missing = Object.keys(ALIAS_CONTRACT).filter((alias) => !declared.has(alias));
    return missing.length === 0 || `missing: ${missing.join(', ')}`;
  });

  ['help.css', 'cli.css'].forEach((file) => {
    runTest(`${file} does not redefine the shared palette on :root`, () => {
      const rules = parseRules(fs.readFileSync(path.join(SRC, file), 'utf-8'));
      const offenders = [];
      rules.forEach((rule) => {
        const selectors = rule.selector.split(',').map((part) => part.trim());
        if (!selectors.some((selector) => selector === ':root' || selector === 'html')) return;
        rule.declarations
          .filter((declaration) => declaration.property.startsWith('--'))
          .forEach((declaration) => offenders.push(declaration.property));
      });
      return offenders.length === 0 || `declares ${offenders.join(', ')} at :root`;
    });
  });

  console.log('\n--- Test 7: No hard-coded palette overrides ---');
  ['help.css', 'cli.css'].forEach((file) => {
    const rules = parseRules(fs.readFileSync(path.join(SRC, file), 'utf-8'))
      .filter((rule) => !rule.media || !/print/.test(rule.media));
    runTest(`${file} paints color properties from tokens only`, () => {
      const offenders = [];
      rules.forEach((rule) => {
        const selectors = rule.selector.split(',').map((part) => part.trim());
        if (selectors.some((selector) => LITERAL_COLOR_ALLOWLIST.includes(selector))) return;
        rule.declarations.forEach((declaration) => {
          if (!COLOR_PROPERTIES.has(declaration.property)) return;
          const withoutVars = declaration.value.replace(/var\([^()]*\)/g, '');
          if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bwhite\b|\bblack\b/.test(withoutVars)) {
            offenders.push(`${rule.selector} { ${declaration.property}: ${declaration.value} }`);
          }
        });
      });
      return offenders.length === 0 || offenders.join(' | ');
    });

    runTest(`${file} uses no hard-coded color fallback inside var()`, () => {
      const css = stripComments(fs.readFileSync(path.join(SRC, file), 'utf-8'));
      const offenders = (css.match(/var\(\s*--[\w-]+\s*,[^)]*\)/g) || [])
        .filter((usage) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(usage));
      return offenders.length === 0 || offenders.join(' | ');
    });
  });

  console.log('\n--- Test 8: Theme selectors outrank the fallback palette ---');
  runTest('themes.css ends with a :root fallback palette', () => {
    const rules = parseRules(themesCss).filter((rule) => rule.selector.trim() === ':root');
    return rules.length > 0 || 'no :root fallback found';
  });
  THEMES.forEach((theme) => {
    runTest(`theme-${theme}.css targets :root[data-theme="${theme}"]`, () => {
      const css = stripComments(fs.readFileSync(path.join(THEMES_DIR, `theme-${theme}.css`), 'utf-8'));
      if (!css.includes(`:root[data-theme="${theme}"]`)) {
        return `missing :root[data-theme="${theme}"]`;
      }
      const bare = new RegExp(`(^|[,{}\\s])\\[data-theme="${theme}"\\]`, 'm');
      return !bare.test(css) || `a bare [data-theme="${theme}"] selector loses to the :root fallback`;
    });
  });

  console.log('\n--- Test 9: Secondary windows load the theme last ---');
  runTest('secondary-window-theme.js appends the theme stylesheet to <head>', () => {
    const source = fs.readFileSync(path.join(SRC, 'secondary-window-theme.js'), 'utf-8');
    if (/insertBefore\(\s*themeLink/.test(source)) {
      return 'theme stylesheet is inserted before themes.css and loses the cascade';
    }
    return /head\.appendChild\(\s*themeLink\s*\)/.test(source) || 'no appendChild(themeLink) found';
  });
  runTest('secondary-window-theme.js sets data-theme on the document root', () => {
    const source = fs.readFileSync(path.join(SRC, 'secondary-window-theme.js'), 'utf-8');
    return /documentElement\.setAttribute\('data-theme'/.test(source);
  });
  runTest('renderer applyTheme sets data-theme on the document root', () => {
    const source = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf-8');
    return /documentElement\.setAttribute\('data-theme'/.test(source);
  });

  console.log('\n--- Test 10: Button background cascade safeguards ---');
  runTest('a background-color override cannot hide an active gradient from the contrast check', () => {
    const dom = new JSDOM('<button class="active" disabled>Action</button>');
    const button = dom.window.document.querySelector('button');
    const rules = parseRules('button.active { background-image: linear-gradient(white, black); } button:disabled { color: white; background-color: black; }');
    const parent = { color: parseColor('white'), background: parseColor('black'), backgroundColor: parseColor('black') };
    const layered = resolveDialogControlColors(button, rules, {}, parent);
    const cleared = resolveDialogControlColors(button, rules.concat(parseRules('button:disabled { background: black; }')), {}, parent);
    dom.window.close();
    return layered.backgroundImage.startsWith('linear-gradient(') && cleared.backgroundImage === 'none';
  });

  console.log('\n--- Test 11: Shared semantic button pairs ---');
  themeCases().forEach(({ theme, colorScheme, label }) => {
    runTest(`${label}: every semantic role has a readable normal and hover pair`, () => {
      const palette = resolveTheme(['themes.css', 'style.css'], theme, colorScheme).body;
      for (const role of ['button', 'primary', 'success', 'danger', 'warning', 'info', 'toggle']) {
        for (const state of role === 'button' ? ['', 'hover-', 'disabled-'] : ['', 'hover-']) {
          const keys = [`--action-${role}-${state}text`, `--action-${role}-${state}bg`];
          if (keys.some(key => !palette[key])) return `Missing ${role} ${state} pair`;
          const colors = keys.map(key => parseColor(palette[key]));
          if (colors.some(color => color.a !== 1)) return `${role} ${state} pair is not opaque`;
          const ratio = contrastRatio(...colors);
          if (ratio < 4.5) return `${role} ${state || 'normal'}: ${ratio.toFixed(3)}:1`;
        }
      }
      return true;
    });
  });

  console.log('\n--- Test 12: Window and dialog button contrast in every interactive state ---');
  let lowestDialogContrast = { ratio: Infinity, name: '' };
  let lowestDisabledContrast = { ratio: Infinity, name: '' };
  const stateMinimums = new Map();
  let dialogMeasurements = 0;
  themeCases().forEach(({ theme, colorScheme, label }) => {
    DIALOG_VIEWS.forEach(view => {
      runTest(`${label}: ${view.name} button states retain 4.5:1 contrast`, () => {
        const measurements = measureDialogButtons(view, theme, colorScheme);
        if (!measurements.length) return 'No buttons were measured.';
        dialogMeasurements += measurements.length;
        for (const measurement of measurements) {
          if (measurement.ratio < lowestDialogContrast.ratio) lowestDialogContrast = { ...measurement, name: `${label}: ${measurement.name}` };
          if (measurement.disabled && measurement.ratio < lowestDisabledContrast.ratio) lowestDisabledContrast = { ...measurement, name: `${label}: ${measurement.name}` };
          stateMinimums.set(measurement.state, Math.min(stateMinimums.get(measurement.state) || Infinity, measurement.ratio));
        }
        const failures = measurements.filter(measurement => measurement.ratio < 4.5 || measurement.opacity !== 1);
        return failures.length === 0 || failures.map(measurement => (
          `${measurement.name}: ${measurement.ratio.toFixed(3)}:1, opacity ${measurement.opacity}`
        )).slice(0, 12).join(' | ');
      });
    });
  });
  console.log(`Dialog contrast: ${dialogMeasurements} measurements across ${DIALOG_VIEWS.length} surfaces and ${themeCases().length} theme configurations; minimum ${lowestDialogContrast.ratio.toFixed(3)}:1 (${lowestDialogContrast.name}); disabled minimum ${lowestDisabledContrast.ratio.toFixed(3)}:1 (${lowestDisabledContrast.name}).`);
  console.log(`State minimums: ${[...stateMinimums].map(([state, ratio]) => `${state} ${ratio.toFixed(3)}:1`).join('; ')}.`);

  console.log('\n=== Test Results ===');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);

  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  runThemePaletteTests();
}

module.exports = { runThemePaletteTests };
