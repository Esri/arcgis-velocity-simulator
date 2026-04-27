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

  // Listen for the theme from the main process, apply it, and notify main
  window.api.onSetTheme((_event, theme) => {
    if (theme) {
      document.body.className = theme;
    } else {
      // Default to dark theme if none is provided
      document.body.className = 'dark';
    }
    // Notify the main process that the theme has been applied
    window.api.themeApplied();
  });
});
