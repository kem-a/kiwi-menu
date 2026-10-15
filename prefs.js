/*
 * SPDX-License-Identifier: GPL-3.0-or-later
 * prefs.js - Implements the preferences UI for the Kiwi Menu extension.
 */

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
  MENU_ICONS_ALL,
  MENU_ICONS_NONE,
  MENU_ICONS_TOP_THREE,
  normalizeMenuIconsMode,
} from './src/menuIcons.js';

function loadIconsMetadata(sourcePath) {
  const textDecoder = new TextDecoder();
  const filePath = GLib.build_filenamev([
    sourcePath,
    'src',
    'icons.json',
  ]);

  try {
    const file = Gio.File.new_for_path(filePath);
    const [, contents] = file.load_contents(null);
    const data = JSON.parse(textDecoder.decode(contents));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    logError(error, `Failed to load icons metadata from ${filePath}`);
    return [];
  }
}

const OptionsPage = GObject.registerClass(
  { GTypeName: 'KiwiMenuOptionsPage' },
  class OptionsPage extends Adw.PreferencesPage {
    constructor(settings, sourcePath, gettextFunc) {
      super({
        title: gettextFunc('Options'),
        icon_name: 'preferences-other-symbolic',
        name: 'OptionsPage',
      });

      this._settings = settings;
      this._ = gettextFunc;

      const icons = loadIconsMetadata(sourcePath);

      const menuGroup = new Adw.PreferencesGroup({
        title: this._('Menu'),
        description: this._('Adjust how the Kiwi Menu looks and behaves.'),
      });

      const iconsList = new Gtk.StringList();
      icons.forEach((icon) => iconsList.append(icon.title));

      const iconSelectorRow = new Adw.ComboRow({
        title: this._('Menu Icon'),
        subtitle: this._('Choose the icon to display in the panel.'),
        model: iconsList,
        selected: this._settings.get_int('icon'),
      });

      

      menuGroup.add(iconSelectorRow);

      const defaultAppStoreCommand = 'gnome-software';
      const appStoreCommandRow = new Adw.EntryRow({
        title: this._('App Store Command'),
      });
      appStoreCommandRow.set_text(this._settings.get_string('app-store-command'));

      const restoreButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        has_frame: false,
        tooltip_text: this._('Restore Default'),
        valign: Gtk.Align.CENTER,
      });
      restoreButton.add_css_class('circular');

      const acceptButton = new Gtk.Button({
        icon_name: 'object-select-symbolic',
        has_frame: false,
        tooltip_text: this._('Apply Changes'),
        valign: Gtk.Align.CENTER,
      });
      acceptButton.add_css_class('circular');
      acceptButton.set_visible(false);
      acceptButton.set_sensitive(false);

      appStoreCommandRow.add_suffix(acceptButton);
      appStoreCommandRow.add_suffix(restoreButton);

      const clearEntryFocus = () => {
        const root = appStoreCommandRow.get_root();
        if (root && typeof root.set_focus === 'function') {
          root.set_focus(null);
        }
      };

      const updateRestoreButtonState = () => {
        const currentText = appStoreCommandRow.get_text
          ? appStoreCommandRow.get_text()
          : appStoreCommandRow.text ?? '';
        const isDefault = currentText.trim() === defaultAppStoreCommand;
        restoreButton.set_sensitive(!isDefault);
        restoreButton.set_visible(!isDefault);
        acceptButton.set_sensitive(!isDefault);
      };

      restoreButton.connect('clicked', () => {
        appStoreCommandRow.set_text(defaultAppStoreCommand);
        clearEntryFocus();
      });

      acceptButton.connect('clicked', () => {
        clearEntryFocus();
      });

      appStoreCommandRow.connect('notify::text', updateRestoreButtonState);
      updateRestoreButtonState();

      const keyController = new Gtk.EventControllerKey();
      keyController.connect('key-pressed', (controller, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
          clearEntryFocus();
          return true;
        }
        return false;
      });
      appStoreCommandRow.add_controller(keyController);

      const focusController = new Gtk.EventControllerFocus();
      focusController.connect('enter', () => {
        acceptButton.set_visible(true);
      });
      focusController.connect('leave', () => {
        acceptButton.set_visible(false);
      });
      appStoreCommandRow.add_controller(focusController);

      menuGroup.add(appStoreCommandRow);

      // Force Quit keyboard shortcut
      const defaultForceQuitShortcut = '<Alt><Super>Escape';
      const forceQuitShortcutRow = new Adw.ActionRow({
        title: this._('Force Quit Shortcut'),
        subtitle: this._('Keyboard shortcut that opens the Force Quit window.'),
        activatable: true,
      });

      const forceQuitShortcutLabel = new Gtk.Label({
        valign: Gtk.Align.CENTER,
      });
      forceQuitShortcutLabel.add_css_class('dim-label');
      forceQuitShortcutRow.add_suffix(forceQuitShortcutLabel);

      const forceQuitRestoreButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        has_frame: false,
        tooltip_text: this._('Restore Default'),
        valign: Gtk.Align.CENTER,
      });
      forceQuitRestoreButton.add_css_class('circular');
      forceQuitRestoreButton.set_visible(false);
      forceQuitShortcutRow.add_suffix(forceQuitRestoreButton);

      const forceQuitClearButton = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        has_frame: false,
        tooltip_text: this._('Clear Shortcut'),
        valign: Gtk.Align.CENTER,
      });
      forceQuitClearButton.add_css_class('circular');
      forceQuitClearButton.set_visible(false);
      forceQuitShortcutRow.add_suffix(forceQuitClearButton);

      const updateForceQuitShortcut = () => {
        const bindings = this._settings.get_strv('force-quit-shortcut');
        const accel = bindings.length > 0 ? bindings[0] : '';
        const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
        forceQuitShortcutLabel.set_label(
          accel && ok ? Gtk.accelerator_get_label(keyval, mods) : this._('Disabled')
        );

        forceQuitClearButton.set_visible(!!accel && ok);

        const [defOk, defKey, defMods] = Gtk.accelerator_parse(defaultForceQuitShortcut);
        const isDefault = ok && defOk && keyval === defKey && mods === defMods;
        forceQuitRestoreButton.set_visible(!isDefault);
        forceQuitRestoreButton.set_sensitive(!isDefault);
      };
      updateForceQuitShortcut();
      this._settings.connect('changed::force-quit-shortcut', updateForceQuitShortcut);

      forceQuitClearButton.connect('clicked', () => {
        this._settings.set_strv('force-quit-shortcut', []);
      });

      forceQuitRestoreButton.connect('clicked', () => {
        this._settings.set_strv('force-quit-shortcut', [defaultForceQuitShortcut]);
      });

      forceQuitShortcutRow.connect('activated', () => {
        this._captureShortcut('force-quit-shortcut', forceQuitShortcutRow);
      });

      menuGroup.add(forceQuitShortcutRow);

      // macOS style accelerator symbols
      const macosAccelSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        active: this._settings.get_boolean('macos-accelerators'),
      });
      const macosAccelRow = new Adw.ActionRow({
        title: this._('macOS Style Shortcuts'),
        subtitle: this._('Show accelerator hints using macOS symbols (⌘ ⌥ ^ ⎋).'),
        activatable_widget: macosAccelSwitch,
      });
      macosAccelRow.add_suffix(macosAccelSwitch);
      menuGroup.add(macosAccelRow);

      this._settings.bind(
        'macos-accelerators',
        macosAccelSwitch,
        'active',
        Gio.SettingsBindFlags.DEFAULT
      );

      // Menu item icons
      const menuIconsModes = [MENU_ICONS_ALL, MENU_ICONS_TOP_THREE, MENU_ICONS_NONE];
      const menuIconsList = new Gtk.StringList();
      [
        this._('All entries'),
        this._('Top three only'),
        this._('None'),
      ].forEach((label) => menuIconsList.append(label));

      const menuIconsRow = new Adw.ComboRow({
        title: this._('Menu Item Icons'),
        subtitle: this._('Show icons on every entry, on the top three (About This PC, System Settings, App Store) only, or on none.'),
        model: menuIconsList,
        selected: menuIconsModes.indexOf(normalizeMenuIconsMode(this._settings.get_string('menu-icons'))),
      });
      menuGroup.add(menuIconsRow);

      menuIconsRow.connect('notify::selected', () => {
        const mode = menuIconsModes[menuIconsRow.get_selected()];
        if (mode) {
          this._settings.set_string('menu-icons', mode);
        }
      });

      this._settings.connect('changed::menu-icons', () => {
        const index = menuIconsModes.indexOf(normalizeMenuIconsMode(this._settings.get_string('menu-icons')));
        if (index >= 0 && index !== menuIconsRow.get_selected()) {
          menuIconsRow.set_selected(index);
        }
      });

      // Custom menu item section - using ExpanderRow
      const customMenuExpanderRow = new Adw.ExpanderRow({
        title: this._('Custom Menu Item'),
        subtitle: this._('Add a custom menu entry with your own label and command.'),
        show_enable_switch: true,
        enable_expansion: this._settings.get_boolean('custom-menu-enabled'),
      });

      // Custom menu label entry
      const defaultMenuLabel = '';
      const customMenuLabelRow = new Adw.EntryRow({
        title: this._('Menu Label'),
      });
      customMenuLabelRow.set_text(this._settings.get_string('custom-menu-label'));

      const labelRestoreButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        has_frame: false,
        tooltip_text: this._('Restore Default'),
        valign: Gtk.Align.CENTER,
      });
      labelRestoreButton.add_css_class('circular');

      const labelAcceptButton = new Gtk.Button({
        icon_name: 'object-select-symbolic',
        has_frame: false,
        tooltip_text: this._('Apply Changes'),
        valign: Gtk.Align.CENTER,
      });
      labelAcceptButton.add_css_class('circular');
      labelAcceptButton.set_visible(false);
      labelAcceptButton.set_sensitive(false);

      customMenuLabelRow.add_suffix(labelAcceptButton);
      customMenuLabelRow.add_suffix(labelRestoreButton);

      const clearLabelFocus = () => {
        const root = customMenuLabelRow.get_root();
        if (root && typeof root.set_focus === 'function') {
          root.set_focus(null);
        }
      };

      const updateLabelRestoreButtonState = () => {
        const currentText = customMenuLabelRow.get_text
          ? customMenuLabelRow.get_text()
          : customMenuLabelRow.text ?? '';
        const isDefault = currentText.trim() === defaultMenuLabel;
        labelRestoreButton.set_sensitive(!isDefault);
        labelRestoreButton.set_visible(!isDefault);
        labelAcceptButton.set_sensitive(!isDefault);
      };

      labelRestoreButton.connect('clicked', () => {
        customMenuLabelRow.set_text(defaultMenuLabel);
        clearLabelFocus();
      });

      labelAcceptButton.connect('clicked', () => {
        clearLabelFocus();
      });

      customMenuLabelRow.connect('notify::text', updateLabelRestoreButtonState);
      updateLabelRestoreButtonState();

      const labelKeyController = new Gtk.EventControllerKey();
      labelKeyController.connect('key-pressed', (controller, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
          clearLabelFocus();
          return true;
        }
        return false;
      });
      customMenuLabelRow.add_controller(labelKeyController);

      const labelFocusController = new Gtk.EventControllerFocus();
      labelFocusController.connect('enter', () => {
        labelAcceptButton.set_visible(true);
      });
      labelFocusController.connect('leave', () => {
        labelAcceptButton.set_visible(false);
      });
      customMenuLabelRow.add_controller(labelFocusController);

      customMenuExpanderRow.add_row(customMenuLabelRow);

      // Custom menu command entry
      const defaultMenuCommand = '';
      const customMenuCommandRow = new Adw.EntryRow({
        title: this._('Command'),
      });
      customMenuCommandRow.set_text(this._settings.get_string('custom-menu-command'));

      const commandRestoreButton = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        has_frame: false,
        tooltip_text: this._('Restore Default'),
        valign: Gtk.Align.CENTER,
      });
      commandRestoreButton.add_css_class('circular');

      const commandAcceptButton = new Gtk.Button({
        icon_name: 'object-select-symbolic',
        has_frame: false,
        tooltip_text: this._('Apply Changes'),
        valign: Gtk.Align.CENTER,
      });
      commandAcceptButton.add_css_class('circular');
      commandAcceptButton.set_visible(false);
      commandAcceptButton.set_sensitive(false);

      customMenuCommandRow.add_suffix(commandAcceptButton);
      customMenuCommandRow.add_suffix(commandRestoreButton);

      const clearCommandFocus = () => {
        const root = customMenuCommandRow.get_root();
        if (root && typeof root.set_focus === 'function') {
          root.set_focus(null);
        }
      };

      const updateCommandRestoreButtonState = () => {
        const currentText = customMenuCommandRow.get_text
          ? customMenuCommandRow.get_text()
          : customMenuCommandRow.text ?? '';
        const isDefault = currentText.trim() === defaultMenuCommand;
        commandRestoreButton.set_sensitive(!isDefault);
        commandRestoreButton.set_visible(!isDefault);
        commandAcceptButton.set_sensitive(!isDefault);
      };

      commandRestoreButton.connect('clicked', () => {
        customMenuCommandRow.set_text(defaultMenuCommand);
        clearCommandFocus();
      });

      commandAcceptButton.connect('clicked', () => {
        clearCommandFocus();
      });

      customMenuCommandRow.connect('notify::text', updateCommandRestoreButtonState);
      updateCommandRestoreButtonState();

      const commandKeyController = new Gtk.EventControllerKey();
      commandKeyController.connect('key-pressed', (controller, keyval) => {
        if (keyval === Gdk.KEY_Escape) {
          clearCommandFocus();
          return true;
        }
        return false;
      });
      customMenuCommandRow.add_controller(commandKeyController);

      const commandFocusController = new Gtk.EventControllerFocus();
      commandFocusController.connect('enter', () => {
        commandAcceptButton.set_visible(true);
      });
      commandFocusController.connect('leave', () => {
        commandAcceptButton.set_visible(false);
      });
      customMenuCommandRow.add_controller(commandFocusController);

      customMenuExpanderRow.add_row(customMenuCommandRow);

      // Custom menu keyboard shortcut
      const customShortcutRow = new Adw.ActionRow({
        title: this._('Keyboard Shortcut'),
        subtitle: this._('Shortcut that runs the custom command.'),
        activatable: true,
      });

      const customShortcutLabel = new Gtk.Label({
        valign: Gtk.Align.CENTER,
      });
      customShortcutLabel.add_css_class('dim-label');
      customShortcutRow.add_suffix(customShortcutLabel);

      const customShortcutClearButton = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        has_frame: false,
        tooltip_text: this._('Clear Shortcut'),
        valign: Gtk.Align.CENTER,
      });
      customShortcutClearButton.add_css_class('circular');
      customShortcutClearButton.set_visible(false);
      customShortcutRow.add_suffix(customShortcutClearButton);

      const updateCustomShortcut = () => {
        const bindings = this._settings.get_strv('custom-menu-shortcut');
        const accel = bindings.length > 0 ? bindings[0] : '';
        const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
        customShortcutLabel.set_label(
          accel && ok ? Gtk.accelerator_get_label(keyval, mods) : this._('Disabled')
        );
        customShortcutClearButton.set_visible(!!accel && ok);
      };
      updateCustomShortcut();
      this._settings.connect('changed::custom-menu-shortcut', updateCustomShortcut);

      customShortcutClearButton.connect('clicked', () => {
        this._settings.set_strv('custom-menu-shortcut', []);
      });

      customShortcutRow.connect('activated', () => {
        this._captureShortcut('custom-menu-shortcut', customShortcutRow);
      });

      customMenuExpanderRow.add_row(customShortcutRow);

      // Custom menu icon chooser
      const defaultIconSubtitle = this._('Optional image shown next to the menu label.');
      const customMenuIconRow = new Adw.ActionRow({
        title: this._('Icon'),
        subtitle: defaultIconSubtitle,
      });

      const iconPreview = new Gtk.Image({
        pixel_size: 24,
        valign: Gtk.Align.CENTER,
      });

      const iconChooseButton = new Gtk.Button({
        icon_name: 'document-open-symbolic',
        has_frame: false,
        tooltip_text: this._('Choose Icon File'),
        valign: Gtk.Align.CENTER,
      });
      iconChooseButton.add_css_class('circular');

      const iconClearButton = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        has_frame: false,
        tooltip_text: this._('Remove Icon'),
        valign: Gtk.Align.CENTER,
      });
      iconClearButton.add_css_class('circular');

      customMenuIconRow.add_suffix(iconPreview);
      customMenuIconRow.add_suffix(iconChooseButton);
      customMenuIconRow.add_suffix(iconClearButton);

      const updateIconRow = () => {
        const path = this._settings.get_string('custom-menu-icon')?.trim() ?? '';
        const hasIcon = path.length > 0;

        if (hasIcon) {
          const file = Gio.File.new_for_path(path);
          const exists = file.query_exists(null);
          if (exists) {
            iconPreview.set_from_gicon(new Gio.FileIcon({ file }));
          } else {
            iconPreview.clear();
          }
          iconPreview.set_visible(exists);
          customMenuIconRow.set_subtitle(
            exists ? file.get_basename() : this._('Selected file was not found.')
          );
        } else {
          iconPreview.clear();
          iconPreview.set_visible(false);
          customMenuIconRow.set_subtitle(defaultIconSubtitle);
        }

        iconClearButton.set_visible(hasIcon);
      };

      iconChooseButton.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
          title: this._('Select Custom Menu Icon'),
          modal: true,
        });

        const filter = new Gtk.FileFilter();
        filter.set_name(this._('Images'));
        filter.add_pixbuf_formats();
        filter.add_mime_type('image/svg+xml');

        const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
        filters.append(filter);
        dialog.set_filters(filters);

        const currentPath = this._settings.get_string('custom-menu-icon')?.trim() ?? '';
        if (currentPath.length > 0) {
          const currentFile = Gio.File.new_for_path(currentPath);
          if (currentFile.query_exists(null)) {
            dialog.set_initial_file(currentFile);
          }
        }

        const root = customMenuIconRow.get_root();
        dialog.open(root, null, (source, result) => {
          try {
            const file = source.open_finish(result);
            if (file) {
              this._settings.set_string('custom-menu-icon', file.get_path());
            }
          } catch (error) {
            // User dismissed the dialog; nothing to do.
          }
        });
      });

      iconClearButton.connect('clicked', () => {
        this._settings.set_string('custom-menu-icon', '');
      });

      this._settings.connect('changed::custom-menu-icon', updateIconRow);
      updateIconRow();

      customMenuExpanderRow.add_row(customMenuIconRow);

      menuGroup.add(customMenuExpanderRow);

      // Handle custom menu enable/disable
      customMenuExpanderRow.connect('notify::enable-expansion', (widget) => {
        const isEnabled = widget.get_enable_expansion();
        this._settings.set_boolean('custom-menu-enabled', isEnabled);
      });

      // Bind custom menu settings
      this._settings.bind(
        'custom-menu-label',
        customMenuLabelRow,
        'text',
        Gio.SettingsBindFlags.DEFAULT
      );

      this._settings.bind(
        'custom-menu-command',
        customMenuCommandRow,
        'text',
        Gio.SettingsBindFlags.DEFAULT
      );

      const behaviorGroup = new Adw.PreferencesGroup({
        title: this._('Panel'),
        description: this._('Hide or show the Activities button from the top bar.'),
      });

      const activityMenuSwitch = new Gtk.Switch({
        valign: Gtk.Align.CENTER,
        active: !this._settings.get_boolean('activity-menu-visibility'),
      });

      const activityMenuRow = new Adw.ActionRow({
        title: this._('Hide Activities Menu'),
        subtitle: this._('Display the Activities button in the top panel.'),
        activatable_widget: activityMenuSwitch,
      });
      activityMenuRow.add_suffix(activityMenuSwitch);

      behaviorGroup.add(activityMenuRow);

      this.add(menuGroup);
      this.add(behaviorGroup);

      const quickSettingsGroup = new Adw.PreferencesGroup({
        title: this._('Quick Settings'),
        description: this._('Choose which default quick action buttons stay visible.'),
      });

      const quickActionToggles = [
        {
          key: 'hide-lock-button',
          title: this._('Hide Lock Screen Button'),
          subtitle: this._('Remove the lock screen quick action button.'),
        },
        {
          key: 'hide-power-button',
          title: this._('Hide Power Button'),
          subtitle: this._('Remove the power menu quick action button.'),
        },
        {
          key: 'hide-settings-button',
          title: this._('Hide Settings Button'),
          subtitle: this._('Remove the settings shortcut quick action button.'),
        },
      ];

      quickActionToggles.forEach(({ key, title, subtitle }) => {
        const toggle = new Gtk.Switch({
          valign: Gtk.Align.CENTER,
          active: this._settings.get_boolean(key),
        });

        const row = new Adw.ActionRow({
          title,
          subtitle,
          activatable_widget: toggle,
        });
        row.add_suffix(toggle);

        quickSettingsGroup.add(row);

        toggle.connect('notify::active', (widget) => {
          this._settings.set_boolean(key, widget.get_active());
        });
      });

      this.add(quickSettingsGroup);

      iconSelectorRow.connect('notify::selected', (widget) => {
        this._settings.set_int('icon', widget.selected);
      });

      this._settings.bind(
        'app-store-command',
        appStoreCommandRow,
        'text',
        Gio.SettingsBindFlags.DEFAULT
      );

      activityMenuSwitch.connect('notify::active', (widget) => {
        this._settings.set_boolean('activity-menu-visibility', !widget.get_active());
      });

    }

    _captureShortcut(settingKey, row) {
      const dialog = new Adw.Dialog({
        title: this._('Set Shortcut'),
        content_width: 420,
        content_height: 240,
      });

      const toolbarView = new Adw.ToolbarView();
      toolbarView.add_top_bar(new Adw.HeaderBar());

      const statusPage = new Adw.StatusPage({
        icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        title: this._('Press a Shortcut'),
        description: this._('Esc to cancel · Backspace to disable'),
      });
      statusPage.add_css_class('compact');
      statusPage.add_css_class('kiwimenu-shortcut-status');
      toolbarView.set_content(statusPage);
      dialog.set_child(toolbarView);

      const keyController = new Gtk.EventControllerKey();
      keyController.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
      keyController.connect('key-pressed', (controller, keyval, keycode, state) => {
        let mask = state & Gtk.accelerator_get_default_mod_mask();
        mask &= ~Gdk.ModifierType.LOCK_MASK;

        if (keyval === Gdk.KEY_Escape && mask === 0) {
          dialog.close();
          return Gdk.EVENT_STOP;
        }

        if (keyval === Gdk.KEY_BackSpace && mask === 0) {
          this._settings.set_strv(settingKey, []);
          dialog.close();
          return Gdk.EVENT_STOP;
        }

        if (mask === 0 || !Gtk.accelerator_valid(keyval, mask)) {
          return Gdk.EVENT_STOP;
        }

        const accel = Gtk.accelerator_name_with_keycode(null, keyval, keycode, mask);
        this._settings.set_strv(settingKey, [accel]);
        dialog.close();
        return Gdk.EVENT_STOP;
      });
      dialog.add_controller(keyController);

      dialog.present(row.get_root());
    }
  }
);

