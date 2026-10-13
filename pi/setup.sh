#!/usr/bin/env bash
# [DEV-04][WP-14] Set a Raspberry Pi up as a FamilyWise board (01 §8, D-83). Safe to run again: it
# rewrites its own files and leaves everything else alone.
#
#   sudo bash setup.sh [--url URL] [--user NAME] [--no-nightly-reboot]
#   bash setup.sh --root DIR ...   writes the files under DIR and changes nothing else (tests)
#
# What it does:
#   - installs Chromium, the labwc compositor and a few small tools;
#   - signs the user in on the screen at boot, and starts the board full screen (fw-kiosk), started
#     again within seconds if it ever closes;
#   - locks Chromium down by policy: no developer tools, downloads, sign-in or passwords, and the
#     admin app and chrome:// pages are blocked on this screen;
#   - keeps Wi-Fi awake, turns the hardware watchdog on, keeps the system log small, and restarts
#     the Pi at 03:30 each night (unless --no-nightly-reboot);
#   - installs fw-screen (screen on and off) and fw-check (a health and speed report).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="https://family-wise-topaz.vercel.app/board"
KIOSK_USER="${SUDO_USER:-}"
NIGHTLY=1
ROOT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --user) KIOSK_USER="$2"; shift 2 ;;
    --no-nightly-reboot) NIGHTLY=0; shift ;;
    --root) ROOT="$2"; shift 2 ;;
    -h | --help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$URL" in
  https://*/board | https://*/board/) URL="${URL%/}" ;;
  *) echo "--url must be the board's https address ending in /board, like https://example.com/board" >&2; exit 2 ;;
esac
HOST="${URL#https://}"
HOST="${HOST%%/*}"

if [ -z "$ROOT" ]; then
  [ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }
  if [ -z "$KIOSK_USER" ] || ! id "$KIOSK_USER" >/dev/null 2>&1; then
    echo "Say which user the board runs as: --user NAME (the one you sign in to the Pi with)." >&2
    exit 1
  fi
  [ "$KIOSK_USER" != root ] || { echo "The board must not run as root; pass --user NAME." >&2; exit 1; }
  model="$(tr -d '\0' </proc/device-tree/model 2>/dev/null || echo unknown)"
  case "$model" in
    "Raspberry Pi 4"* | "Raspberry Pi 5"*) ;; # the 400 and 500 too
    *) echo "Warning: built for a Raspberry Pi 4 or 5; this is: $model" >&2 ;;
  esac
  [ "$(uname -m)" = aarch64 ] || echo "Warning: use the 64-bit Raspberry Pi OS; this is $(uname -m)." >&2
  HOME_DIR="$(getent passwd "$KIOSK_USER" | cut -d: -f6)"
else
  KIOSK_USER="${KIOSK_USER:-pi}"
  HOME_DIR="/home/$KIOSK_USER"
fi

say() { printf '\n== %s\n' "$*"; }
# put DEST MODE: write stdin to $ROOT/DEST with MODE.
put() {
  local dest="$ROOT$1"
  mkdir -p "$(dirname "$dest")"
  cat >"$dest"
  chmod "$2" "$dest"
}

if [ -z "$ROOT" ]; then
  say "Installing Chromium, labwc and tools"
  apt-get update -q
  browser=chromium
  apt-cache show chromium >/dev/null 2>&1 || browser=chromium-browser
  extras=()
  for p in wlopm fonts-noto-color-emoji; do
    apt-cache show "$p" >/dev/null 2>&1 && extras+=("$p")
  done
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends \
    "$browser" labwc wlr-randr python3 python3-websocket curl iw "${extras[@]}"
fi

say "Writing the board settings"
put /etc/familywise/kiosk.conf 0644 <<EOF
# FamilyWise board (written by setup.sh; run it again to change these).
FW_URL=$URL
FW_USER=$KIOSK_USER
# The highest refresh rate the screen is set to: 60 Hz is smooth for the board and halves the work
# a 120 Hz monitor would ask of the Pi. Empty leaves the screen as it starts.
FW_MAX_HZ=60
EOF

for f in fw-kiosk fw-screen fw-check; do
  put "/usr/local/bin/$f" 0755 <"$here/$f"
