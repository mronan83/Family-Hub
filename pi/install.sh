#!/usr/bin/env bash
# [DEV-04][WP-14] Turn a fresh Raspberry Pi OS (64-bit) into a FamilyWise board. Run on the Pi:
#
#   curl -fsSL https://raw.githubusercontent.com/mronan83/Family-Hub/main/pi/install.sh | sudo bash
#
# It downloads this folder from the same branch (FW_REF, default main) and runs setup.sh, which
# says what it does. Nothing here holds a secret: the board gets its own sign-in when it is paired.
set -euo pipefail

REF="${FW_REF:-main}"
REPO="mronan83/Family-Hub"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo: curl -fsSL <this file's address> | sudo bash" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
echo "Downloading the FamilyWise board kit ($REPO, $REF)..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$REF" |
  tar -xz -C "$work" --strip-components=1 --wildcards '*/pi/*'

bash "$work/pi/setup.sh" "$@"
