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
 * @file config.js
 * @description This module manages the application's configuration system.
 * It handles loading, saving, importing, and exporting configuration data including window state,
 * theme preferences, and other user settings. The configuration is stored as JSON in the user's data directory.
 */

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

/**
 * @const {object} defaultConfig
 * @description The default configuration for the application.
 * This is used as a fallback and as a template for new configurations.
 * Contains window dimensions, positions, splitter positions for both views, and theme settings.
 */
const defaultConfig = {
  windowState: {
    fullView: {
      width: 1365,
      height: 395,
      x: 195,
      y: 168,
      splitterPosition: '285px'
    },
    compactView: {
      width: 249,
      height: 285,
      x: 380,
      y: 205,
      splitterPosition: '198.5px'
    },
    currentView: 'full' // 'full' or 'compact'
  },
  theme: 'dark', // Dark theme is the default and fallback
  opacity: 1.0,
  font: {
    size: '13px',
    family: 'monospace'
  },
  statusAreaVisible: true,
  menuBarVisible: false,
  cameraSupport: false, // Camera support is disabled by default
  microphoneSupport: false, // Microphone support is disabled by default
  dialogSizes: {
    appConfig: { width: 660, height: 400, x: null, y: null },
    launchConfig: { width: 500, height: 400, x: null, y: null },
  }
};

/**
 * Manages the application's configuration, handling loading from and saving to a JSON file.
 * Provides methods for configuration import/export and safe merging with defaults.
 */
class ConfigManager {
  /**
   * Initializes the ConfigManager, setting up paths for the configuration file.
   * Creates the necessary directory structure in the user's data folder.
   */
  constructor() {
    this.configDir = app.getPath('userData'); // Get user's data directory
    this.configPath = path.join(this.configDir, 'config.json'); // Full path to configuration file
    this.theConfig = defaultConfig; // Store reference to default config
  }

