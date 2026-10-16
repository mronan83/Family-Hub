import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
