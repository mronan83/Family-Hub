import type { Metadata } from 'next';
import { PenaltySettingsView } from '../../../(admin)/admin/settings/penalties/view';
import { PENALTY_REASONS } from '../../penalties-fixture';

// [PTS-09] Settings, Penalties (WP-120) with the made-up family and no database, for the UI suite and
// the side-by-side: penalties on with four reasons. ?state=off for a new family's (off, no reasons);
// ?theme=evening; ?notice= one of its notices.
export const metadata: Metadata = { title: 'Penalties', robots: { index: false } };

export default async function DevPenaltySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string; notice?: string }>;
}) {
  const p = await searchParams;
  const off = p.state === 'off';
  return (
    <div className={`admin ${p.theme === 'evening' ? 'theme-evening' : 'theme-day'}`}>
      <PenaltySettingsView
        on={!off}
        reasons={off ? [] : PENALTY_REASONS}
        notice={p.notice ?? null}
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
