import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { installScript, screenHelper } from './kiosk-scripts';

// [DEV-07] WP-34: the Pi's screen helper, run here with Python as the Pi runs it, in its dry mode
// (it writes "on" or "off" to a file instead of turning a screen), on a free port.
const ORIGIN = 'https://familywise.example';
const dir = mkdtempSync(join(tmpdir(), 'fw-screen-'));
const state = join(dir, 'screen');
let helper: ChildProcess;
let base = '';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  const file = join(dir, 'familywise-screen');
  writeFileSync(file, screenHelper(ORIGIN));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  helper = spawn('python3', [file], {
    env: { ...process.env, FAMILYWISE_SCREEN_PORT: String(port), FAMILYWISE_SCREEN_DRY: state },
    stdio: 'ignore',
  });
  // Ready once it answers.
  await vi.waitFor(
    async () => {
      if ((await fetch(`${base}/status`)).status !== 200) throw new Error('not ready');
    },
    { timeout: 15_000, interval: 50 },
  );
});
afterAll(() => {
  helper?.kill();
});

describe('[DEV-07] WP-34: the Pi’s screen helper', () => {
  it('turns the screen off and on for the board’s own site', async () => {
    const off = await fetch(`${base}/screen/off`, { method: 'POST', headers: { Origin: ORIGIN } });
    expect(off.status).toBe(200);
    expect(off.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(readFileSync(state, 'utf8')).toBe('off');
    expect(await (await fetch(`${base}/status`)).json()).toEqual({ on: false });
    await fetch(`${base}/screen/on`, { method: 'POST', headers: { Origin: ORIGIN } });
    expect(readFileSync(state, 'utf8')).toBe('on');
  });

  it('answers no other site, and says Chromium may reach it from the board', async () => {
    const other = await fetch(`${base}/screen/off`, {
      method: 'POST',
      headers: { Origin: 'https://elsewhere.example' },
    });
    expect(other.status).toBe(403);
    expect(readFileSync(state, 'utf8')).toBe('on');
    const pre = await fetch(`${base}/screen/off`, {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-private-network')).toBe('true');
  });

  it('the installer is a valid script for the site it came from', () => {
    const file = join(dir, 'install.sh');
    writeFileSync(file, installScript(ORIGIN));
    execFileSync('bash', ['-n', file]);
    expect(readFileSync(file, 'utf8')).toContain(`origin='${ORIGIN}'`);
    expect(installScript("https://it's.example")).toContain(`origin='https://it'\\''s.example'`);
  });
});

/**
 * The installer run for real in a made-up home, with stand-ins on PATH for what it calls on a Pi
 * (curl, sudo, systemctl, pgrep, pkill, wlopm): each writes what it was asked to a log.
 */
function install(opts: { wayland: string | null; labwc: boolean }) {
  const home = mkdtempSync(join(tmpdir(), 'fw-install-'));
  const runtime = join(home, 'run');
  const bin = join(home, 'shims');
  const log = join(home, 'calls.log');
  mkdirSync(runtime);
  mkdirSync(bin);
  mkdirSync(join(home, '.config/autostart'), { recursive: true });
  // The first version's start-up file, which the service replaces.
  writeFileSync(join(home, '.config/autostart/familywise-screen.desktop'), '[Desktop Entry]\n');
  if (opts.wayland) writeFileSync(join(runtime, opts.wayland), '');
  const shim = (name: string, body: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // curl -fsSL <url> -o <file>: writes the file.
  shim('curl', 'while [ $# -gt 0 ]; do if [ "$1" = -o ]; then echo helper > "$2"; fi; shift; done');
  shim('sudo', 'cat > /dev/null');
  shim('systemctl', 'exit 0');
  shim('pgrep', opts.labwc ? 'exit 0' : 'exit 1');
  shim('pkill', 'exit 1');
  shim('wlopm', 'exit 0');
  const script = join(home, 'install.sh');
  writeFileSync(script, installScript(ORIGIN));
  const out = execFileSync('bash', [script], {
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, HOME: home, XDG_RUNTIME_DIR: runtime },
    input: '',
    encoding: 'utf8',
  });
  return {
    out,
    unit: readFileSync(join(home, '.config/systemd/user/familywise-screen.service'), 'utf8'),
    calls: readFileSync(log, 'utf8'),
    oldStartup: existsSync(join(home, '.config/autostart/familywise-screen.desktop')),
    home,
  };
}

describe('[DEV-07] WP-34 follow-up: the installer runs the helper as a systemd user service', () => {
  it('on Wayland (labwc on Debian 13): the desktop’s own display, started now and with the Pi', () => {
    const r = install({ wayland: 'wayland-1', labwc: true });
    expect(r.unit).toContain(
      `ExecStart=/usr/bin/env python3 ${r.home}/.local/bin/familywise-screen`,
    );
    expect(r.unit).toContain('Environment=WAYLAND_DISPLAY=wayland-1');
    expect(r.unit).toContain('Restart=always');
    expect(r.unit).toContain('WantedBy=default.target');
    expect(r.calls).toContain('systemctl --user enable familywise-screen.service');
    expect(r.calls).toContain('systemctl --user restart familywise-screen.service');
    expect(r.calls).toContain(`curl -fsSL ${ORIGIN}/api/kiosk/screen-helper`);
    // wlopm is there already, so nothing is installed.
    expect(r.calls).not.toContain('apt-get');
    expect(r.oldStartup, 'the first version’s start-up file is replaced').toBe(false);
    expect(r.out).toContain('The helper is running (WAYLAND_DISPLAY=wayland-1)');
  });

  it('on labwc with its socket not found, wayland-0', () => {
    expect(install({ wayland: null, labwc: true }).unit).toContain(
      'Environment=WAYLAND_DISPLAY=wayland-0',
    );
  });

  it('on X11: the first display', () => {
    const r = install({ wayland: null, labwc: false });
    expect(r.unit).toContain('Environment=DISPLAY=:0');
    expect(r.unit).not.toContain('WAYLAND_DISPLAY');
  });
});
