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
  return {
    r: firstColor.r * wa + secondColor.r * wb,
    g: firstColor.g * wa + secondColor.g * wb,
    b: firstColor.b * wa + secondColor.b * wb,
    a: firstColor.a * wa + secondColor.a * wb,
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
