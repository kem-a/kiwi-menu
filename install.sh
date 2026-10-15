#!/bin/bash
#
# SPDX-License-Identifier: GPL-3.0-or-later
# install.sh - Install Kiwi Menu into the user's GNOME Shell extensions directory
# for local development.
#
# It copies the runtime tree (rather than symlinking it), compiles the GSettings
# schema and the translations, then tries to enable the extension. Copying keeps
# the working tree safe from `gnome-extensions uninstall`, which can delete the
# target of a symlinked extension directory.
#
# Usage:
#   ./install.sh              # build and install a fresh copy, then enable
#   ./install.sh --uninstall  # remove the installed copy

set -euo pipefail

UUID="kiwimenu@kemma"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"

# Everything GNOME Shell needs at runtime. Listing entries explicitly keeps the
# installed copy free of dev-only files (.git, .github, translating/, ...).
ENTRIES=(
  extension.js
  metadata.json
  prefs.js
  prefs.css
  stylesheet.css
  LICENSE
  src
  app
  icons
  schemas
  po
)

ok()   { printf '✓ %s\n' "$*"; }
log()  { printf '• %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; }

remove_installed_copy() {
  # If an older setup left a symlink here, remove only the link so the
  # repository is never touched.
  if [ -L "$DEST_DIR" ]; then
    rm -- "$DEST_DIR"
  elif [ -d "$DEST_DIR" ]; then
    rm -rf -- "$DEST_DIR"
  fi
}

if [ "${1:-}" = "--uninstall" ]; then
  remove_installed_copy
  ok "Removed $DEST_DIR"
  exit 0
fi

for tool in glib-compile-schemas; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "Required tool '$tool' not found (install the glib2 / libglib2.0-bin package)"
    exit 1
  fi
done

# --- copy the runtime tree -------------------------------------------------
# Clear any symlink/old copy first so a leftover symlink can never redirect the
# copy back into the working tree.
remove_installed_copy
mkdir -p "$DEST_DIR"

for entry in "${ENTRIES[@]}"; do
  [ -e "$SRC_DIR/$entry" ] || continue
  cp -R -- "$SRC_DIR/$entry" "$DEST_DIR/$entry"
done
ok "Copied extension files to $DEST_DIR"

# --- compile the GSettings schema -----------------------------------------
glib-compile-schemas "$DEST_DIR/schemas"
ok "Compiled GSettings schema"

# --- compile translations (optional) --------------------------------------
if command -v msgfmt >/dev/null 2>&1 && compgen -G "$DEST_DIR/po/*.po" >/dev/null; then
  for po_file in "$DEST_DIR"/po/*.po; do
    lang="$(basename "$po_file" .po)"
    out_dir="$DEST_DIR/locale/$lang/LC_MESSAGES"
    mkdir -p "$out_dir"
    msgfmt "$po_file" -o "$out_dir/$UUID.mo"
  done
  ok "Compiled translations into $DEST_DIR/locale"
else
  log "Skipping translations (msgfmt not found or no po/ files)"
fi

# --- enable ----------------------------------------------------------------
if command -v gnome-extensions >/dev/null 2>&1; then
  if gnome-extensions enable "$UUID" 2>/dev/null; then
    ok "Enabled $UUID"
  else
    log "Could not enable $UUID yet; GNOME Shell must see it after a restart"
  fi
fi

cat <<EOF

Installed. Log out and back in.

Re-run ./install.sh after changing files to refresh the installed copy.
EOF
