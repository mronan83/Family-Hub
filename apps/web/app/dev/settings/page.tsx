import type { Metadata } from 'next';
import type { StatusLine } from '@/lib/settings-status';
import { SettingsView } from '../../(admin)/admin/settings/view';

// Settings and the admin menu (WP-51) with the made-up family and no database, for the UI suite and
// the guide: Alex signed in, two check-offs waiting, School's calendar behind. ?theme=evening;
// ?state=quiet for a household with nothing to look at.
export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function DevSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const quiet = params.state === 'quiet';
  const ok = (text: string): StatusLine => ({ text, warn: false });
  return (
    <div className={`admin ${theme}`}>
      <SettingsView
        waiting={quiet ? 0 : 2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
        status={{
          '/admin/settings/family': ok('Week starts Sunday · check-offs count at once'),
          '/admin/school': ok('2026–27 · ends Jun 18'),
          '/admin/calendars': quiet ? ok('3 calendars') : { text: 'School can’t sync', warn: true },
          '/admin/devices': ok('Kitchen'),
          '/admin/tags': ok('6 tags'),
          '/admin/reminders': ok('On for 2 devices'),
          '/admin/health': quiet
            ? ok('Everything is running')
            : { text: '1 thing to look at', warn: true },
        }}
      />
    </div>
  );
}
