import type { PenaltyPerson } from '../(admin)/admin/penalties/give-form';
import type { Penalty, PenaltyPayment, PenaltyReason } from '@/lib/penalties';
import { withOwed } from '@/lib/penalties';

// [PTS-09] The made-up family's penalties (WP-120, the approved mockup), for the dev pages, the UI
// suite and the guide: four reasons; Maya owes $3 (the bike $1, the homework folder $2, $2 of $4
// paid), lost 10 points today for being rude to a sibling, and had one taken back. Names are invented.

export const PENALTY_REASONS: PenaltyReason[] = [
  {
    id: '0de0e000-0000-4000-8000-000000000001',
    name: 'Rude to a sibling',
    unit: 'points',
    amount: 10,
  },
  {
    id: '0de0e000-0000-4000-8000-000000000002',
    name: 'Screen time after bedtime',
    unit: 'points',
    amount: 20,
  },
  {
    id: '0de0e000-0000-4000-8000-000000000003',
    name: 'Left bike in the driveway',
    unit: 'money',
    amount: 100,
  },
  {
    id: '0de0e000-0000-4000-8000-000000000004',
    name: 'Homework folder not home',
    unit: 'money',
    amount: 200,
  },
];

export const PENALTY_PEOPLE: PenaltyPerson[] = [
  {
    id: '0de00000-0000-4000-8000-0000000000c1',
    displayName: 'Maya',
    avatarKey: 'fox',
    color: 'member-3',
  },
  {
    id: '0de00000-0000-4000-8000-0000000000c2',
    displayName: 'Leo',
    avatarKey: 'frog',
    color: 'member-4',
  },
];

/** Who did it, by user id. */
export const PENALTY_ADMINS: Record<string, string> = { 'u-alex': 'Alex', 'u-sam': 'Sam' };

/** Maya's penalties and payments, dated from `today` (YYYY-MM-DD) back. */
export function mayaPenalties(today: string): { penalties: Penalty[]; payments: PenaltyPayment[] } {
  const at = (daysBack: number, hm: string) => {
    const d = new Date(`${today}T${hm}:00Z`);
    d.setUTCDate(d.getUTCDate() - daysBack);
    return d.toISOString();
  };
  const maya = PENALTY_PEOPLE[0]!.id;
  const base = { memberId: maya, takenBackAt: null, takenBackBy: null };
  const payments: PenaltyPayment[] = [
    {
      id: '0de0f100-0000-4000-8000-000000000001',
      penaltyId: '0de0f000-0000-4000-8000-000000000002',
      amount: 200,
      recordedAt: at(1, '23:10'),
      recordedBy: 'u-sam',
    },
  ];
  const penalties = withOwed(
    [
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000004',
        reason: 'Rude to a sibling',
        unit: 'points',
        amount: 10,
        givenAt: at(0, '23:40'),
        givenBy: 'u-sam',
      },
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000002',
        reason: 'Homework folder not home',
        unit: 'money',
        amount: 400,
        givenAt: at(2, '22:00'),
        givenBy: 'u-alex',
      },
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000003',
        reason: 'Screen time after bedtime',
        unit: 'points',
        amount: 20,
        givenAt: at(2, '02:00'),
        givenBy: 'u-alex',
        takenBackAt: at(2, '13:00'),
        takenBackBy: 'u-alex',
      },
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000001',
        reason: 'Left bike in the driveway',
        unit: 'money',
        amount: 100,
        givenAt: at(3, '16:00'),
        givenBy: 'u-alex',
      },
    ],
    payments,
  );
  return { penalties, payments };
}
