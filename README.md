<!-- Row 1: install & reach -->

[![Install on GNOME Extensions](https://img.shields.io/badge/Install_on-GNOME_Extensions-blue?logo=gnome)](https://extensions.gnome.org/extension/8697/kiwi-menu/)
[![EGO downloads](https://img.shields.io/gnome-extensions/dt/kiwimenu@kemma?label=EGO%20downloads)](https://extensions.gnome.org/extension/8697/kiwi-menu/)
![Shell 45–49](https://img.shields.io/badge/GNOME_Shell-45–50-informational?logo=gnome)
[![License](https://img.shields.io/github/license/kem-a/kiwi-menu)](https://github.com/kem-a/kiwi-menu/blob/main/LICENSE)
[![Latest release](https://img.shields.io/github/v/release/kem-a/kiwi-menu?semver)](https://github.com/kem-a/kiwi-menu/releases/latest)
[![Stars](https://img.shields.io/github/stars/kem-a/kiwi-menu?style=social)](https://github.com/kem-a/kiwi-menu/stargazers)

# <img width="43" height="48" alt="kiwimenu" src="https://github.com/user-attachments/assets/96437e0e-8884-4041-a3b2-c60ff15cd433" /> Kiwi Menu

Kiwi Menu adds compact, macOS-inspired quick menu that keeps your most common session actions one click away.

<img width="2261" height="1322" alt="Screenshot From 2026-07-21 edited-3" src="https://github.com/user-attachments/assets/2c23a992-6015-4b10-a4b8-91a397fdfc25" />

## Features

- **macOS style panel button**: Swaps the Activities label for a tidy icon-only trigger that blends into GNOME Shell.
- **macOS style user switcher**: Adds button to the panel with popup menu to switch between user sessions.
- **Recent items submenu**: Hover or click to browse recent files and folders with automatic section headers and quick launch support.
- **Force Quit dialog**: macOS style Force Quit Applications window listing running apps with CPU and memory usage. Select an app and force quit it when it misbehaves.
- **Custom AppStore command**: Add your distro specific App store shortcut
- **Personalized Menu Item**: Add one custom menu entry of your choice
- **Adaptive logout label**: Personalizes the log out entry with your full name when available.
- **Curated session controls**: Sleep, restart, shut down, lock, and log out entries mirror the macOS Apple menu workflow.
- **Hide Activities**: Hide activities button in top panel.
- **Hide Power buttons**: Hide Lock screen and Power buttons in Quick Settings
- **Multilingual support**: Fully translatable interface

## Other extensions

Recommended to pair with [Kiwi (is not Apple)](https://extensions.gnome.org/extension/8276/kiwi-is-not-apple/) and [blur-my-shell](https://github.com/aunetx/blur-my-shell) for blurred effect.

## Known Issues

- Recent Applications menu is cleared after log out. This is limitation of Gnome shell

## Development

After changing code, run `./install.sh` and then `dbus-run-session gnome-shell --devkit` to test.

## Translations

Want to help translate Kiwi Menu to your language? See the [translation guide](translating/README.md) for instructions.

## Contributing

Contributions and feature requests are welcome. This extension is designed to help macOS users feel at home on GNOME, so the main goal is a clean, minimal menu with familiar behavior. I try to avoid feature creep and large configuration surfaces to keep the project easy to maintain. If you have an idea that is more feature rich, I am happy to point you to similar projects where it may fit better.
