/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * userSwitcher.js - Implements a macOS-style user switcher button for Kiwi Menu.
 */

import AccountsService from 'gi://AccountsService';
import Clutter from 'gi://Clutter';
import Gdm from 'gi://Gdm';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import { Avatar as UserAvatar } from 'resource:///org/gnome/shell/ui/userWidget.js';

Gio._promisify(Gio.DBusProxy, 'new', 'new_finish');
Gio._promisify(Gio.DBusProxy.prototype, 'call');

const DEFAULT_BUTTON_ICON = 'system-users-symbolic';
const AVATAR_ICON_SIZE = 64;
const MINIMUM_VISIBLE_UID = 1000;

// Newer Shell versions replaced St.BoxLayout's vertical property with orientation.
function boxLayoutOrientation(orientation) {
  return 'orientation' in St.BoxLayout.prototype
    ? { orientation }
    : { vertical: orientation === Clutter.Orientation.VERTICAL };
}

/**
 * Count real user accounts (UID >= 1000, non-system accounts).
 */
function countRealUsers(userManager) {
  if (!userManager || !userManager.is_loaded) {
    return 0;
  }

  const userList = userManager.list_users() ?? [];
  let realUserCount = 0;

  for (const user of userList) {
    if (!user || !user.is_loaded) {
      continue;
    }

    const uid = Number.parseInt(user.get_uid(), 10);
    if (!Number.isFinite(uid)) {
      continue;
    }

    const username = user.get_user_name();
    if (!username) {
      continue;
    }

    // Count real users (non-system accounts with UID >= 1000)
    if (uid >= MINIMUM_VISIBLE_UID && !user.system_account) {
      realUserCount++;
    }
  }

  return realUserCount;
}

/**
 * Controller that manages the UserSwitcherButton visibility dynamically.
 * Adds/removes the button from the panel based on the number of real users.
 */
export class UserSwitcherController {
  constructor(extension) {
    this._extension = extension;
    this._userSwitcher = null;
    this._userManager = null;
    this._userManagerSignals = [];

    this._initUserManager();
  }

  destroy() {
    this._disconnectUserManagerSignals();

    if (this._userSwitcher) {
      this._userSwitcher.destroy();
      this._userSwitcher = null;
    }

    this._userManager = null;
    this._extension = null;
  }

  _initUserManager() {
    this._userManager = AccountsService.UserManager.get_default();

    if (!this._userManager) {
      return;
    }

    this._userManagerSignals = [
      this._userManager.connect('notify::is-loaded', () => this._updateVisibility()),
      this._userManager.connect('user-added', () => this._updateVisibility()),
      this._userManager.connect('user-removed', () => this._updateVisibility()),
    ];

    // Initial visibility check
    if (this._userManager.is_loaded) {
      this._updateVisibility();
    } else {
      this._userManager.list_users();
    }
  }

  _disconnectUserManagerSignals() {
    if (!this._userManager || !this._userManagerSignals) {
      return;
    }

    this._userManagerSignals.filter((id) => id > 0).forEach((id) => this._userManager.disconnect(id));
    this._userManagerSignals = [];
  }

  _updateVisibility() {
    const realUserCount = countRealUsers(this._userManager);
    const shouldShow = realUserCount > 1;

    if (shouldShow && !this._userSwitcher) {
      // Add button to panel
      this._userSwitcher = new UserSwitcherButton(this._extension);
      Main.panel.addToStatusArea('KiwiUserSwitcher', this._userSwitcher, 1, 'right');
    } else if (!shouldShow && this._userSwitcher) {
      // Remove button from panel
      this._userSwitcher.destroy();
      this._userSwitcher = null;
    }
  }
}

