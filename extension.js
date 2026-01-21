/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * extension.js - Entry point for the Kiwi Menu GNOME Shell extension.
 */

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { KiwiMenu } from './src/kiwimenu.js';
import { QuickSettingsActionsController } from './src/hideQSbuttons.js';
import { UserSwitcherController } from './src/userSwitcher.js';
import { applyConfig } from './src/configLoader.js';

export default class KiwiMenuExtension extends Extension {
  enable() {
    this._settings = this.getSettings();

    // Apply distribution config on first run (or when config version changes)
    applyConfig(this._settings, this.path);

    this._indicator = new KiwiMenu(this._settings, this.path, this);
    Main.panel.addToStatusArea('KiwiMenuButton', this._indicator, 0, 'left');

    // User switcher controller dynamically shows/hides based on user count
    this._userSwitcherController = new UserSwitcherController(this);

    this._quickSettingsController = new QuickSettingsActionsController(this._settings);
  }

  disable() {
    if (this._userSwitcherController) {
      this._userSwitcherController.destroy();
      this._userSwitcherController = null;
    }

    if (this._quickSettingsController) {
      this._quickSettingsController.destroy();
      this._quickSettingsController = null;
    }

    if (this._indicator) {
      this._indicator.destroy();
      this._indicator = null;
    }

    this._settings = null;
  }
}
