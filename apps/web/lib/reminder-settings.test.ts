import { describe, expect, it } from 'vitest';
import {
  clockWords,
  DEFAULT_SETTINGS,
  deviceLabel,
  parseSettings,
  readSettings,
  settingsSummary,
  subscriptionSchema,
} from './reminder-settings';

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const OK = {
  defaultOn: 'on',
  defaultLeadMinutes: '15',
  morningTime: '08:00',
  hidePrivateTitles: 'on',
};

describe('reminder settings', () => {
  it('[CHR-16][CHR-17] the form: lead time, morning time, digest and quiet hours when switched on', () => {
    expect(
      parseSettings(
        form({
          ...OK,
          digest: 'on',
          digestTime: '07:00',
          quiet: 'on',
          quietStart: '21:00',
          quietEnd: '07:00',
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        defaultOn: true,
        defaultLeadMinutes: 15,
        morningTime: '08:00',
        digestTime: '07:00',
        quietStart: '21:00',
        quietEnd: '07:00',
        hidePrivateTitles: true,
      },
    });
    // A switched-off digest or quiet hours ignore their times; unticked boxes are off.
    expect(
      parseSettings(form({ defaultLeadMinutes: '0', morningTime: '06:30', digestTime: '07:00' })),
    ).toEqual({
      ok: true,
      value: {
        defaultOn: false,
        defaultLeadMinutes: 0,
        morningTime: '06:30',
        digestTime: null,
        quietStart: null,
        quietEnd: null,
        hidePrivateTitles: false,
      },
    });
  });

  it('[CHR-16][CHR-17] says what to fix', () => {
    const msg = (f: Record<string, string>) => {
      const r = parseSettings(form(f));
      return r.ok ? null : r.message;
    };
    expect(msg({ ...OK, defaultLeadMinutes: '30' })).toBe('Choose when items remind you.');
    expect(msg({ ...OK, morningTime: '25:00' })).toBe('Choose a morning time, like 08:00.');
    expect(msg({ ...OK, digest: 'on' })).toBe('Choose a time for the digest.');
    expect(msg({ ...OK, quiet: 'on', quietStart: '21:00' })).toBe(
      'Quiet hours need a start and an end.',
    );
    expect(msg({ ...OK, quiet: 'on', quietStart: '21:00', quietEnd: '21:00' })).toBe(
      'Quiet hours start and end at different times.',
    );
    // A browser may send seconds.
    expect(msg({ ...OK, morningTime: '08:00:00' })).toBeNull();
  });

  it('[CHR-15] off until a person turns them on; the stored row reads back as the form', () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.enabled).toBe(false);
    expect(
      readSettings({
        enabled: true,
        default_on: false,
        default_lead_minutes: 60,
        morning_time: '07:30:00',
        digest_time: null,
        quiet_start: '22:00:00',
        quiet_end: '06:00:00',
        hide_private_titles: false,
      }),
    ).toEqual({
      enabled: true,
      defaultOn: false,
      defaultLeadMinutes: 60,
      morningTime: '07:30',
      digestTime: null,
      quietStart: '22:00',
      quietEnd: '06:00',
      hidePrivateTitles: false,
    });
  });

  it('[CHR-16] in a line, as the page shows it', () => {
    expect(clockWords('15:00')).toBe('3:00 pm');
    expect(clockWords('00:30')).toBe('12:30 am');
    expect(
      settingsSummary({
        ...DEFAULT_SETTINGS,
        digestTime: '07:00',
        quietStart: '21:00',
        quietEnd: '07:00',
      }),
    ).toBe(
      '15 minutes before the due time · items with no time at 8:00 am · a digest at 7:00 am · quiet 9:00 pm to 7:00 am',
    );
    expect(settingsSummary({ ...DEFAULT_SETTINGS, defaultLeadMinutes: 0 })).toBe(
      'at the due time · items with no time at 8:00 am',
    );
  });
});

describe('devices', () => {
  it('[CHR-15] a subscription is an https endpoint and its two keys; nothing else', () => {
    const ok = {
      endpoint: 'https://web.push.apple.com/abc',
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
    };
    expect(subscriptionSchema.safeParse(ok).success).toBe(true);
    expect(subscriptionSchema.safeParse({ ...ok, endpoint: 'http://push.example/x' }).success).toBe(
      false,
    );
    expect(subscriptionSchema.safeParse({ endpoint: ok.endpoint }).success).toBe(false);
  });

  it('[CHR-15] named so a person can tell them apart', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('iPhone · Safari');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Mac · Chrome');
    expect(
      deviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
      ),
    ).toBe('Windows · Firefox');
    expect(deviceLabel('')).toBe('This device');
  });
});
