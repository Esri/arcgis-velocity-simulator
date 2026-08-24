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

(function initSecondaryWindowTheme() {
  'use strict';

  const DEFAULT_THEME = 'dark';
  const AVAILABLE_THEMES = new Set([
    'light', 'dark', 'dark-gray', 'light-gray', 'blue', 'green',
    'high-contrast', 'color-blind', 'system', 'midnight', 'sunset',
    'rose', 'rose-dark', 'ocean', 'mocha',
  ]);

  function normalizeTheme(theme) {
    const value = typeof theme === 'string' ? theme.trim() : '';
    if (!value) return DEFAULT_THEME;
    const normalized = value.startsWith('theme-') ? value.slice('theme-'.length) : value;
    return AVAILABLE_THEMES.has(normalized) ? normalized : DEFAULT_THEME;
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    if (!document.documentElement) return;
    if (document.documentElement.dataset.theme !== normalized) {
      document.documentElement.setAttribute('data-theme', normalized);
    }
    const href = `./themes/theme-${normalized}.css`;
    let themeLink = document.getElementById('current-theme-stylesheet');
    if (!themeLink) {
      themeLink = document.createElement('link');
      themeLink.id = 'current-theme-stylesheet';
      themeLink.rel = 'stylesheet';
      // Appended last so the selected theme's declarations are never
      // overridden by the fallback palette that themes.css ends with.
      document.head.appendChild(themeLink);
    }
    if (themeLink.getAttribute('href') !== href) themeLink.setAttribute('href', href);

    if (document.body) {
      const classes = (document.body.className || '').split(/\s+/).filter(Boolean);
      const nextClasses = classes.filter((className) => !AVAILABLE_THEMES.has(className));
      nextClasses.push(normalized);
      document.body.className = nextClasses.join(' ');
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        const classes = (document.body.className || '').split(/\s+/).filter(Boolean);
        const nextClasses = classes.filter((className) => !AVAILABLE_THEMES.has(className));
        nextClasses.push(normalized);
        document.body.className = nextClasses.join(' ');
      }, { once: true });
    }
    return normalized;
  }

  function themeFromLocation() {
    const params = new URLSearchParams(window.location.search);
    return normalizeTheme(params.get('theme'));
  }

  window.SecondaryWindowTheme = {
    applyTheme,
    normalizeTheme,
    themeFromLocation,
  };

  const applyInitialTheme = () => applyTheme(themeFromLocation());
  if (document.documentElement) applyInitialTheme();
  else document.addEventListener('DOMContentLoaded', applyInitialTheme, { once: true });
}());