done
put /usr/local/lib/familywise/check.py 0644 <"$here/check.py"

say "Locking Chromium down"
put /etc/chromium/policies/managed/familywise.json 0644 <<EOF
{
  "URLBlocklist": ["chrome://*", "file://*", "view-source:*", "$HOST/admin"],
  "DeveloperToolsAvailability": 2,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "PasswordManagerEnabled": false,
  "AutofillAddressEnabled": false,
  "AutofillCreditCardEnabled": false,
  "TranslateEnabled": false,
  "DownloadRestrictions": 3,
  "PrintingEnabled": false,
  "DefaultBrowserSettingEnabled": false,
  "MetricsReportingEnabled": false,
  "AllowDinosaurEasterEgg": false,
  "HardwareAccelerationModeEnabled": true
}
EOF

say "Starting the board at boot"
put "$HOME_DIR/.config/labwc/autostart" 0644 <<'EOF'
# FamilyWise (setup.sh): the board, full screen, started again if it closes.
/usr/local/bin/fw-kiosk &
EOF
profile="$ROOT$HOME_DIR/.bash_profile"
mkdir -p "$(dirname "$profile")"
touch "$profile"
sed -i '/^# >>> familywise/,/^# <<< familywise/d' "$profile"
cat >>"$profile" <<'EOF'
# >>> familywise (setup.sh): the console on the screen starts the board; SSH sign-ins don't.
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ "$(tty)" = /dev/tty1 ]; then
  exec systemd-cat -t labwc labwc
fi
# <<< familywise
EOF

say "Keeping Wi-Fi awake, the watchdog on and the log small"
put /etc/NetworkManager/conf.d/familywise-wifi.conf 0644 <<'EOF'
# FamilyWise: Wi-Fi power saving drops a board off the network now and then.
[connection]
wifi.powersave = 2
EOF
put /etc/systemd/system.conf.d/familywise-watchdog.conf 0644 <<'EOF'
# FamilyWise: the Pi's hardware watchdog restarts it if the system stops answering.
[Manager]
RuntimeWatchdogSec=14s
RebootWatchdogSec=2min
EOF
put /etc/systemd/journald.conf.d/familywise.conf 0644 <<'EOF'
# FamilyWise: a small log, to spare the SD card.
[Journal]
SystemMaxUse=64M
EOF

if [ "$NIGHTLY" = 1 ]; then
  put /etc/systemd/system/familywise-nightly-reboot.service 0644 <<'EOF'
[Unit]
Description=FamilyWise nightly restart

[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl --no-block reboot
EOF
  put /etc/systemd/system/familywise-nightly-reboot.timer 0644 <<'EOF'
[Unit]
Description=Restart the FamilyWise board at 03:30 each night

[Timer]
OnCalendar=*-*-* 03:30:00

[Install]
WantedBy=timers.target
EOF
else
  rm -f "$ROOT/etc/systemd/system/familywise-nightly-reboot.service" "$ROOT/etc/systemd/system/familywise-nightly-reboot.timer"
fi

if [ -z "$ROOT" ]; then
  chown -R "$KIOSK_USER:" "$HOME_DIR/.config/labwc" "$HOME_DIR/.bash_profile"
  # Console sign-in on the screen at boot, without a password (B2), so the board starts on its own.
  if command -v raspi-config >/dev/null; then
    raspi-config nonint do_boot_behaviour B2
  else
    echo "Warning: raspi-config not found; turn on console autologin for $KIOSK_USER yourself." >&2
  fi
  systemctl daemon-reload
  if [ "$NIGHTLY" = 1 ]; then
    systemctl enable -q familywise-nightly-reboot.timer
  else
    systemctl disable -q familywise-nightly-reboot.timer 2>/dev/null || true
  fi
  systemctl restart systemd-journald
  systemctl reload NetworkManager 2>/dev/null || true
fi

say "Done"
cat <<EOF
The board opens $URL full screen after a restart. Next:
  1. sudo reboot
  2. On the screen, the board asks for a code. In the admin app, open Settings, then Boards, add a
     board, and type its code on the board's keypad.
  3. Once it shows your family, run: fw-check   (a health and speed report you can share)
EOF