export default class KiwiMenuPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window._settings = settings;
    window.title = this.metadata.name ?? 'Kiwi Menu';
    window.set_default_size(510, 710);
    window.set_size_request(360, 500);
    window.set_search_enabled(true);

    // Add custom icons path to GTK icon theme search path
    const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
    const iconsPath = GLib.build_filenamev([this.path, 'src']);
    iconTheme.add_search_path(iconsPath);

    this._ensureVersionCss(window);

    const _ = this.gettext.bind(this);
    const aboutPage = this._createAboutPage(window, _);
    const optionsPage = new OptionsPage(settings, this.path, _);

    window.add(aboutPage);
    window.add(optionsPage);
  }

  _ensureVersionCss(window) {
    if (window._kiwimenuVersionCssProvider)
      return;

    const cssProvider = new Gtk.CssProvider();
    const cssPath = GLib.build_filenamev([this.path, 'prefs.css']);
    cssProvider.load_from_path(cssPath);

    const display = Gdk.Display.get_default();
    if (display)
      Gtk.StyleContext.add_provider_for_display(
        display,
        cssProvider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION
      );

    window._kiwimenuVersionCssProvider = cssProvider;
  }

  _createAboutPage(window, _) {
    const aboutPage = new Adw.PreferencesPage({
      title: _('About'),
      icon_name: 'help-about-symbolic',
      name: 'AboutPage',
    });

    const headerGroup = new Adw.PreferencesGroup();
    const headerBox = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      margin_top: 16,
      margin_bottom: 8,
      margin_start: 16,
      margin_end: 16,
      halign: Gtk.Align.CENTER,
    });

    const iconPath = GLib.build_filenamev([this.path ?? '.', 'src', 'kiwimenu.png']);
    const iconFile = Gio.File.new_for_path(iconPath);
    if (iconFile.query_exists(null)) {
      const logoImage = new Gtk.Picture({
        file: iconFile,
        width_request: 128,
        height_request: 128,
        content_fit: Gtk.ContentFit.CONTAIN,
        halign: Gtk.Align.CENTER,
      });
      headerBox.append(logoImage);
    }

    const extensionName = this.metadata.name ?? 'Kiwi Menu';
    headerBox.append(
      new Gtk.Label({
        label: `<span size="xx-large" weight="bold">${GLib.markup_escape_text(extensionName, -1)}</span>`,
        use_markup: true,
        halign: Gtk.Align.CENTER,
      })
    );

    headerBox.append(
      new Gtk.Label({
        label: 'Arnis Kemlers (kem-a)',
        halign: Gtk.Align.CENTER,
      })
    );

    const rawVersionName = this.metadata['version-name'] ?? null;
    const versionNumber =
      this.metadata.version !== undefined && this.metadata.version !== null
        ? `${this.metadata.version}`
        : null;
    const versionLabel =
      rawVersionName && versionNumber
        ? `${rawVersionName} (${versionNumber})`
        : rawVersionName ?? versionNumber ?? 'Unknown';
    const releaseVersion = rawVersionName ?? versionNumber;

    const versionButton = new Gtk.Button({
      label: versionLabel,
      halign: Gtk.Align.CENTER,
      margin_top: 4,
      tooltip_text: _('Change log'),
    });
    versionButton.add_css_class('pill');
    versionButton.add_css_class('kiwimenu-version-pill');

    const baseUrl = this.metadata.url ?? 'https://github.com/kem-a/kiwimenu-kemma';
    const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
    const releasesBaseUrl = normalizedBaseUrl.endsWith('/releases')
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/releases`;

    versionButton.connect('clicked', () => {
      let targetUrl = releasesBaseUrl;
      if (releaseVersion && releaseVersion !== 'Unknown') {
        const safeVersion = encodeURIComponent(releaseVersion);
        targetUrl = `${releasesBaseUrl}/tag/v${safeVersion}`;
      }

      this._launchUri(window, targetUrl);
    });

    headerBox.append(versionButton);

    headerGroup.add(headerBox);
    aboutPage.add(headerGroup);

    // Content group with two columns: links (left) and QR + sponsor (right)
    // Uses a horizontal Box that flips to vertical via Adw.Breakpoint when narrow.
    const contentGroup = new Adw.PreferencesGroup();
    const contentBox = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 24,
      margin_top: 8,
      margin_bottom: 16,
      margin_start: 16,
      margin_end: 16,
      hexpand: true,
      homogeneous: true,
    });

    // Left column: link groups styled with ActionRows
    const leftColumn = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      hexpand: true,
      halign: Gtk.Align.FILL,
    });

    // Separate cards: Website and Report an Issue
    const websiteCard = new Adw.PreferencesGroup();
    websiteCard.add(this._createLinkRow(window, _('Website'), normalizedBaseUrl));
    leftColumn.append(websiteCard);

    const issueCard = new Adw.PreferencesGroup();
    issueCard.add(this._createLinkRow(window, _('Report an Issue'), `${normalizedBaseUrl}/issues`));
    leftColumn.append(issueCard);

    // Combined Credits & Legal group
    const infoGroup = new Adw.PreferencesGroup();
    infoGroup.add(this._createLinkRow(window, _('Credits'), `${normalizedBaseUrl}/graphs/contributors`));
    infoGroup.add(this._createLegalRow(window, normalizedBaseUrl, _));
    leftColumn.append(infoGroup);

    contentBox.append(leftColumn);

    // Right column: QR + sponsor button
    const rightColumn = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
      spacing: 12,
      halign: Gtk.Align.FILL,
      valign: Gtk.Align.START,
      margin_top: 35,
      hexpand: true,
    });

    // QR code button linking to Ko-fi
    const qrButton = new Gtk.Button({
      halign: Gtk.Align.CENTER,
      tooltip_text: 'Buy Me a Coffee',
    });
    qrButton.add_css_class('flat');
    const qrImage = new Gtk.Image({
      gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/src/qrcode-symbolic.svg`) }),
      pixel_size: 128,
    });
    qrButton.set_child(qrImage);
    qrButton.connect('clicked', () => {
      this._launchUri(window, 'https://buymeacoffee.com/arnisk');
    });
    const qrBox = new Gtk.Box({
      halign: Gtk.Align.CENTER,
      valign: Gtk.Align.CENTER,
      margin_bottom: 12,
    });
    qrBox.append(qrButton);
    rightColumn.append(qrBox);

    // Sponsor button
    const coffeeButton = new Gtk.Button({
      halign: Gtk.Align.CENTER,
      tooltip_text: _('Become a sponsor on GitHub'),
    });
    coffeeButton.add_css_class('pill');
    coffeeButton.add_css_class('kiwimenu-coffee-button');

    const coffeeContent = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 8,
    });
    coffeeContent.append(new Gtk.Image({
      gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this.path}/src/github-symbolic.svg`) }),
    }));
    coffeeContent.append(new Gtk.Label({
      label: _('Sponsor Me ♡'),
    }));
    coffeeButton.set_child(coffeeContent);
    coffeeButton.connect('clicked', () => {
      this._launchUri(window, 'https://github.com/sponsors/kem-a');
    });
    rightColumn.append(coffeeButton);

    contentBox.append(rightColumn);

    contentGroup.add(contentBox);
    aboutPage.add(contentGroup);

    // Responsive breakpoint: stack columns vertically when window is narrow.
    const aboutBreakpoint = new Adw.Breakpoint({
      condition: Adw.BreakpointCondition.parse('max-width: 500sp'),
    });
    aboutBreakpoint.add_setter(contentBox, 'orientation', Gtk.Orientation.VERTICAL);
    aboutBreakpoint.add_setter(contentBox, 'homogeneous', false);
    aboutBreakpoint.add_setter(rightColumn, 'margin-top', 0);
    window.add_breakpoint(aboutBreakpoint);

    return aboutPage;
  }

  _createLinkRow(window, title, url) {
    const row = new Adw.ActionRow({
      title,
      activatable: true,
    });

    row.add_suffix(new Gtk.Image({ icon_name: 'external-link-symbolic' }));
    row.connect('activated', () => {
      this._launchUri(window, url);
    });

    return row;
  }

  _createLegalRow(window, baseUrl, _) {
    const row = new Adw.ActionRow({
      title: _('Legal'),
      activatable: true,
    });
    row.add_suffix(new Gtk.Image({ icon_name: 'go-next-symbolic' }));
    row.connect('activated', () => {
      this._openLegalDialog(window, baseUrl, _);
    });
    return row;
  }

  _openLegalDialog(window, baseUrl, _) {
    const dialog = new Adw.Dialog({
      content_width: 420,
      content_height: 560,
      presentation_mode: Adw.DialogPresentationMode.BOTTOM_SHEET,
    });

    const toolbarView = new Adw.ToolbarView();
    const headerBar = new Adw.HeaderBar({
      show_title: true,
      title_widget: new Adw.WindowTitle({ title: _('Legal') }),
    });
    toolbarView.add_top_bar(headerBar);

    const legalPage = new Adw.PreferencesPage();

    const licenseGroup = new Adw.PreferencesGroup({
      title: _('License'),
      description: _('Kiwi Menu is free and open source software.'),
    });
    licenseGroup.add(
      this._createLinkRow(
        window,
        _('GNU General Public License v3.0'),
        `${baseUrl}/blob/main/LICENSE`
      )
    );
    legalPage.add(licenseGroup);

    const copyrightGroup = new Adw.PreferencesGroup({
      title: _('Copyright'),
      description: _('Copyright © 2026 Arnis Kemlers. Licensed under the terms of the GNU General Public License version 3 or later.'),
    });
    legalPage.add(copyrightGroup);

    const scroller = new Gtk.ScrolledWindow({ vexpand: true, hexpand: true });
    scroller.set_child(legalPage);
    toolbarView.set_content(scroller);
    dialog.set_child(toolbarView);

    dialog.present(window);
  }

  _launchUri(window, url) {
    try {
      Gtk.show_uri(window, url, Gdk.CURRENT_TIME);
    } catch (error) {
      logError(error, `Failed to open URI ${url}`);
    }
  }
}
