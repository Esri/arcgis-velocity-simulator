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

document.addEventListener('DOMContentLoaded', () => {
  const closeButton = document.getElementById('close-button');
  const versionElement = document.getElementById('about-version');

  // Set the app version dynamically
  window.api.getAppVersion().then(version => {
    versionElement.textContent = `Version ${version}`;
  });

  // Close the dialog when the close button is clicked
  closeButton.addEventListener('click', () => {
    window.close();
  });

  const applyTheme = (theme) => {
    if (window.SecondaryWindowTheme) {
      window.SecondaryWindowTheme.applyTheme(theme);
    } else {
      document.documentElement.dataset.theme = theme || 'dark';
    }
  };

  if (window.api && window.api.onLoadSavedTheme) {
    window.api.onLoadSavedTheme((theme) => applyTheme(theme));
  }

  // Listen for the theme from the main process, apply it, and notify main
  window.api.onSetTheme((_event, theme) => {
    applyTheme(theme);
    // Notify the main process that the theme has been applied
    window.api.themeApplied();
  });
});
