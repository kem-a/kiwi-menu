/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * kiwimenu.js - Implements the main Kiwi Menu functionality.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { openForceQuitOverlay } from './forceQuitOverlay.js';
import { RecentItemsSubmenu } from './recentItemsSubmenu.js';
import { createCustomMenuItem } from './customMenuItem.js';

function loadJsonFile(basePath, segments) {
  const textDecoder = new TextDecoder();
  const filePath = GLib.build_filenamev([basePath, ...segments]);

  try {
    const file = Gio.File.new_for_path(filePath);
    const [, contents] = file.load_contents(null);
    const parsed = JSON.parse(textDecoder.decode(contents));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logError(error, `Failed to load JSON data from ${filePath}`);
    return [];
  }
}

export const KiwiMenu = GObject.registerClass(
  class KiwiMenu extends PanelMenu.Button {
    _init(settings, extensionPath, extension) {
      super._init(0.5, 'KiwiMenu');

  this._settings = settings;
  this._extensionPath = extensionPath;
  this._extension = extension;
  this._settingsSignalIds = [];
  this._menuOpenSignalId = 0;
  this._recentMenuManager = new PopupMenu.PopupMenuManager(this);

      this._icons = Object.freeze(
        loadJsonFile(this._extensionPath, ['src', 'icons.json']).map((icon) =>
          Object.freeze(icon)
        )
      );
      this._layout = Object.freeze(
        loadJsonFile(this._extensionPath, ['src', 'menulayout.json']).map((item) =>
          Object.freeze(item)
        )
      );

      if (this.menu?.actor) {
        this.menu.actor.add_style_class_name('kiwi-main-menu');
        if (typeof this.menu.setSourceAlignment === 'function') {
          this.menu.setSourceAlignment(0.5);
        }
      }

      this._icon = new St.Icon({
        style_class: 'menu-button',
      });
      this.add_child(this._icon);

      this._settingsSignalIds.push(
        this._settings.connect('changed::icon', () => this._setIcon())
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::activity-menu-visibility', () =>
          this._syncActivitiesVisibility()
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::app-store-command', () =>
          this._renderPopupMenu()
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-enabled', () =>
          this._renderPopupMenu()
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-label', () =>
          this._renderPopupMenu()
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-command', () =>
          this._renderPopupMenu()
        )
      );

      // Listen for menu item visibility changes
      const hideSettingKeys = [
        'hide-about',
        'hide-settings',
        'hide-app-store',
        'hide-recent-items',
        'hide-force-quit',
        'hide-sleep',
        'hide-restart',
        'hide-shutdown',
        'hide-lock-screen',
        'hide-logout',
      ];
      hideSettingKeys.forEach((key) => {
        this._settingsSignalIds.push(
          this._settings.connect(`changed::${key}`, () =>
            this._renderPopupMenu()
          )
        );
      });

      this._menuOpenSignalId = this.menu.connect(
        'open-state-changed',
        (_, isOpen) => {
          if (isOpen) {
            this._renderPopupMenu();
          }
        }
      );

      this._setIcon();
      this._syncActivitiesVisibility();
      this._renderPopupMenu();
    }

    destroy() {
      this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
      this._settingsSignalIds = [];

      if (this._menuOpenSignalId !== 0) {
        this.menu.disconnect(this._menuOpenSignalId);
        this._menuOpenSignalId = 0;
      }

      this._showActivitiesButton();

      this._settings = null;

      super.destroy();
    }

    _setIcon() {
      if (!this._icons || this._icons.length === 0) {
        return;
      }

      const iconIndex = this._settings.get_int('icon');
      const iconInfo = this._icons[iconIndex] ?? this._icons[0];
      if (!iconInfo) {
        return;
      }
      const iconPath = `${this._extensionPath}${iconInfo.path}`;

      this._icon.gicon = Gio.icon_new_for_string(iconPath);
    }

    _syncActivitiesVisibility() {
      const container = this._getActivitiesContainer();
      if (!container) {
        return;
      }

      const shouldShow = this._settings.get_boolean('activity-menu-visibility');
      if (shouldShow) {
        container.show();
      } else {
        container.hide();
      }
    }

    _gettext(text) {
      return this._extension?.gettext(text) ?? text;
    }

    _showActivitiesButton() {
      const container = this._getActivitiesContainer();
      if (container) {
        container.show();
      }
    }

    _getActivitiesContainer() {
      const statusArea = Main.panel?.statusArea;
      if (!statusArea) {
        return null;
      }

      const activitiesEntry =
        statusArea.activities ??
        statusArea.activitiesButton ??
        statusArea['activities'];

      if (!activitiesEntry) {
        return null;
      }

      return activitiesEntry.container ?? activitiesEntry;
    }

    async _renderPopupMenu() {
      this.menu.removeAll();

      const layout = await this._generateLayout();
      let customMenuAdded = false;

      layout.forEach((item) => {
        switch (item.type) {
          case 'menu':
            this._makeMenu(item.title, item.cmds);
            
            // Add custom menu item right after App Store entry
            if (!customMenuAdded && item.commandSettingKey === 'app-store-command') {
              const customItem = createCustomMenuItem(this._settings, this._gettext.bind(this));
              if (customItem) {
                this.menu.addMenuItem(customItem);
              }
              customMenuAdded = true;
            }
            break;
          case 'recent-items':
            this._makeRecentItemsMenu(item.title);
            break;
          case 'separator':
            this._makeSeparator();
            break;
        }
      });
    }

    async _generateLayout() {
      const fullName = GLib.get_real_name() || GLib.get_user_name() || '';

      const layoutSource = this._layout ?? [];
      const hasMultipleUsers = await this._hasMultipleLoginUsers();
      const items = [];

      for (const item of layoutSource) {
        let translatedTitle = item.title ? this._gettext(item.title) : item.title;
        let cmds = item.cmds ? [...item.cmds] : undefined;

        if (item.type === 'menu' && item.commandSettingKey) {
          cmds = this._resolveCommandFromSettings(item.commandSettingKey, cmds);
        }

        let title = translatedTitle;
        if (item.type === 'menu' && cmds?.includes('--logout')) {
          title = fullName
            ? this._gettext('Log Out %s...').format(fullName)
            : translatedTitle;
        }

        const outputItem = {
          ...item,
          title,
          cmds,
        };

        if (outputItem.requiresMultipleUsers && !hasMultipleUsers) {
          continue;
        }

        // Check if item should be hidden based on hideSettingKey
        if (outputItem.hideSettingKey) {
          try {
            const isHidden = this._settings.get_boolean(outputItem.hideSettingKey);
            if (isHidden) {
              continue;
            }
          } catch (error) {
            // If setting doesn't exist, show the item
          }
        }

        items.push(outputItem);
      }

      return items;
    }

    async _hasMultipleLoginUsers() {
      try {
        const file = Gio.File.new_for_path('/etc/passwd');
        
        return await new Promise((resolve, reject) => {
          file.load_contents_async(null, (source, result) => {
            try {
              const [success, contents] = source.load_contents_finish(result);
              if (!success || !contents) {
                resolve(false);
                return;
              }
              
              const decoder = new TextDecoder();
              const data = decoder.decode(contents);

              let count = 0;
              for (const line of data.split('\n')) {
                if (!line || line.startsWith('#')) {
                  continue;
                }

                const parts = line.split(':');
                if (parts.length < 7) {
                  continue;
                }

                const uid = Number.parseInt(parts[2], 10);
                const shell = parts[6]?.trim();

                if (!Number.isInteger(uid)) {
                  continue;
                }

                if (
                  uid >= 1000 &&
                  shell &&
                  shell !== '/usr/sbin/nologin' &&
                  shell !== '/usr/bin/nologin' &&
                  shell !== '/bin/false'
                ) {
                  count += 1;
                  if (count > 1) {
                    resolve(true);
                    return;
                  }
                }
              }

              resolve(false);
            } catch (error) {
              reject(error);
            }
          });
        });
      } catch (error) {
        logError(error, 'Failed to determine available login users');
        return false;
      }
    }

    _makeMenu(title, cmds) {
      const menuItem = new PopupMenu.PopupMenuItem(title);
      const isForceQuit = Array.isArray(cmds) && cmds.length === 1 && cmds[0] === 'xkill';

      menuItem.connect('activate', () => {
        if (isForceQuit) {
          this.menu.close(true);
          this._openForceQuitOverlay();
          return;
        }

        Util.spawn(cmds);
      });
      this.menu.addMenuItem(menuItem);
    }

    _makeRecentItemsMenu(title) {
      const submenuItem = new RecentItemsSubmenu(title, this.menu, this._recentMenuManager, this._extension);
      this.menu.addMenuItem(submenuItem);
    }

    _makeSeparator() {
      const separator = new PopupMenu.PopupSeparatorMenuItem();
      this.menu.addMenuItem(separator);
    }

    _openForceQuitOverlay() {
      try {
        openForceQuitOverlay();
      } catch (error) {
        logError(error, 'Failed to open Force Quit overlay');
      }
    }

    _resolveCommandFromSettings(settingKey, fallback = []) {
      if (!this._settings) {
        return fallback;
      }

      let commandString;
      try {
        commandString = this._settings.get_string(settingKey);
      } catch (error) {
        logError(error, `Failed to read command setting '${settingKey}'`);
        return fallback;
      }

      const trimmed = commandString?.trim?.() ?? '';
      if (trimmed.length === 0) {
        return fallback;
      }

      try {
        const [success, argv] = GLib.shell_parse_argv(trimmed);
        if (success && Array.isArray(argv) && argv.length > 0) {
          return argv;
        }
      } catch (error) {
        logError(error, `Failed to parse command '${trimmed}' for setting '${settingKey}'`);
      }

      return fallback;
    }
  }
);
