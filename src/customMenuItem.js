/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * customMenuItem.js - Handles custom menu item functionality.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

/**
 * Creates a custom menu item if enabled in settings.
 * 
 * @param {Gio.Settings} settings - The extension settings object
 * @param {Function} gettextFunc - Translation function
 * @param {boolean} showIcon - Whether the item renders its configured icon
 * @returns {PopupMenu.PopupMenuItem|null} The custom menu item or null if disabled
 */
export function createCustomMenuItem(settings, gettextFunc, showIcon) {
    if (!settings) {
        return null;
    }

    const enabled = settings.get_boolean('custom-menu-enabled');
    if (!enabled) {
        return null;
    }

    const label = settings.get_string('custom-menu-label');
    const command = settings.get_string('custom-menu-command');
    const iconPath = settings.get_string('custom-menu-icon');

    // Don't create menu item if label or command is empty
    const trimmedLabel = label.trim();
    const trimmedCommand = command.trim();
    const trimmedIconPath = iconPath.trim();

    if (trimmedLabel.length === 0 || trimmedCommand.length === 0) {
        return null;
    }

    // Use an image menu item when a valid icon file is configured and the
    // 'menu-icons' preference gives this entry an icon.
    const iconFile = trimmedIconPath.length > 0
        ? Gio.File.new_for_path(trimmedIconPath)
        : null;

    const menuItem = showIcon && iconFile?.query_exists(null)
        ? new PopupMenu.PopupImageMenuItem(trimmedLabel, new Gio.FileIcon({ file: iconFile }))
        : new PopupMenu.PopupMenuItem(trimmedLabel);

    menuItem.connect('activate', () => runCustomMenuCommand(settings));

    return menuItem;
}

/**
 * Runs the configured custom menu command, if enabled and set.
 *
 * @param {Gio.Settings} settings - The extension settings object
 */
export function runCustomMenuCommand(settings) {
    if (!settings || !settings.get_boolean('custom-menu-enabled')) {
        return;
    }

    const command = settings.get_string('custom-menu-command').trim();
    if (command.length === 0) {
        return;
    }

    try {
        // Run command through user's interactive shell to respect their $PATH
        // -i sources .bashrc/.zshrc where PATH is typically modified
        const shell = GLib.getenv('SHELL') || '/bin/bash';
        Util.spawn([shell, '-i', '-c', command]);
    } catch (error) {
        logError(error, `Failed to execute custom menu command: ${command}`);
    }
}
