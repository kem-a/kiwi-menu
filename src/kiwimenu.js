/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * kiwimenu.js - Implements the main Kiwi Menu functionality.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { ForceQuitService } from './forceQuitService.js';
import { RecentItemsSubmenu } from './recentItemsSubmenu.js';
import { createCustomMenuItem, runCustomMenuCommand } from './customMenuItem.js';

Gio._promisify(Gio.File.prototype, 'load_bytes_async');
Gio._promisify(Gio.File.prototype, 'load_contents_async');

// Maps action tokens from menulayout.json to SystemActions methods.
const SYSTEM_ACTIONS = new Map([
  ['lock-screen', 'activateLockScreen'],
  ['suspend', 'activateSuspend'],
  ['restart', 'activateRestart'],
  ['power-off', 'activatePowerOff'],
]);

// SystemActions.activateLogout() throws when GNOME hides its own Log Out entry
// (single local user, single session type). Kiwi Menu always shows it, so call
// the session manager directly. Mode 0 keeps the usual confirmation dialog.
function activateLogout() {
  Main.overview.hide();
  Gio.DBus.session.call(
    'org.gnome.SessionManager',
    '/org/gnome/SessionManager',
    'org.gnome.SessionManager',
    'Logout',
    new GLib.Variant('(u)', [0]),
    null,
    Gio.DBusCallFlags.NONE,
    -1,
    null,
    null
  );
}

async function loadJsonFileAsync(basePath, segments, cancellable) {
  const filePath = GLib.build_filenamev([basePath, ...segments]);

  try {
    const file = Gio.File.new_for_path(filePath);
    const [bytes] = await file.load_bytes_async(cancellable);
    const parsed = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
      return [];
    }
    logError(error, `Failed to load JSON data from ${filePath}`);
    return [];
  }
}

