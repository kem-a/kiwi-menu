/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * configLoader.js - Loads and applies distribution config file.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/**
 * Loads config.json from the extension directory and applies settings
 * if the config version differs from the previously applied version.
 *
 * @param {Gio.Settings} settings - The extension settings object
 * @param {string} extensionPath - Path to the extension directory
 */
export function applyConfig(settings, extensionPath) {
  if (!settings || !extensionPath) {
    return;
  }

  const config = loadConfig(extensionPath);
  if (!config) {
    return;
  }

  const configVersion = config._version ?? '';
  const appliedVersion = settings.get_string('config-version');

  // Only apply config if version differs
  if (configVersion === appliedVersion) {
    return;
  }

  applySettings(settings, config);

  // Store the applied version
  if (configVersion) {
    settings.set_string('config-version', configVersion);
  }
}

/**
 * Loads and parses the config.json file.
 *
 * @param {string} extensionPath - Path to the extension directory
 * @returns {Object|null} Parsed config object or null if loading fails
 */
function loadConfig(extensionPath) {
  const textDecoder = new TextDecoder();
  const filePath = GLib.build_filenamev([extensionPath, 'config.json']);

  try {
    const file = Gio.File.new_for_path(filePath);
    if (!file.query_exists(null)) {
      return null;
    }

    const [, contents] = file.load_contents(null);
    return JSON.parse(textDecoder.decode(contents));
  } catch (error) {
    logError(error, `Failed to load config from ${filePath}`);
    return null;
  }
}

/**
 * Builds the settings map with all supported settings.
 * This includes settings from all feature branches for compatibility.
 *
 * @returns {Object} Map of setting keys to their types (i=int, b=boolean, s=string)
 */
function buildSettingsMap() {
  const settingsMap = {
    // Integer settings
    'icon': 'i',
    'custom-menu-count': 'i',

    // Boolean settings - Panel
    'activity-menu-visibility': 'b',

    // Boolean settings - GNOME Quick Settings
    'hide-lock-button': 'b',
    'hide-power-button': 'b',
    'hide-settings-button': 'b',

    // Boolean settings - Menu item visibility
    'hide-about': 'b',
    'hide-settings': 'b',
    'hide-app-store': 'b',
    'hide-recent-items': 'b',
    'hide-force-quit': 'b',
    'hide-sleep': 'b',
    'hide-restart': 'b',
    'hide-shutdown': 'b',
    'hide-lock-screen': 'b',
    'hide-logout': 'b',

    // String settings
    'app-store-command': 's',
  };

  // Add custom menu items 1-10
  for (let i = 1; i <= 10; i++) {
    settingsMap[`custom-menu-${i}-enabled`] = 'b';
    settingsMap[`custom-menu-${i}-label`] = 's';
    settingsMap[`custom-menu-${i}-command`] = 's';
  }

  return settingsMap;
}

/**
 * Applies config values to GSettings.
 *
 * @param {Gio.Settings} settings - The extension settings object
 * @param {Object} config - The config object to apply
 */
function applySettings(settings, config) {
  const settingsMap = buildSettingsMap();

  for (const [key, type] of Object.entries(settingsMap)) {
    if (!(key in config)) {
      continue;
    }

    try {
      const value = config[key];
      switch (type) {
        case 'i':
          if (typeof value === 'number' && Number.isInteger(value)) {
            settings.set_int(key, value);
          }
          break;
        case 'b':
          if (typeof value === 'boolean') {
            settings.set_boolean(key, value);
          }
          break;
        case 's':
          if (typeof value === 'string') {
            settings.set_string(key, value);
          }
          break;
      }
    } catch (error) {
      // Setting may not exist if corresponding feature branch isn't merged
      // This is expected and safe to ignore
    }
  }
}
