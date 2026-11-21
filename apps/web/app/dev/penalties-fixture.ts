import type { PenaltyPerson } from '../(admin)/admin/penalties/give-form';
import type { Penalty, PenaltyPayment, PenaltyReason } from '@/lib/penalties';
import { withOwed } from '@/lib/penalties';
import type { PenaltyRule, RuleChore } from '@/lib/penalty-rules';

// [PTS-09] The made-up family's penalties (WP-120, the approved mockup), for the dev pages, the UI
// suite and the guide: four reasons; Maya owes $3 (the bike $1, and $2 on the rule "Folder home" for
// missing her homework folder the last two days, WP-121), lost 10 points today for being rude to a
// sibling, and had one taken back; Leo has the rule "Bed by 8" with nothing taken yet. Names are
// invented.

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
    amount: 100,
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
  const payments: PenaltyPayment[] = [];
  const day = (daysBack: number) => at(daysBack, '12:00').slice(0, 10);
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
      // [PTS-10] The rule "Folder home": the homework folder missed yesterday and the day before.
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000006',
        reason: 'Folder home',
        unit: 'money',
        amount: 100,
        givenAt: at(0, '05:05'),
        givenBy: null,
        ruleId: PENALTY_RULE_IDS.folder,
        missedOn: day(1),
      },
      {
        ...base,
        id: '0de0f000-0000-4000-8000-000000000005',
        reason: 'Folder home',
        unit: 'money',
        amount: 100,
        givenAt: at(1, '05:05'),
        givenBy: null,
        ruleId: PENALTY_RULE_IDS.folder,
        missedOn: day(2),
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

export const PENALTY_RULE_IDS = {
  folder: '0de0a900-0000-4000-8000-000000000001',
  bed: '0de0a900-0000-4000-8000-000000000002',
};

/** The chores a rule can link, as the rule form lists them. */
export const RULE_CHORES: RuleChore[] = [
  {
    id: '0de0c000-0000-4000-8000-000000000001',
    title: 'Homework folder home',
    schoolDays: true,
    assignees: [PENALTY_PEOPLE[0]!.id],
  },
  {
    id: '0de0c000-0000-4000-8000-000000000002',
    title: 'Reading, 20 minutes',
    schoolDays: false,
    assignees: [PENALTY_PEOPLE[0]!.id],
  },
  {
    id: '0de0c000-0000-4000-8000-000000000003',
    title: 'Lights out by 8',
    schoolDays: false,
    assignees: [PENALTY_PEOPLE[1]!.id],
  },
];

export const RULE_TAGS = [
  { id: '0de0a000-0000-4000-8000-000000000003', name: 'Bedtime' },
  { id: '0de0a000-0000-4000-8000-000000000004', name: 'School' },
];

/**
 * [PTS-10] The family's penalty rules (WP-121, the approved mockup), dated from `today`: "Folder home",
 * $1 a missed school day for Maya, max $10, from 3 days ago for about ten weeks (she owes $2 on it);
 * "Bed by 8", 5 points a miss of a Bedtime chore for Leo, max 25 (nothing taken yet).
 */
export function penaltyRules(today: string): PenaltyRule[] {
  const shift = (days: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const [maya, leo] = PENALTY_PEOPLE.map((p) => p.id);
  return [
    {
      id: PENALTY_RULE_IDS.folder,
      name: 'Folder home',
      reasonId: PENALTY_REASONS[3]!.id,
      unit: 'money',
      amount: 100,
      max: 1000,
      scope: 'items',
      tagId: null,
      tagName: null,
      chores: [RULE_CHORES[0]!],
      memberIds: [maya!],
      startDate: shift(-3),
      endDate: shift(73),
      held: { [maya!]: 200 },
    },
    {
      id: PENALTY_RULE_IDS.bed,
      name: 'Bed by 8',
      reasonId: PENALTY_REASONS[1]!.id,
      unit: 'points',
      amount: 5,
      max: 25,
      scope: 'tag',
      tagId: RULE_TAGS[0]!.id,
      tagName: 'Bedtime',
      chores: [],
      memberIds: [leo!],
      startDate: shift(-17),
      endDate: shift(43),
      held: {},
    },
  ];
}
