import { describe, expect, it, vi } from 'vitest';
import { onPi, tellScreen } from './kiosk-screen';

const browser = (platform: string, architecture: string) => ({
  userAgentData: { platform, getHighEntropyValues: async () => ({ architecture }) },
});

describe('[DEV-07] WP-34: the Pi’s screen power', () => {
  it('only a Chromium on Linux on ARM asks the Pi’s helper', async () => {
    expect(await onPi(browser('Linux', 'arm'))).toBe(true);
    expect(await onPi(browser('Linux', 'x86'))).toBe(false);
    expect(await onPi(browser('macOS', 'arm'))).toBe(false);
    expect(await onPi(browser('Android', 'arm'))).toBe(false);
    // Safari (an iPad) has no userAgentData.
    expect(await onPi({})).toBe(false);
  });

  it('tells the helper on or off, and carries on where there is none', async () => {
    const send = vi.fn(async () => new Response('ok'));
    expect(await tellScreen(false, send)).toBe(true);
    expect(send).toHaveBeenCalledWith('http://127.0.0.1:8737/screen/off', {
      method: 'POST',
      cache: 'no-store',
    });
    await tellScreen(true, send);
    expect(send).toHaveBeenLastCalledWith('http://127.0.0.1:8737/screen/on', expect.anything());
    const none = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await tellScreen(false, none)).toBe(false);
  });
});
