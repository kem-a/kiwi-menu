/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * menuIcons.js - Decides which menu entries show an icon.
 *
 * Deliberately free of GNOME Shell and GSettings imports so the mapping can be
 * exercised outside a shell session.
 */

// Values of the 'menu-icons' GSettings key.
export const MENU_ICONS_ALL = 'all';
export const MENU_ICONS_TOP_THREE = 'top-three';
export const MENU_ICONS_NONE = 'none';

// Entries that keep their icon in 'top-three' mode: About This PC and System
// Settings. The App Store entry is configurable, so it is matched by the
// setting that holds its command instead of by the command itself.
const TOP_THREE_COMMANDS = new Set(['about-this-pc', 'gnome-control-center']);
const APP_STORE_SETTING_KEY = 'app-store-command';

/**
 * Maps a stored 'menu-icons' value to a known mode.
 *
 * @param {string} value - Raw setting value
 * @returns {string} One of MENU_ICONS_ALL, MENU_ICONS_TOP_THREE or MENU_ICONS_NONE
 */
export function normalizeMenuIconsMode(value) {
    switch (value) {
        case MENU_ICONS_TOP_THREE:
        case MENU_ICONS_NONE:
            return value;
        default:
            // Unknown values keep the classic behaviour: every entry has an icon.
            return MENU_ICONS_ALL;
    }
}

/**
 * Whether a layout entry is one of the three that keep their icon.
 *
 * @param {object} item - Entry from src/menulayout.json
 * @returns {boolean} True for About This PC, System Settings and App Store
 */
export function isTopThreeEntry(item) {
    if (!item) {
        return false;
    }

    if (item.commandSettingKey === APP_STORE_SETTING_KEY) {
        return true;
    }

    return Array.isArray(item.cmds) && item.cmds.some((cmd) => TOP_THREE_COMMANDS.has(cmd));
}

/**
 * Whether an entry from the menu layout should render its icon.
 *
 * @param {object} item - Entry from src/menulayout.json
 * @param {string} mode - Value of the 'menu-icons' setting
 * @returns {boolean} True when the entry shows an icon
 */
export function shouldShowEntryIcon(item, mode) {
    if (!item || !item.icon) {
        return false;
    }

    switch (normalizeMenuIconsMode(mode)) {
        case MENU_ICONS_NONE:
            return false;
        case MENU_ICONS_TOP_THREE:
            return isTopThreeEntry(item);
        default:
            return true;
    }
}

/**
 * Whether the user's custom menu entry should render its icon. It sits below
 * the top three, so only the 'all' mode gives it one.
 *
 * @param {string} mode - Value of the 'menu-icons' setting
 * @returns {boolean} True when the custom entry shows its icon
 */
export function shouldShowCustomEntryIcon(mode) {
    return normalizeMenuIconsMode(mode) === MENU_ICONS_ALL;
}
