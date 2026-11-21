import type { Metadata } from 'next';
import type { MemberRow } from '../../(admin)/admin/members/data';
import { MembersView, MemberView } from '../../(admin)/admin/members/view';
import type { LedgerEntry } from '@/lib/points';
import { memberOpen } from '@/lib/reward-facts';
import type { DayItem } from '@/lib/admin-day';
import { type CheckOff, missedOrLate } from '@/lib/on-time';
import { MemberPenalties } from '../../(admin)/admin/penalties/member-penalties';
import {
  mayaPenalties,
  PENALTY_ADMINS,
  PENALTY_PEOPLE,
  PENALTY_REASONS,
  penaltyRules,
} from '../penalties-fixture';

// [ACC-04][PTS-01][NFR-18] Members and a member's page (WP-95) with the made-up family and no
// database, for the UI suite and the side-by-side: Alex and Sam (adults), Maya and Leo (children),
// Grandpa Joe archived. ?page=member for Maya's page; ?adjusted=5 as after a change of points, Points
// open; ?archived=1 as after an archive, Archived open; ?theme=evening. Thursday, Oct 15, 2026.
// [CHR-24] ?late=1: Maya's Missed or late open (WP-117), one missed, one ticked late and one marked on
// time; ?late=open also opens the missed one's Done on time…. [PTS-09] ?penalties=1: penalties on and
// Maya's Penalties open (WP-120): she owes $3, with today's points penalty and one taken back;
// ?penalties=give also opens Give a penalty. [PTS-10] She owes $2 of it on the rule "Folder home",
// missed Tue and Wed (WP-121).
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

/** [CHR-24] Maya's chores of the last 14 days that WP-117's Missed or late lists. */
function lateFixture(mayaId: string, scene: string) {
  const ids = (k: number) => `e3000000-0000-4000-8000-${String(k).padStart(12, '0')}`;
  const chore = (k: number, o: Partial<DayItem>): DayItem => ({
    id: ids(k),
    choreId: `c-late-${k}`,
    title: 'Homework folder home',
    icon: 'chore-homework',
    kind: 'chore',
    dueDate: '2026-10-13',
    dueTime: '15:30',
    memberId: mayaId,
    assignees: [mayaId],
    status: 'missed',
    doneBy: [],
    points: 5,
    ...o,
  });
  const items = [
    chore(1, {}),
    chore(2, {
      title: 'Piano practice',
      icon: 'list-check',
      dueDate: '2026-10-12',
      dueTime: '16:30',
      status: 'completed',
      doneBy: [mayaId],
    }),
    chore(3, { dueDate: '2026-10-07', status: 'approved', doneBy: [mayaId] }),
    chore(4, {
      title: 'Make bed',
      icon: 'chore-bed',
      dueDate: '2026-10-14',
      dueTime: '07:30',
      status: 'completed',
      doneBy: [mayaId],
    }),
  ];
  const checks = new Map<string, CheckOff>([
    [
      ids(2),
      {
        checkedAt: '2026-10-12T18:05',
        markedOnTime: false,
        onTimeAt: null,
        markedBy: null,
        markedOn: null,
      },
    ],
    [
      ids(3),
      {
        checkedAt: '2026-10-08T07:40',
        markedOnTime: true,
        onTimeAt: '15:45',
        markedBy: 'Sam',
        markedOn: '2026-10-08',
      },
    ],
    [
      ids(4),
      {
        checkedAt: '2026-10-14T07:10',
        markedOnTime: false,
        onTimeAt: null,
        markedBy: null,
        markedOn: null,
      },
    ],
  ]);
  const now = '2026-10-15T11:00';
  return {
    rows: missedOrLate(
      items.map((i) => ({ ...i, checkOff: checks.get(i.id) ?? null })),
      checks,
      now,
      '2026-10-02',
    ),
    onTime: {
      now,
      returnTo: `/admin/members/${mayaId}?open=late`,
      goals: new Map([[ids(1), ['Homework home every school day']]]),
      open: scene === 'open' ? ids(1) : null,
    },
    people: MEMBERS.filter((m) => !m.archivedAt),
    open: true,
    notice: null,
    error: null,
  };
}

export default async function DevMembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    theme?: string;
    page?: string;
    adjusted?: string;
    archived?: string;
    late?: string;
    penalties?: string;
  }>;
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
          late={p.late ? lateFixture(maya.id, p.late) : null}
          penalties={
            p.penalties ? (
              <MemberPenalties
                person={{ ...PENALTY_PEOPLE[0]!, id: maya.id }}
                on
                canGive
                {...mayaPenalties('2026-10-15')}
                reasons={PENALTY_REASONS}
                requestId="d0000000-0000-4000-8000-000000000002"
                adminName={(id) => PENALTY_ADMINS[id] ?? 'Sam'}
                timezone="America/New_York"
                today="2026-10-15"
                notice={null}
                open
                giveOpen={p.penalties === 'give'}
                rules={penaltyRules('2026-10-15')}
              />
            ) : null
          }
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
