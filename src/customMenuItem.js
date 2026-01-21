/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * customMenuItem.js - Handles custom menu item functionality.
 */

import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

/**
 * Creates a custom menu item if enabled in settings.
 *
 * @param {Gio.Settings} settings - The extension settings object
 * @param {Function} gettextFunc - Translation function
 * @param {number} index - The custom menu item index (1-10)
 * @returns {PopupMenu.PopupMenuItem|null} The custom menu item or null if disabled
 */
export function createCustomMenuItem(settings, gettextFunc, index = 1) {
    if (!settings) {
        return null;
    }

    const enabledKey = `custom-menu-${index}-enabled`;
    const labelKey = `custom-menu-${index}-label`;
    const commandKey = `custom-menu-${index}-command`;

    const enabled = settings.get_boolean(enabledKey);
    if (!enabled) {
        return null;
    }

    const label = settings.get_string(labelKey);
    const command = settings.get_string(commandKey);

    // Don't create menu item if label or command is empty
    const trimmedLabel = label?.trim?.() ?? '';
    const trimmedCommand = command?.trim?.() ?? '';

    if (trimmedLabel.length === 0 || trimmedCommand.length === 0) {
        return null;
    }

    const menuItem = new PopupMenu.PopupMenuItem(trimmedLabel);

    menuItem.connect('activate', () => {
        try {
            // If command looks like a simple path without shell quoting, quote it
            // to handle paths with spaces correctly
            let commandToExecute = trimmedCommand;
            const needsQuoting = !trimmedCommand.startsWith('"') &&
                                 !trimmedCommand.startsWith("'") &&
                                 trimmedCommand.includes(' ') &&
                                 !trimmedCommand.includes('" ') &&
                                 !trimmedCommand.includes("' ");
            if (needsQuoting) {
                commandToExecute = GLib.shell_quote(trimmedCommand);
            }

            const [success, argv] = GLib.shell_parse_argv(commandToExecute);
            if (success && Array.isArray(argv) && argv.length > 0) {
                Util.spawn(argv);
            } else {
                logError(new Error(`Failed to parse command: ${trimmedCommand}`));
            }
        } catch (error) {
            logError(error, `Failed to execute custom menu command: ${trimmedCommand}`);
        }
    });

    return menuItem;
}
