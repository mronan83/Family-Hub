import type { Metadata } from 'next';
import { DEFAULT_SETTINGS, type ReminderSettings } from '@/lib/reminder-settings';
import type { DeviceRow } from '../../(admin)/admin/reminders/data';
import { RemindersView } from '../../(admin)/admin/reminders/view';

// A person's reminders (WP-40) with made-up devices and no database, for the UI suite: the page's
// layout on a phone and a laptop, in Day and Evening (?theme=evening). ?state=off for reminders not
// yet turned on, ?state=unlinked for a sign-in not linked to a member, ?keys=none for a site without
// web push keys.
export const metadata: Metadata = { title: 'Reminders', robots: { index: false } };

// A well-formed public key (65 bytes, base64url); nothing is ever sent with it here.
const KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

const ON: ReminderSettings = {
  enabled: true,
  defaultOn: true,
  defaultLeadMinutes: 15,
  morningTime: '08:00',
  digestTime: '07:00',
  quietStart: '21:00',
  quietEnd: '07:00',
  hidePrivateTitles: true,
};
const DEVICES: DeviceRow[] = [
  {
    id: 'd1000000-0000-4000-8000-000000000001',
    label: 'iPhone · Safari',
    enabled: true,
    createdAt: '2026-10-08T14:00:00Z',
    lastSuccessAt: '2026-10-10T13:45:00Z',
    failureCount: 0,
  },
  {
    id: 'd1000000-0000-4000-8000-000000000002',
    label: 'Mac · Chrome',
    enabled: false,
    createdAt: '2026-10-09T18:30:00Z',
    lastSuccessAt: null,
    failureCount: 0,
  },
];

export default async function DevRemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string; keys?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const off = params.state === 'off';
  return (
    <div className={`admin ${theme}`}>
      <RemindersView
        me={params.state === 'unlinked' ? null : 'f1000000-0000-4000-8000-000000000003'}
        settings={off ? DEFAULT_SETTINGS : ON}
        devices={off ? [] : DEVICES}
        vapidKey={params.keys === 'none' ? null : KEY}
        timezone="America/New_York"
        notice={off ? null : 'Saved.'}
        error={null}
      />
    </div>
  );
}
