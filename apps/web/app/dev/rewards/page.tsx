import type { Metadata } from 'next';
import type { RedemptionRow, RewardRow } from '../../(admin)/admin/rewards/data';
import { RewardsView } from '../../(admin)/admin/rewards/view';

// The rewards shop for a parent (WP-18) with a made-up family and no database, for the UI suite: the
// page's layout on a phone and a laptop, in Day and Evening (?theme=evening).
export const metadata: Metadata = { title: 'Rewards', robots: { index: false } };

const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
// A small teal square, standing in for a photo.
const PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#1f8a7a"/></svg>',
  );

const reward = (o: Partial<RewardRow> & Pick<RewardRow, 'id' | 'title'>): RewardRow => ({
  description: null,
  icon: 'gift',
  imagePath: null,
  imageUrl: null,
  costPoints: 30,
  stock: null,
  stockLeft: null,
  weeklyLimit: null,
  active: true,
  archivedAt: null,
  ...o,
});
const ask = (
  o: Partial<RedemptionRow> & Pick<RedemptionRow, 'id' | 'memberId' | 'itemId' | 'status'>,
): RedemptionRow => ({
  cost: 30,
  requestedAt: '2026-10-09T20:10:00Z',
  decidedAt: null,
  fulfilledAt: null,
  cancelledAt: null,
  note: null,
  ...o,
});

export default async function DevRewardsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const theme = (await searchParams).theme === 'evening' ? 'theme-evening' : 'theme-day';
  const catalog = [
    reward({
      id: 'r1',
      title: 'Movie night',
      icon: 'ticket',
      costPoints: 100,
      imageUrl: PHOTO,
      imagePath: 'x',
    }),
    reward({ id: 'r2', title: 'Ice cream trip', icon: 'snack', costPoints: 40, weeklyLimit: 1 }),
    reward({ id: 'r3', title: 'Pick the dinner', icon: 'utensils', stock: 2, stockLeft: 1 }),
    reward({ id: 'r4', title: 'Stay up late', icon: 'moon', costPoints: 25, active: false }),
    reward({ id: 'r5', title: 'Old prize', archivedAt: '2026-10-01T00:00:00Z' }),
  ];
  const redemptions = [
    ask({ id: 'a1', memberId: LEO, itemId: 'r3', status: 'requested' }),
    ask({ id: 'a2', memberId: MAYA, itemId: 'r1', status: 'requested', cost: 100 }),
    ask({ id: 'a3', memberId: MAYA, itemId: 'r2', status: 'approved', cost: 40 }),
    ask({ id: 'a4', memberId: LEO, itemId: 'r4', status: 'fulfilled', cost: 25 }),
    ask({ id: 'a5', memberId: MAYA, itemId: 'r2', status: 'denied', cost: 40 }),
  ];
  return (
    <div className={`admin ${theme}`}>
      <RewardsView
        catalog={catalog}
        redemptions={redemptions}
        members={[
          { id: MAYA, displayName: 'Maya' },
          { id: LEO, displayName: 'Leo' },
        ]}
        balances={
          new Map([
            [MAYA, 120],
            [LEO, 64],
          ])
        }
        timezone="America/New_York"
        notice="Approved. The points are spent."
        error={null}
      />
    </div>
  );
}
