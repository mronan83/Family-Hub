import type { Metadata } from 'next';
import type { MemberRow } from '../../(admin)/admin/members/data';
import { MembersView, MemberView } from '../../(admin)/admin/members/view';
import type { LedgerEntry } from '@/lib/points';
import { memberOpen } from '@/lib/reward-facts';

// [ACC-04][PTS-01][NFR-18] Members and a member's page (WP-95) with the made-up family and no
// database, for the UI suite and the side-by-side: Alex and Sam (adults), Maya and Leo (children),
// Grandpa Joe archived. ?page=member for Maya's page; ?adjusted=5 as after a change of points, Points
// open; ?archived=1 as after an archive, Archived open; ?theme=evening. Thursday, Oct 15, 2026.
export const metadata: Metadata = { title: 'Members', robots: { index: false } };

const ALEX_USER = 'a1000000-0000-4000-8000-000000000001';
const SAM_USER = 'a1000000-0000-4000-8000-000000000002';
const member = (n: number, o: Partial<MemberRow> & Pick<MemberRow, 'displayName'>): MemberRow => ({
  id: `f2000000-0000-4000-8000-00000000000${n}`,
  role: 'child',
  avatarKey: null,
  color: 'member-1',
  birthYear: null,
  earnsRewards: true,
  userId: null,
  archivedAt: null,
  ...o,
});
const MEMBERS = [
  member(1, {
    displayName: 'Alex',
    role: 'adult',
    avatarKey: 'owl',
    earnsRewards: false,
    userId: ALEX_USER,
  }),
  member(2, {
    displayName: 'Sam',
    role: 'adult',
    color: 'member-2',
    earnsRewards: false,
    userId: SAM_USER,
  }),
  member(3, {
    displayName: 'Maya',
    avatarKey: 'fox',
    color: 'member-3',
    birthYear: 2016,
  }),
  member(4, { displayName: 'Leo', avatarKey: 'frog', color: 'member-4', birthYear: 2018 }),
  member(5, {
    displayName: 'Grandpa Joe',
    role: 'adult',
    color: 'member-5',
    earnsRewards: false,
    archivedAt: '2026-08-12T15:00:00Z',
  }),
];
const ADMINS = [
  { userId: ALEX_USER, email: 'alex@example.com' },
  { userId: SAM_USER, email: 'sam@example.com' },
];
const entry = (
  n: number,
  type: LedgerEntry['type'],
  amount: number,
  at: string,
  label: string,
  by: string | null = null,
): LedgerEntry => ({ id: `e${n}`, type, amount, at, label, by });
/** Maya's latest points, newest first: 142 in all. */
const ENTRIES = [
  entry(1, 'earn', 5, '2026-10-15T11:10:00Z', 'Make bed'),
  entry(2, 'spend', -60, '2026-10-14T23:30:00Z', 'Movie night'),
  entry(3, 'adjustment', 10, '2026-10-14T21:00:00Z', 'Helped with the groceries', ALEX_USER),
  entry(4, 'earn', 5, '2026-10-14T11:20:00Z', 'Make bed'),
  entry(5, 'bonus', 20, '2026-10-12T05:00:00Z', '7 good days in a row'),
];

export default async function DevMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; page?: string; adjusted?: string; archived?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const maya = MEMBERS[2]!;
  return (
    <div className={`admin ${theme}`}>
      {p.page === 'member' ? (
        <MemberView
          member={maya}
          admins={[]}
          elsewhere={[
            { email: 'alex@example.com', name: 'Alex', archived: false },
            { email: 'sam@example.com', name: 'Sam', archived: false },
          ]}
          offerMe={null}
          linked={false}
          linkError={null}
          points={{ balance: 142, entries: ENTRIES }}
          adminName={(id) => (id === ALEX_USER ? 'Alex' : 'Sam')}
          timezone="America/New_York"
          today="2026-10-15"
          adjusted={Number(p.adjusted)}
          pointsOpen={memberOpen(p).points}
          requestId="d0000000-0000-4000-8000-000000000001"
        />
      ) : (
        <MembersView
          members={MEMBERS}
          emailOf={new Map(ADMINS.map((a) => [a.userId, a.email]))}
          balances={
            new Map([
              [MEMBERS[2]!.id, 142],
              [MEMBERS[3]!.id, 87],
            ])
          }
          archivedOpen={Boolean(p.archived)}
        />
      )}
    </div>
  );
}