export const KiwiMenu = GObject.registerClass(
  { GTypeName: 'KiwiMenuButton' },
  class KiwiMenu extends PanelMenu.Button {
    _init(settings, extensionPath, extension) {
      super._init(0.5, 'KiwiMenu');

  this._settings = settings;
  this._extensionPath = extensionPath;
  this._extension = extension;
  this._settingsSignalIds = [];
  this._menuOpenSignalId = 0;
  this._recentMenuManager = new PopupMenu.PopupMenuManager(this);
  this._cancellable = new Gio.Cancellable();
  this._isDestroyed = false;
  this._forceQuitService = new ForceQuitService();
  this._systemActions = SystemActions.getDefault();
  this._mediaKeysSettings = this._createMediaKeysSettings();

      this._icons = [];
      this._layout = [];

      this._loadDataAsync().catch(logError);

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
          this._renderPopupMenu().catch(logError)
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-enabled', () =>
          this._renderPopupMenu().catch(logError)
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-label', () =>
          this._renderPopupMenu().catch(logError)
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-command', () =>
          this._renderPopupMenu().catch(logError)
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-icon', () =>
          this._renderPopupMenu().catch(logError)
        )
      );
      this._settingsSignalIds.push(
        this._settings.connect('changed::custom-menu-shortcut', () =>
          this._renderPopupMenu().catch(logError)
        )
      );

      this._menuOpenSignalId = this.menu.connect(
        'open-state-changed',
        (_, isOpen) => {
          if (isOpen) {
            this._renderPopupMenu().catch(logError);
          }
        }
      );

      Main.wm.addKeybinding(
        'force-quit-shortcut',
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => this._openForceQuitWindow()
      );

      Main.wm.addKeybinding(
        'custom-menu-shortcut',
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => runCustomMenuCommand(this._settings)
      );
    }

    async _loadDataAsync() {
      try {
        const [icons, layout] = await Promise.all([
          loadJsonFileAsync(this._extensionPath, ['src', 'icons.json'], this._cancellable),
          loadJsonFileAsync(this._extensionPath, ['src', 'menulayout.json'], this._cancellable),
        ]);

        if (this._isDestroyed || !this._settings) return;

        this._icons = icons;
        this._layout = layout;

        this._setIcon();
        this._syncActivitiesVisibility();
        await this._renderPopupMenu();
      } catch (error) {
        if (this._isDestroyed) return;
        logError(error, 'Failed to load initial Kiwi Menu data');
      }
    }

    destroy() {
      this._isDestroyed = true;

      if (this._cancellable) {
        this._cancellable.cancel();
        this._cancellable = null;
      }

      this._settingsSignalIds.forEach((id) => this._settings.disconnect(id));
      this._settingsSignalIds = [];

      Main.wm.removeKeybinding('force-quit-shortcut');
      Main.wm.removeKeybinding('custom-menu-shortcut');

      if (this._menuOpenSignalId !== 0) {
        this.menu.disconnect(this._menuOpenSignalId);
        this._menuOpenSignalId = 0;
      }

      this._showActivitiesButton();

      if (this._forceQuitService) {
        this._forceQuitService.destroy();
        this._forceQuitService = null;
      }

      this._systemActions = null;
      this._mediaKeysSettings = null;
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
      if (this._isDestroyed) return;

      let customMenuAdded = false;

      layout.forEach((item) => {
        switch (item.type) {
          case 'menu':
            this._makeMenu(item.title, item.cmds, item.icon, item.accel);
            
            // Add custom menu item right after App Store entry
            if (!customMenuAdded && item.commandSettingKey === 'app-store-command') {
              const customItem = createCustomMenuItem(this._settings, this._gettext.bind(this));
              if (customItem) {
                const bindings = this._settings.get_strv('custom-menu-shortcut');
                if (bindings.length > 0) {
                  this._attachAccelLabel(customItem, this._shortcutToLabel(bindings[0]));
                }
                this.menu.addMenuItem(customItem);
              }
              customMenuAdded = true;
            }
            break;
          case 'recent-items':
            this._makeRecentItemsMenu(item.title, item.icon);
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
      if (this._isDestroyed) return [];

      const items = [];

      for (const item of layoutSource) {
        let translatedTitle = item.title ? this._gettext(item.title) : item.title;
        let cmds = item.cmds ? [...item.cmds] : undefined;

        if (item.type === 'menu' && item.commandSettingKey) {
          cmds = this._resolveCommandFromSettings(item.commandSettingKey, cmds);
        }

        let title = translatedTitle;
        if (item.type === 'menu' && cmds?.includes('logout')) {
          title = fullName
            ? this._gettext('Log Out %s...').format(fullName)
            : translatedTitle;
        }

        const outputItem = {
          ...item,
          title,
          cmds,
        };

        if (item.type === 'menu' && cmds?.includes('force-quit')) {
          const bindings = this._settings.get_strv('force-quit-shortcut');
          outputItem.accel = bindings.length > 0
            ? this._shortcutToLabel(bindings[0])
            : undefined;
        } else if (item.type === 'menu' && item.accelKey) {
          outputItem.accel = this._resolveSystemAccel(item.accelKey);
        }

        if (outputItem.requiresMultipleUsers && !hasMultipleUsers) {
          continue;
        }

        items.push(outputItem);
      }

      return items;
    }

    async _hasMultipleLoginUsers() {
      try {
        const file = Gio.File.new_for_path('/etc/passwd');
        const [contents] = await file.load_contents_async(this._cancellable);
        if (this._isDestroyed || !contents) {
          return false;
        }

        const data = new TextDecoder().decode(contents);

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
              return true;
            }
          }
        }

        return false;
      } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
          return false;
        }
        logError(error, 'Failed to determine available login users');
        return false;
      }
    }

    _makeMenu(title, cmds, iconName, accel) {
      const menuItem = iconName
        ? new PopupMenu.PopupImageMenuItem(title, iconName)
        : new PopupMenu.PopupMenuItem(title);
      const singleCmd = Array.isArray(cmds) && cmds.length === 1 ? cmds[0] : null;
      const isForceQuit = singleCmd === 'force-quit';
      const isAboutThisPc = singleCmd === 'about-this-pc';
      const isLogout = singleCmd === 'logout';
      const systemAction = SYSTEM_ACTIONS.get(singleCmd);

      menuItem.connect('activate', () => {
        if (isForceQuit) {
          this.menu.close(true);
          this._openForceQuitWindow();
          return;
        }

        if (isAboutThisPc) {
          this.menu.close(true);
          this._openAboutWindow();
          return;
        }

        if (isLogout) {
          this.menu.close(true);
          activateLogout();
          return;
        }

        if (systemAction) {
          this.menu.close(true);
          this._systemActions[systemAction]();
          return;
        }

        Util.spawn(cmds);
      });

      this._attachAccelLabel(menuItem, accel);

      this.menu.addMenuItem(menuItem);
    }

    _attachAccelLabel(menuItem, accel) {
      if (!accel) {
        return;
      }

      menuItem.label.x_expand = true;
      const accelLabel = new St.Label({
        text: this._styleAccel(accel),
        style_class: 'kiwi-accel-label',
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
        opacity: 140,
      });
      menuItem.add_child(accelLabel);
    }

    _createMediaKeysSettings() {
      try {
        return new Gio.Settings({
          schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
        });
      } catch (error) {
        logError(error, 'Failed to access system media-keys settings');
        return null;
      }
    }

    // Reads the current system shortcut for a media-key so labels track user rebinds.
    _resolveSystemAccel(mediaKey) {
      if (!this._mediaKeysSettings) {
        return undefined;
      }

      let bindings;
      try {
        bindings = this._mediaKeysSettings.get_strv(mediaKey);
      } catch (error) {
        logError(error, `Failed to read system shortcut '${mediaKey}'`);
        return undefined;
      }

      const binding = bindings.find((value) => value && value.trim().length > 0);
      return binding ? this._shortcutToLabel(binding) : undefined;
    }

    _shortcutToLabel(accel) {
      return accel
        .replace(/<Super>/g, 'Super+')
        .replace(/<(Primary|Control|Ctrl)>/g, 'Ctrl+')
        .replace(/<Alt>/g, 'Alt+')
        .replace(/<Shift>/g, 'Shift+')
        .replace(/Escape/g, 'Esc')
        .replace(/Delete/g, 'Del')
        .replace(/Return/g, 'Enter');
    }

    _styleAccel(accel) {
      const upper = accel.replace(/\b[a-z]\b/g, (c) => c.toUpperCase());
      if (!this._settings.get_boolean('macos-accelerators')) {
        return upper;
      }
      return upper
        .replace(/Super/g, '⌘')
        .replace(/Shift/g, '⇧')
        .replace(/Ctrl/g, '⌃')
        .replace(/Alt/g, '⌥')
        .replace(/Esc/g, '⎋')
        .replace(/\+/g, ' ');
    }

    _makeRecentItemsMenu(title, iconName) {
      const submenuItem = new RecentItemsSubmenu(title, this.menu, this._recentMenuManager, this._extension, iconName);
      this.menu.addMenuItem(submenuItem);
    }

    _makeSeparator() {
      const separator = new PopupMenu.PopupSeparatorMenuItem();
      this.menu.addMenuItem(separator);
    }

    _openForceQuitWindow() {
      const script = GLib.build_filenamev([this._extensionPath, 'app', 'forceQuitWindow.js']);
      try {
        Util.spawn(['gjs', '-m', script]);
      } catch (error) {
        logError(error, 'Failed to launch Force Quit window');
      }
    }

    _openAboutWindow() {
      const script = GLib.build_filenamev([this._extensionPath, 'app', 'aboutWindow.js']);
      try {
        Util.spawn(['gjs', '-m', script]);
      } catch (error) {
        logError(error, 'Failed to launch About This PC window');
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

      const trimmed = commandString.trim();
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
