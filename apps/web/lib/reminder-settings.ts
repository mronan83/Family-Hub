import { z } from 'zod';

// A person's reminder settings and devices (WP-40, D-58), in the admin app's words. The database
// keeps each person's own (RLS); this checks the form and the browser's subscription, and names
// devices so a person can tell them apart.

/** [CHR-16] How long before an item's due time it reminds. */
export const LEAD_CHOICES = [
  { minutes: 0, label: 'At the due time' },
  { minutes: 15, label: '15 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 1440, label: '1 day before' },
] as const;
export type LeadMinutes = (typeof LEAD_CHOICES)[number]['minutes'];

export const leadWords = (minutes: number): string =>
  LEAD_CHOICES.find((c) => c.minutes === minutes)?.label ?? `${minutes} minutes before`;

export interface ReminderSettings {
  enabled: boolean;
  defaultOn: boolean;
  defaultLeadMinutes: LeadMinutes;
  /** HH:MM, household time. */
  morningTime: string;
  digestTime: string | null;
  quietStart: string | null;
  quietEnd: string | null;
  hidePrivateTitles: boolean;
}

/** What a person has before they change anything: off, the bell on, 15 minutes, 8:00 am. */
export const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: false,
  defaultOn: true,
  defaultLeadMinutes: 15,
  morningTime: '08:00',
  digestTime: null,
  quietStart: null,
  quietEnd: null,
  hidePrivateTitles: true,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (raw: FormDataEntryValue | null): string | null | 'bad' => {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const hhmm = s.slice(0, 5);
  return HHMM.test(hhmm) && (s.length === 5 || /^:00(\.0+)?$/.test(s.slice(5))) ? hhmm : 'bad';
};

export type ParsedSettings =
  { ok: true; value: Omit<ReminderSettings, 'enabled'> } | { ok: false; message: string };

/**
 * [CHR-16][CHR-17] The settings form, or a line saying what to fix. The digest and quiet hours are
 * each switched on by their checkbox; quiet hours need both ends, and may run past midnight.
 */
export function parseSettings(form: FormData): ParsedSettings {
  const lead = Number(form.get('defaultLeadMinutes'));
  if (!LEAD_CHOICES.some((c) => c.minutes === lead)) {
    return { ok: false, message: 'Choose when items remind you.' };
  }
  const morning = time(form.get('morningTime'));
  if (morning === null || morning === 'bad') {
    return { ok: false, message: 'Choose a morning time, like 08:00.' };
  }
  let digest: string | null = null;
  if (form.get('digest') === 'on') {
    const d = time(form.get('digestTime'));
    if (d === null || d === 'bad') return { ok: false, message: 'Choose a time for the digest.' };
    digest = d;
  }
  let quietStart: string | null = null;
  let quietEnd: string | null = null;
  if (form.get('quiet') === 'on') {
    const a = time(form.get('quietStart'));
    const b = time(form.get('quietEnd'));
    if (a === null || a === 'bad' || b === null || b === 'bad') {
      return { ok: false, message: 'Quiet hours need a start and an end.' };
    }
    if (a === b) return { ok: false, message: 'Quiet hours start and end at different times.' };
    quietStart = a;
    quietEnd = b;
  }
  return {
    ok: true,
    value: {
      defaultOn: form.get('defaultOn') === 'on',
      defaultLeadMinutes: lead as LeadMinutes,
      morningTime: morning,
      digestTime: digest,
      quietStart,
      quietEnd,
      hidePrivateTitles: form.get('hidePrivateTitles') === 'on',
    },
  };
}

/** The settings row as the database keeps it (times as HH:MM:SS), in the form's shape. */
export function readSettings(row: Record<string, unknown> | null): ReminderSettings {
  if (!row) return DEFAULT_SETTINGS;
  const hhmm = (v: unknown) => (typeof v === 'string' && v.length >= 5 ? v.slice(0, 5) : null);
  return {
    enabled: row.enabled === true,
    defaultOn: row.default_on !== false,
    defaultLeadMinutes: (LEAD_CHOICES.find((c) => c.minutes === row.default_lead_minutes)
      ?.minutes ?? 15) as LeadMinutes,
    morningTime: hhmm(row.morning_time) ?? '08:00',
    digestTime: hhmm(row.digest_time),
    quietStart: hhmm(row.quiet_start),
    quietEnd: hhmm(row.quiet_end),
    hidePrivateTitles: row.hide_private_titles !== false,
  };
}

/** [CHR-15] A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2000)
    .refine((u) => u.startsWith('https://'), 'a push endpoint is https'),
  keys: z.object({
    p256dh: z.string().min(40).max(200),
    auth: z.string().min(8).max(100),
  }),
});
export type BrowserSubscription = z.infer<typeof subscriptionSchema>;

/** [CHR-15] A name for the device a subscription came from: "iPhone · Safari", "Mac · Chrome". */
export function deviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh|Mac OS X/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Linux|CrOS/.test(ua)
              ? 'Computer'
              : 'This device';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua) || /CriOS\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null;
  return browser ? `${device} · ${browser}` : device;
}

/** "3:00 pm" from "15:00", as the brand writes times (06 §2). */
export function clockWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The settings in a line: "15 minutes before the due time · items with no time at 8:00 am · …". */
export function settingsSummary(s: ReminderSettings): string {
  return [
    s.defaultLeadMinutes === 0
      ? 'at the due time'
      : `${leadWords(s.defaultLeadMinutes)} the due time`,
    `items with no time at ${clockWords(s.morningTime)}`,
    s.digestTime ? `a digest at ${clockWords(s.digestTime)}` : null,
    s.quietStart && s.quietEnd
      ? `quiet ${clockWords(s.quietStart)} to ${clockWords(s.quietEnd)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
