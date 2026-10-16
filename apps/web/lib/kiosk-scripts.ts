import { SCREEN_HELPER_PORT } from './kiosk-screen';

/**
 * [DEV-07] The Raspberry Pi's screen helper (WP-34, D-117), served by the app so the owner installs
 * it with one command on the Pi: `curl -fsSL <site>/api/kiosk/install | bash`. The helper listens
 * on the Pi only (127.0.0.1), answers only the board's own site, and turns the monitor's power off
 * and on when the board sleeps and wakes: `wlopm` under Wayland (Pi OS's labwc or Wayfire), `xset
 * dpms` under X11. It needs no password, key or account. The installer also lets Chromium reach it
 * without asking (its Local Network Access policy, for the board's site only), and runs it as a
 * systemd user service, so it starts with the Pi whichever desktop it has (the first version used
 * the desktop's start-up folder, which labwc on Debian 13 doesn't read). `origin` is the board's
 * site, as the installer was fetched from.
 */
export function screenHelper(origin: string): string {
  return `#!/usr/bin/env python3
# FamilyWise screen helper (WP-34): turns this Pi's monitor off when the board sleeps and on when it
# wakes. Installed by ${origin}/api/kiosk/install; listens on this Pi only.
import http.server, json, os, shutil, subprocess

ORIGIN = ${JSON.stringify(origin)}
PORT = int(os.environ.get('FAMILYWISE_SCREEN_PORT', '${SCREEN_HELPER_PORT}'))
# For a test: write "on" or "off" to this file instead of turning the screen.
DRY = os.environ.get('FAMILYWISE_SCREEN_DRY')
state = {'on': True}


def run(*cmd):
    try:
        return subprocess.run(cmd, timeout=10, stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def screen(on):
    if DRY:
        with open(DRY, 'w') as f:
            f.write('on' if on else 'off')
        return True
    if os.environ.get('WAYLAND_DISPLAY') and shutil.which('wlopm'):
        if run('wlopm', '--on' if on else '--off', '*'):
            return True
    if os.environ.get('DISPLAY') and shutil.which('xset'):
        run('xset', '+dpms')
        return run('xset', 'dpms', 'force', 'on' if on else 'off')
    return False


class Handler(http.server.BaseHTTPRequestHandler):
    def headers_for(self, status, body=b''):
        self.send_response(status)
        self.send_header('Access-Control-Allow-Origin', ORIGIN)
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Allow-Local-Network', 'true')
        self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.headers_for(204)

    def do_GET(self):
        if self.path == '/status':
            self.headers_for(200, json.dumps({'on': state['on']}).encode())
        else:
            self.headers_for(404)

    def do_POST(self):
        if self.headers.get('Origin') != ORIGIN:
            self.headers_for(403)
            return
        if self.path not in ('/screen/on', '/screen/off'):
            self.headers_for(404)
            return
        on = self.path == '/screen/on'
        done = screen(on)
        if done:
            state['on'] = on
        self.headers_for(200 if done else 503, json.dumps({'on': state['on']}).encode())

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
`;
}

/** [DEV-07] The installer, run on the Pi as the user the kiosk runs as (WP-34). */
export function installScript(origin: string): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/usr/bin/env bash
# FamilyWise screen helper for the Raspberry Pi board (WP-34). On the Pi, as the user the board
# runs as, in a terminal or over SSH:
#   curl -fsSL ${origin}/api/kiosk/install | bash
# It installs the helper, lets Chromium reach it for this site only, and runs it as a systemd user
# service: started now, at every start of the Pi, and again if it stops. Running it again updates it.
set -euo pipefail
origin=${q(origin)}
bin="$HOME/.local/bin/familywise-screen"
unit_dir="$HOME/.config/systemd/user"
runtime="\${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

echo "FamilyWise: installing the screen helper for $origin"
mkdir -p "$(dirname "$bin")" "$unit_dir"
curl -fsSL "$origin/api/kiosk/screen-helper" -o "$bin"
chmod +x "$bin"

# Which display the screen is on: Wayland (labwc or Wayfire, as on Pi OS since 2023), turned by
# wlopm; else X11, turned by xset. Found from the running desktop, so it works over SSH too.
wayland=""
for socket in "$runtime"/wayland-[0-9]; do
  if [ -S "$socket" ] || [ -e "$socket" ]; then wayland="$(basename "$socket")"; break; fi
done
if [ -z "$wayland" ] && { pgrep -x labwc >/dev/null || pgrep -x wayfire >/dev/null; }; then
  wayland="wayland-0"
fi
if [ -n "$wayland" ]; then
  command -v wlopm >/dev/null || sudo apt-get install -y wlopm
  display="WAYLAND_DISPLAY=$wayland"
else
  display="DISPLAY=:0"
fi

# Chromium may reach the helper on this Pi from this site, without asking (it can't ask in kiosk mode).
sudo mkdir -p /etc/chromium/policies/managed
printf '{"LocalNetworkAccessAllowedForUrls": ["%s"], "InsecurePrivateNetworkRequestsAllowedForUrls": ["%s"]}\\n' \\
  "$origin" "$origin" | sudo tee /etc/chromium/policies/managed/familywise-screen.json >/dev/null

# A systemd user service: it doesn't depend on which desktop reads which start-up folder.
cat > "$unit_dir/familywise-screen.service" <<UNIT
[Unit]
Description=FamilyWise screen helper (turns the monitor off and on with the board)

[Service]
ExecStart=/usr/bin/env python3 $bin
Environment=$display
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT

# The first version started it from the desktop's start-up folder, which not every desktop reads;
# that file is replaced by the service. A copy started by hand is stopped, so the service can listen.
rm -f "$HOME/.config/autostart/familywise-screen.desktop"
systemctl --user stop familywise-screen.service 2>/dev/null || true
pkill -f "python3 $bin" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable familywise-screen.service
systemctl --user restart familywise-screen.service

echo "FamilyWise: done. The helper is running ($display)."
echo "If this is the first install, restart the Pi once so Chromium reads its new setting: sudo reboot"
`;
}
