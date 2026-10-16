/**
 * [DEV-07] The screen's power on a Raspberry Pi board (WP-34, D-117). A web page can't turn its
 * screen off, so on the Pi a small helper (`/kiosk/install`, kiosk-scripts.ts) listens on the Pi
 * itself and turns the monitor off and on when the board says it sleeps and wakes. Only a board on
 * a Pi asks it: a Chromium on Linux on an ARM processor. An iPad, a laptop or a phone never does, so
 * none of them is asked by the browser for access to its local network.
 */
export const SCREEN_HELPER_PORT = 8737;
export const SCREEN_HELPER_URL = `http://127.0.0.1:${SCREEN_HELPER_PORT}`;

interface UserAgentData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

/** Whether this browser looks like the Pi's Chromium (Linux on ARM). */
export async function onPi(nav: object = navigator): Promise<boolean> {
  const ua = (nav as { userAgentData?: UserAgentData }).userAgentData;
  if (!ua?.getHighEntropyValues || ua.platform !== 'Linux') return false;
  try {
    const { architecture } = await ua.getHighEntropyValues(['architecture']);
    return architecture === 'arm';
  } catch {
    return false;
  }
}

/**
 * Tells the Pi's helper to turn the screen on or off. Nothing comes of it where there is no helper:
 * the request fails and the board carries on, black when asleep as any board is.
 */
export async function tellScreen(on: boolean, send: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await send(`${SCREEN_HELPER_URL}/screen/${on ? 'on' : 'off'}`, {
      method: 'POST',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}
