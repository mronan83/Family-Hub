#!/usr/bin/env bash
# [DEV-04][WP-14] Checks for the board kit, run in CI (ci / database): the scripts pass shellcheck,
# setup.sh writes what it should and is safe to run twice, the Chromium policy is valid JSON that
# blocks the admin app, and fw-kiosk sets a 120 Hz screen to 60 Hz.
set -euo pipefail
cd "$(dirname "$0")"
fail() { echo "FAIL: $*" >&2; exit 1; }

shellcheck -x install.sh setup.sh fw-kiosk fw-screen fw-check test.sh
python3 -m py_compile check.py

root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
bash setup.sh --root "$root" --user kid --url https://board.example.com/board/ >/dev/null
bash setup.sh --root "$root" --user kid --url https://board.example.com/board >/dev/null

grep -qx 'FW_URL=https://board.example.com/board' "$root/etc/familywise/kiosk.conf" || fail "kiosk.conf URL"
grep -qx 'FW_USER=kid' "$root/etc/familywise/kiosk.conf" || fail "kiosk.conf user"
for f in fw-kiosk fw-screen fw-check; do
  [ -x "$root/usr/local/bin/$f" ] || fail "$f not installed"
done
[ -f "$root/usr/local/lib/familywise/check.py" ] || fail "check.py not installed"
python3 - "$root/etc/chromium/policies/managed/familywise.json" <<'PY' || fail "Chromium policy"
import json, sys
p = json.load(open(sys.argv[1]))
assert "board.example.com/admin" in p["URLBlocklist"], p["URLBlocklist"]
assert "chrome://*" in p["URLBlocklist"]
assert p["DeveloperToolsAvailability"] == 2 and p["DownloadRestrictions"] == 3
PY
[ "$(grep -c '^# >>> familywise' "$root/home/kid/.bash_profile")" = 1 ] || fail ".bash_profile block written twice"
grep -q 'fw-kiosk' "$root/home/kid/.config/labwc/autostart" || fail "labwc autostart"
[ -f "$root/etc/systemd/system/familywise-nightly-reboot.timer" ] || fail "nightly restart timer"
bash setup.sh --root "$root" --user kid --no-nightly-reboot >/dev/null
[ ! -e "$root/etc/systemd/system/familywise-nightly-reboot.timer" ] || fail "--no-nightly-reboot keeps the timer"
if bash setup.sh --root "$root" --url http://board.example.com/board >/dev/null 2>&1; then fail "accepted a non-https URL"; fi

# fw-kiosk's refresh rate: a 1920x1080 screen at 120 Hz goes to its 60 Hz mode; one at 60 Hz is left.
bin="$root/stub"
mkdir -p "$bin"
cat >"$bin/wlr-randr" <<'STUB'
#!/usr/bin/env bash
if [ $# -gt 0 ]; then echo "$*" >>"$STUB_LOG"; exit 0; fi
cat "$STUB_SCREEN"
STUB
printf '#!/bin/sh\n' >"$bin/logger"
chmod +x "$bin/wlr-randr" "$bin/logger"
cat >"$root/screen-120" <<'S'
HDMI-A-1 "Dell Inc. DELL G2422HS (HDMI-A-1)"
  Enabled: yes
  Modes:
    1920x1080 px, 119.982002 Hz (preferred, current)
    1920x1080 px, 60.000000 Hz
    1920x1080 px, 59.940060 Hz
    1280x720 px, 60.000000 Hz
S
sed -e 's/119.982002 Hz (preferred, current)/119.982002 Hz (preferred)/' \
  -e 's/1920x1080 px, 60.000000 Hz/1920x1080 px, 60.000000 Hz (current)/' "$root/screen-120" >"$root/screen-60"
refresh() {
  STUB_SCREEN="$1" STUB_LOG="$root/log" FW_MAX_HZ=60 PATH="$bin:$PATH" bash -c \
    "$(sed -n '/^log()/p; /^set_refresh()/,/^}/p' fw-kiosk); set_refresh"
}
: >"$root/log"
refresh "$root/screen-120"
[ "$(cat "$root/log")" = "--output HDMI-A-1 --mode 1920x1080@60.000000Hz" ] || fail "120 Hz screen: $(cat "$root/log")"
: >"$root/log"
refresh "$root/screen-60"
[ ! -s "$root/log" ] || fail "60 Hz screen was changed: $(cat "$root/log")"

echo "pi kit: ok"