export const UserSwitcherButton = GObject.registerClass(
  { GTypeName: 'KiwiMenuUserSwitcherButton' },
  class UserSwitcherButton extends PanelMenu.Button {
    _init(extension) {
      super._init(1.0, 'KiwiUserSwitcher');

      this._extension = extension;
      this._menuSignals = [];
      this._userManager = null;
      this._loginManagerProxy = null;
      this._loginManagerProxyPromise = null;
      this._cancellable = new Gio.Cancellable();
      this._isDestroyed = false;
      this._gettext = extension?.gettext?.bind(extension) ?? ((text) => text);
      this._buttonIcon = new St.Icon({
        icon_name: DEFAULT_BUTTON_ICON,
        icon_size: 18,
        style_class: 'kiwi-user-switcher-button',
      });
      this.add_child(this._buttonIcon);

      if (this.menu?.actor) {
        this.menu.actor.add_style_class_name('kiwi-user-switcher-menu');
        this.menu.actor.set_x_align(Clutter.ActorAlign.END);
        this.menu.actor.set_x_expand(false);
        if (typeof this.menu.setSourceAlignment === 'function') {
          this.menu.setSourceAlignment(1);
        }
      }

      this._menuOpenSignalId = this.menu?.connect('open-state-changed', (_, open) => {
        if (open) {
          this._rebuildMenu().catch(logError);
        }
      }) ?? 0;

      this._initUserManager();
    }

    destroy() {
      this._isDestroyed = true;

      if (this._cancellable) {
        this._cancellable.cancel();
        this._cancellable = null;
      }

      this._disconnectUserManagerSignals();

      if (this._menuOpenSignalId) {
        this.menu.disconnect(this._menuOpenSignalId);
        this._menuOpenSignalId = 0;
      }

      this._loginManagerProxy = null;
      this._loginManagerProxyPromise = null;
      this._userManager = null;
      this._extension = null;

      super.destroy();
    }

    _initUserManager() {
      this._userManager = AccountsService.UserManager.get_default();

      if (!this._userManager) {
        return;
      }

      const rebuild = () => this._rebuildMenu().catch(logError);
      this._menuSignals = [
        this._userManager.connect('notify::is-loaded', rebuild),
        this._userManager.connect('user-added', rebuild),
        this._userManager.connect('user-removed', rebuild),
        this._userManager.connect('user-changed', rebuild),
        this._userManager.connect('user-is-logged-in-changed', rebuild),
      ];

      if (this._userManager.is_loaded) {
        rebuild();
      } else {
        this._userManager.list_users();
      }
    }

    _disconnectUserManagerSignals() {
      if (!this._userManager || !this._menuSignals) {
        return;
      }

      this._menuSignals.filter((id) => id > 0).forEach((id) => this._userManager.disconnect(id));
      this._menuSignals = [];
    }

    async _rebuildMenu() {
      if (!this._userManager || !this.menu) {
        return;
      }

      if (!this._userManager.is_loaded) {
        return;
      }

      this.menu.removeAll();

      const currentUserName = GLib.get_user_name();
      const users = this._collectVisibleUsers(currentUserName);
      const sessionInfo = await this._getSessionInfo();
      if (this._isDestroyed || !this.menu) {
        return;
      }

      if (users.length === 0) {
        const placeholder = new PopupMenu.PopupMenuItem(this._gettext('No eligible user accounts found'));
        placeholder.setSensitive(false);
        placeholder.actor.add_style_class_name('kiwi-user-switcher-empty');
        this.menu.addMenuItem(placeholder);
      } else {
        const gridSection = new PopupMenu.PopupMenuSection();
        
        const gridContainer = new St.BoxLayout({
          ...boxLayoutOrientation(Clutter.Orientation.VERTICAL),
          style_class: 'kiwi-user-grid',
          x_expand: true,
        });

        let currentRow = null;
        users.forEach((user, index) => {
          if (index % 3 === 0) {
            currentRow = new St.BoxLayout({
              ...boxLayoutOrientation(Clutter.Orientation.HORIZONTAL),
              x_expand: true,
            });
            gridContainer.add_child(currentRow);
          }

          const userWidget = this._createUserWidget(user, currentUserName, sessionInfo);
          userWidget.set_x_expand(true);
          currentRow.add_child(userWidget);
        });

        gridSection.actor.add_child(gridContainer);
        this.menu.addMenuItem(gridSection);
      }

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._addActionItem(this._gettext('Login Window...'), () => this._gotoLoginWindow());
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._addActionItem(
        this._gettext('Users & Groups Settings...'),
        () => this._openUserSettings()
      );

      this._updatePanelIcon(users, currentUserName);
    }

    _ensureLoginManagerProxy() {
      if (this._loginManagerProxy) {
        return Promise.resolve(this._loginManagerProxy);
      }

      if (this._loginManagerProxyPromise) {
        return this._loginManagerProxyPromise;
      }

      this._loginManagerProxyPromise = (async () => {
        try {
          const proxy = await Gio.DBusProxy.new(
            Gio.DBus.system,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.freedesktop.login1',
            '/org/freedesktop/login1',
            'org.freedesktop.login1.Manager',
            this._cancellable
          );
          if (this._isDestroyed) {
            return null;
          }
          this._loginManagerProxy = proxy;
          return proxy;
        } catch (error) {
          if (!(error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))) {
            logError(error, 'Failed to acquire login1 Manager proxy');
          }
          this._loginManagerProxy = null;
          return null;
        } finally {
          this._loginManagerProxyPromise = null;
        }
      })();

      return this._loginManagerProxyPromise;
    }

    async _getSessionProperty(sessionPath, propertyName) {
      if (typeof sessionPath !== 'string' || !sessionPath.startsWith('/org/freedesktop/login1/session/')) {
        return null;
      }

      try {
        const sessionProxy = await Gio.DBusProxy.new(
          Gio.DBus.system,
          Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
          null,
          'org.freedesktop.login1',
          sessionPath,
          'org.freedesktop.login1.Session',
          this._cancellable
        );
        if (this._isDestroyed || !sessionProxy) {
          return null;
        }

        const variant = sessionProxy.get_cached_property(propertyName);
        return variant?.deepUnpack() ?? null;
      } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
          return null;
        }
        logError(error, `Failed to read session ${propertyName} for ${sessionPath}`);
        return null;
      }
    }

    /**
     * Get session information via org.freedesktop.login1 D-Bus API.
     * Returns an object with:
     * - loggedInUsers: Set of usernames with active sessions
     * - sessions: Map of username -> {sessionId, seat, sessionClass} for graphical sessions
     */
    async _getSessionInfo() {
      const loggedInUsers = new Set();
      const sessions = new Map();

      const loginManagerProxy = await this._ensureLoginManagerProxy();
      if (!loginManagerProxy || this._isDestroyed) {
        return { loggedInUsers, sessions };
      }

      try {
        const result = await loginManagerProxy.call(
          'ListSessions',
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          this._cancellable
        );
        if (this._isDestroyed) {
          return { loggedInUsers, sessions };
        }

        const rawList = result?.deepUnpack() ?? [];
        const sessionList = (rawList.length === 1 && Array.isArray(rawList[0]) && Array.isArray(rawList[0][0]))
          ? rawList[0]
          : rawList;

        for (const [sessionId, , userName, seat, sessionPath] of sessionList) {
          if (!userName) {
            continue;
          }

          loggedInUsers.add(userName);

          const sessionPathStr = Array.isArray(sessionPath) ? sessionPath[0] : sessionPath;
          if (typeof sessionPathStr !== 'string' || !sessionPathStr.startsWith('/org/freedesktop/login1/session/')) {
            continue;
          }

          const sessionClass = await this._getSessionProperty(sessionPathStr, 'Class');
          if (this._isDestroyed) {
            return { loggedInUsers, sessions };
          }
          if (sessionClass !== 'user') {
            continue;
          }

          const isActive = await this._getSessionProperty(sessionPathStr, 'Active');
          if (this._isDestroyed) {
            return { loggedInUsers, sessions };
          }
          const existing = sessions.get(userName);

          // Prefer active session; otherwise keep the first user-class session
          if (!existing || (isActive === true && existing.isActive !== true)) {
            sessions.set(userName, { sessionId, seat, sessionClass, isActive: Boolean(isActive) });
          }
        }
      } catch (error) {
        if (!(error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))) {
          logError(error, 'Failed to get session info from login1 D-Bus');
        }
      }

      return { loggedInUsers, sessions };
    }

    _collectVisibleUsers(currentUserName) {
      const userList = this._userManager.list_users() ?? [];

      const filtered = userList.filter((user) => {
        if (!user || !user.is_loaded) {
          return false;
        }

        const uid = Number.parseInt(user.get_uid(), 10);
        if (!Number.isFinite(uid)) {
          return false;
        }

        const username = user.get_user_name();
        if (!username) {
          return false;
        }

        if (username === currentUserName) {
          return true;
        }

        return uid >= MINIMUM_VISIBLE_UID && !user.system_account;
      });

      return filtered.sort((a, b) => this._compareUsers(a, b, currentUserName));
    }

    _compareUsers(a, b, currentUserName) {
      const aIsCurrent = a.get_user_name() === currentUserName;
      const bIsCurrent = b.get_user_name() === currentUserName;

      if (aIsCurrent && !bIsCurrent) {
        return -1;
      }

      if (!aIsCurrent && bIsCurrent) {
        return 1;
      }

      const aName = a.get_real_name() || a.get_user_name() || '';
      const bName = b.get_real_name() || b.get_user_name() || '';
      return GLib.utf8_collate(aName, bName);
    }

    _createUserWidget(user, currentUserName, sessionInfo) {
      const displayName = user.get_real_name() || user.get_user_name() || '';
      const username = user.get_user_name() || '';
      const isCurrent = username === currentUserName;
      const isSignedIn = sessionInfo.loggedInUsers.has(username);

      const button = new St.Button({
        style_class: 'kiwi-user-item',
        reactive: true,
        can_focus: true,
        x_expand: true,
        y_expand: true,
      });
      button.set_x_align(Clutter.ActorAlign.FILL);

      if (isCurrent) {
        button.add_style_class_name('current-user');
      }

      const content = new St.BoxLayout({
        ...boxLayoutOrientation(Clutter.Orientation.VERTICAL),
        style_class: 'kiwi-user-item-content',
        x_align: Clutter.ActorAlign.CENTER,
      });

      // Container for avatar + badge overlay using Clutter.BinLayout for stacking
      const avatarContainer = new St.Widget({
        style_class: 'kiwi-user-avatar-container',
        layout_manager: new Clutter.BinLayout(),
        x_expand: false,
        y_expand: false,
      });

      const avatarBin = new St.Bin({
        style_class: 'kiwi-user-card-avatar-frame',
        x_expand: true,
        y_expand: true,
      });
      avatarBin.clip_to_allocation = true;

      if (isCurrent) {
        avatarBin.add_style_class_name('current-user');
      } else if (isSignedIn) {
        avatarBin.add_style_class_name('logged-in');
      }

      const avatar = new UserAvatar(user, {
        styleClass: 'kiwi-user-card-avatar',
        iconSize: AVATAR_ICON_SIZE,
        reactive: false,
      });
      avatar.update();
      avatarBin.set_child(avatar);
      avatarContainer.add_child(avatarBin);

      // Add session badge for logged-in users
      if (isCurrent || isSignedIn) {
        const sessionBadge = new St.Icon({
          style_class: isCurrent
            ? 'kiwi-user-session-badge current-user'
            : 'kiwi-user-session-badge',
          icon_name: 'object-select-symbolic',
          icon_size: 14,
          x_expand: true,
          y_expand: true,
          x_align: Clutter.ActorAlign.END,
          y_align: Clutter.ActorAlign.END,
        });
        avatarContainer.add_child(sessionBadge);
      }

      content.add_child(avatarContainer);

      const nameLabel = new St.Label({
        text: displayName,
        style_class: 'kiwi-user-card-name',
        x_align: Clutter.ActorAlign.CENTER,
      });

      content.add_child(nameLabel);
      button.set_child(content);

      button.connect('clicked', () => this._activateUser(user).catch(logError));

      return button;
    }

    _addActionItem(label, callback) {
      const item = new PopupMenu.PopupMenuItem(label);
      item.connect('activate', () => {
        this.menu.close(true);
        callback();
      });
      this.menu.addMenuItem(item);
    }

    async _activateUser(user) {
      if (!user) {
        return;
      }

      this.menu.close(true);

      const username = user.get_user_name();
      if (!username) {
        return;
      }

      // If clicking on current user, just close the menu - nothing to switch to
      const currentUserName = GLib.get_user_name();
      if (username === currentUserName) {
        return;
      }

      // Try to find and activate user's session
      // Don't rely on is_logged_in_anywhere() as it can be stale
      const activated = await this._activateUserSession(username);
      if (this._isDestroyed) {
        return;
      }

      if (!activated) {
        // No session found, go to GDM login screen
        this._gotoLoginWindow();
      }
    }

    async _activateUserSession(username) {
      const { sessions } = await this._getSessionInfo();
      if (this._isDestroyed) {
        return false;
      }

      const sessionData = sessions.get(username);
      if (!sessionData) {
        return false;
      }

      const loginManagerProxy = await this._ensureLoginManagerProxy();
      if (!loginManagerProxy || this._isDestroyed) {
        return false;
      }

      try {
        await loginManagerProxy.call(
          'ActivateSession',
          new GLib.Variant('(s)', [sessionData.sessionId]),
          Gio.DBusCallFlags.NONE,
          -1,
          this._cancellable
        );
        return true;
      } catch (error) {
        if (error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
          return false;
        }
        logError(error, 'Failed to activate user session via login1 D-Bus');
        return false;
      }
    }

    _gotoLoginWindow() {
      // Lock the screen first if screen shield is available
      if (Main.screenShield) {
        Main.screenShield.lock(false);
      }

      // Defer the GDM handoff to the next paint so the lock settles first.
      // The callback must be self-contained and must NOT be tracked/removed on
      // destroy(): Main.screenShield.lock() switches the shell to the
      // 'unlock-dialog' session mode, which disables this extension before the
      // callback fires. As a global stage callback with no reference to this
      // (soon-destroyed) object, it still runs and reaches the login screen.
      Clutter.threads_add_repaint_func(Clutter.RepaintFlags.POST_PAINT, () => {
        try {
          Gdm.goto_login_session_sync(null);
        } catch (error) {
          logError(error, 'Failed to switch to GDM login session');
        }
        return false;
      });
    }

    _openUserSettings() {
      Util.spawn(['gnome-control-center', 'system', 'users']);
    }

    _updatePanelIcon(users, currentUserName) {
      this._buttonIcon.gicon = null;
      this._buttonIcon.icon_name = DEFAULT_BUTTON_ICON;
    }
  }
);