  /**
   * Loads the configuration from `config.json`.
   * If the file doesn't exist, it creates one with default settings.
   * If the file is corrupt or empty, it falls back to the default configuration.
   * @returns {object} The loaded or default configuration object.
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        
        // Handle empty or whitespace-only configuration files to prevent JSON parse errors
        if (!configData || configData.trim() === '') {
          console.log('Configuration file is empty. Creating with default settings.');
          this.saveConfig(defaultConfig);
          return { ...defaultConfig };
        }
        
        const config = JSON.parse(configData);
        // Merge with defaults to handle missing properties in older configuration files
        const mergedConfig = this.mergeWithDefaults(config);
        console.log('Configuration initialized from:', this.configPath);
        return mergedConfig;
      } else {
        // Configuration file doesn't exist, so create it with defaults
        console.log('Configuration file not found. Creating default configuration at:', this.configPath);
        this.saveConfig(defaultConfig);
        return { ...defaultConfig };
      }
    } catch (error) {
      console.error('Error loading or creating config, falling back to defaults:', error);
      // In case of parsing or other errors, still return defaults but don't overwrite a potentially broken file.
      return { ...defaultConfig };
    }
  }

  /**
   * Saves the given configuration object to `config.json`.
   * Creates the config directory if it doesn't exist.
   * @param {object} config - The configuration object to save.
   * @returns {boolean} True if the save was successful, false otherwise.
   */
  saveConfig(config) {
    try {
      // Ensure config directory exists
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }

      // Convert config to formatted JSON string
      const configData = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.configPath, configData, 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  /**
   * Deeply merges a given configuration with the default configuration.
   * This ensures that new properties from updates are included in older configs.
   * Prevents errors when new config properties are added in application updates.
   * @param {object} loadedConfig - The configuration loaded from the file.
   * @returns {object} The merged configuration.
   */
  mergeWithDefaults(loadedConfig) {
    const merged = { ...this.theConfig };
    
    // Merge window state configuration
    if (loadedConfig.windowState) {
      merged.windowState = {
        ...merged.windowState,
        ...loadedConfig.windowState
      };
      
      // Merge full view settings
      if (loadedConfig.windowState.fullView) {
        merged.windowState.fullView = {
          ...merged.windowState.fullView,
          ...loadedConfig.windowState.fullView
        };
      }
      
      // Merge compact view settings
      if (loadedConfig.windowState.compactView) {
        merged.windowState.compactView = {
          ...merged.windowState.compactView,
          ...loadedConfig.windowState.compactView
        };
      }
    }
    
    // Merge theme setting
    if (loadedConfig.theme) {
      merged.theme = loadedConfig.theme;
    }

    if (loadedConfig.statusAreaVisible !== undefined) {
      merged.statusAreaVisible = loadedConfig.statusAreaVisible;
    }

    if (loadedConfig.menuBarVisible !== undefined) {
      merged.menuBarVisible = loadedConfig.menuBarVisible;
    }

    if (loadedConfig.cameraSupport !== undefined) {
      merged.cameraSupport = loadedConfig.cameraSupport;
    }

    if (loadedConfig.microphoneSupport !== undefined) {
      merged.microphoneSupport = loadedConfig.microphoneSupport;
    }

    if (loadedConfig.dialogSizes) {
      merged.dialogSizes = {
        ...merged.dialogSizes,
        ...loadedConfig.dialogSizes,
        appConfig: { ...merged.dialogSizes.appConfig, ...(loadedConfig.dialogSizes.appConfig || {}) },
        launchConfig: { ...merged.dialogSizes.launchConfig, ...(loadedConfig.dialogSizes.launchConfig || {}) },
      };
    }

    if (loadedConfig.font) {
      merged.font = { ...merged.font, ...loadedConfig.font };
    }

    // Merge window opacity setting
    if (loadedConfig.opacity !== undefined) {
      merged.opacity = loadedConfig.opacity;
    }

    // For backward compatibility, check for old properties and move them
    if (loadedConfig.statusLogFontSize) {
      merged.font.size = loadedConfig.statusLogFontSize;
    }
    if (loadedConfig.statusLogFontFamily) {
      merged.font.family = loadedConfig.statusLogFontFamily;
    }

    return merged;
  }

  /**
   * Retrieves the path to the configuration file.
   * @returns {string} The path to the configuration file.
   */
  getConfigPath() {
    return this.configPath;
  }

  /**
   * Retrieves the directory path where the configuration file is stored.
   * @returns {string} The directory path.
   */
  getConfigDir() {
    return this.configDir;
  }

  /**
   * Exports the current configuration to a user-selected JSON file.
   * Useful for backing up settings or sharing configurations between installations.
   * @param {string} filePath - The path to save the exported file to.
   * @param {object} [config=null] - The current application configuration to export. If not provided, the current config will be loaded.
   * @returns {object} An object containing a success flag and any error message.
   */
  exportConfig(filePath, config = null) {
    try {
      const configToExport = config || this.loadConfig();
      const configData = JSON.stringify(configToExport, null, 2);
      fs.writeFileSync(filePath, configData, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('Error exporting config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Imports a configuration from a user-selected JSON file.
   * Validates and merges the imported config with defaults before saving.
   * @param {string} filePath - The path to the file to import.
   * @returns {object} An object containing a success flag, any error message, and the imported configuration.
   */
  importConfig(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist' };
      }

      const configData = fs.readFileSync(filePath, 'utf8');
      const importedConfig = JSON.parse(configData);
      
      // Merge with defaults to ensure all required properties exist
      const mergedConfig = this.mergeWithDefaults(importedConfig);
      
      // Save the imported config as the current config
      const saveResult = this.saveConfig(mergedConfig);
      if (!saveResult) {
        return { success: false, error: 'Failed to save imported config' };
      }

      return { success: true, config: mergedConfig };
    } catch (error) {
      console.error('Error importing config:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Reads a configuration from a specified JSON file without saving it as the current configuration.
   * Useful for previewing or validating configuration files before importing.
   * @param {string} filePath - The path to the configuration file to read.
   * @returns {object} An object containing a success flag, the configuration data, or an error message.
   */
  readConfigFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { success: false, error: 'File does not exist' };
      }

      const configData = fs.readFileSync(filePath, 'utf8');
      const config = JSON.parse(configData);
      
      return { success: true, config };
    } catch (error) {
      console.error('Error reading configuration file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Writes configuration to a custom JSON file without changing the current config.
   * Useful for creating config templates or saving specific configurations.
   * @param {string} filePath - The path where to write the configuration file.
   * @param {object} config - The configuration object to write.
   * @returns {object} An object containing a success flag and any error message.
   */
  writeConfigFile(filePath, config) {
    try {
      const configData = JSON.stringify(config, null, 2);
      fs.writeFileSync(filePath, configData, 'utf8');
      return { success: true };
    } catch (error) {
      console.error('Error writing configuration file:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Resets the configuration to default values.
   * Always uses the defaultConfig from this module and saves it to the config file.
   * @returns {object} An object containing a success flag and the default configuration, or an error message.
   */
  resetConfig() {
    try {
      // Always use the defaultConfig from this module
      const resetConfig = { ...defaultConfig };
      
      // Save the default configuration to the config file
      const saveResult = this.saveConfig(resetConfig);
      if (!saveResult) {
        return { success: false, error: 'Failed to save reset config to file' };
      }

      // Update the current config in memory
      this.config = resetConfig;
      
      return { success: true, config: resetConfig };
    } catch (error) {
      console.error('Error resetting config:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export the ConfigManager class and default configuration for use in other modules
module.exports = { ConfigManager, defaultConfig };