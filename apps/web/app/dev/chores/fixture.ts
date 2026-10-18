// [CHR-21] The made-up family's chores and tasks, as the WP-96 mockup draws them: today is Wed,
// Oct 14, 2026 in America/Chicago, the week starts on Sunday. No real family's data.
import type { IconName } from '@familywise/ui';
import type { OnceOccurrence } from '@/lib/chore-sections';
import type { Schedule } from '@/lib/chores';
import type { ChoreRow, TagRow } from '../../(admin)/admin/chores/data';
import type { MemberRow } from '../../(admin)/admin/members/data';

export const TODAY = '2026-10-14';
export const TIME_ZONE = 'America/Chicago';
export const WEEK_START = 0;

export const MAYA = 'c5100000-0000-4000-8000-000000000001';
export const LEO = 'c5100000-0000-4000-8000-000000000002';
export const ALEX = 'c5100000-0000-4000-8000-000000000003';
export const SAM = 'c5100000-0000-4000-8000-000000000004';

const member = (
  id: string,
  displayName: string,
  role: 'child' | 'adult',
  avatarKey: MemberRow['avatarKey'],
  color: MemberRow['color'],
): MemberRow => ({
  id,
  displayName,
  role,
  avatarKey,
  color,
  birthYear: null,
  earnsRewards: role === 'child',
  userId: null,
  archivedAt: null,
});
export const MEMBERS: MemberRow[] = [
  member(MAYA, 'Maya', 'child', 'fox', 'member-3'),
  member(LEO, 'Leo', 'child', 'frog', 'member-4'),
  member(ALEX, 'Alex', 'adult', 'owl', 'member-1'),
  member(SAM, 'Sam', 'adult', 'bear', 'member-2'),
];

export const TAGS: TagRow[] = [
  {
    id: 'c5700000-0000-4000-8000-000000000001',
    name: 'Kitchen',
    color: 'member-3',
    icon: null,
    archivedAt: null,
  },
  {
    id: 'c5700000-0000-4000-8000-000000000002',
    name: 'Morning',
    color: 'member-6',
    icon: null,
    archivedAt: null,
  },
  {
    id: 'c5700000-0000-4000-8000-000000000003',
    name: 'School',
    color: 'member-1',
    icon: null,
    archivedAt: null,
  },
];
const [KITCHEN, MORNING, SCHOOL] = TAGS.map((t) => t.id) as [string, string, string];

let n = 0;
const ALL_DAYS: ChoreRow['dayTypes'] = ['school_day', 'no_school', 'break', 'weekend', 'summer'];
function item(
  title: string,
  icon: IconName,
  kind: 'chore' | 'task',
  schedule: Schedule,
  assignees: string[],
  extra: Partial<ChoreRow> = {},
): ChoreRow {
  n += 1;
  return {
    id: `c5400000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title,
    icon,
    kind,
    points: 0,
    approval: 'inherit',
    assignment: 'shared',
    lunchDays: null,
    schedule,
    dueTime: null,
    dayTypes: ALL_DAYS,
    visibility: 'family',
    createdBy: null,
    remindLeadMinutes: null,
    opens: null,
    archivedAt: null,
    assignees,
    tags: [],
    ...extra,
  };
}
const once = (on_date: string): Schedule => ({ freq: 'once', on_date });
const daily: Schedule = { freq: 'daily' };
const weekly = (...by_weekday: number[]): Schedule => ({ freq: 'weekly', by_weekday });
const monthly = (...by_month_day: number[]): Schedule => ({ freq: 'monthly', by_month_day });
const each = { assignment: 'each' as const };

// Scheduled: one-time items not done yet.
export const SCHEDULED = [
  item('Book the dentist', 'stethoscope', 'task', once('2026-10-12'), [ALEX]),
  item('Return the library books', 'book', 'task', once('2026-10-13'), [MAYA], { points: 5 }),
  item('Pay the school trip fee', 'wallet', 'task', once('2026-10-14'), [SAM], {
    dueTime: '18:00',
  }),
  item('Pack for the sleepover', 'chore-pack', 'chore', once('2026-10-14'), [MAYA], {
    dueTime: '19:00',
    points: 5,
  }),
  item('Buy Leo’s football boots', 'shirt', 'task', once('2026-10-16'), [SAM]),
  item('Wash the car', 'car', 'chore', once('2026-10-17'), [MAYA, LEO], {
    ...each,
    dueTime: '10:00',
    points: 15,
  }),
  item('Carve the pumpkins', 'scissors', 'chore', once('2026-10-31'), [MAYA, LEO], {
    ...each,
    dueTime: '16:00',
    points: 10,
  }),
  item('Renew the passports', 'ticket', 'task', once('2026-11-09'), [ALEX]),
  item('Anniversary gift', 'gift', 'task', once('2026-11-21'), [SAM], { visibility: 'private' }),
];

// Recurring: everything that repeats.
export const RECURRING = [
  item('Make bed', 'chore-bed', 'chore', daily, [MAYA, LEO], {
    ...each,
    dueTime: '07:30',
    points: 5,
    tags: [MORNING],
  }),
  item('Brush teeth', 'chore-teeth', 'chore', daily, [MAYA, LEO], {
    dueTime: '07:45',
    points: 2,
    tags: [MORNING],
  }),
  item('Homework', 'chore-homework', 'chore', weekly(1, 2, 3, 4, 5), [MAYA, LEO], {
    dueTime: '16:00',
    points: 10,
    dayTypes: ['school_day'],
    tags: [SCHOOL],
  }),
  item('Feed the dog', 'chore-pet', 'chore', daily, [MAYA], { dueTime: '17:00', points: 5 }),
  item('Set the table', 'chore-table', 'chore', daily, [LEO], {
    dueTime: '18:00',
    points: 5,
    tags: [KITCHEN],
  }),
  item('Take out the bins', 'chore-bin', 'chore', weekly(2), [ALEX], { dueTime: '19:00' }),
  item('Water the plants', 'chore-plant', 'chore', weekly(6), [LEO], { points: 5 }),
  item('Pick next week’s lunches', 'utensils', 'task', weekly(7), [MAYA, LEO], {
    points: 5,
    tags: [KITCHEN],
  }),
  item('Change the furnace filter', 'wrench', 'task', monthly(1), [ALEX]),
  item('Pay pocket money', 'piggy-bank', 'task', monthly(1), [SAM]),
];
/** The furnace filter is a recurring task left open since Oct 1. */
export const OVERDUE_SINCE: Record<string, string> = { [RECURRING[8]!.id]: '2026-10-01' };

// Completed: one-time items done (or a chore missed), with the day each was finished.
const done = (
  title: string,
  icon: IconName,
  kind: 'chore' | 'task',
  on: string,
  who: string[],
  points = 0,
) => item(title, icon, kind, once(on), who, { points, ...(who.length > 1 ? each : {}) });
export const COMPLETED = [
  done('Book the pumpkin patch tickets', 'ticket', 'task', '2026-10-13', [SAM]),
  done('Clean out the garage', 'archive', 'chore', '2026-10-11', [MAYA, LEO], 20),
  done('Practise for the recital', 'chore-music', 'chore', '2026-10-10', [MAYA], 10),
  done('Sign the field trip form', 'pen-line', 'task', '2026-10-09', [ALEX]),
  done('Make Leo’s birthday card', 'party-popper', 'chore', '2026-10-07', [MAYA], 10),
  done('Pump up the bike tyres', 'bike', 'chore', '2026-10-03', [LEO], 5),
  done('Plant the bulbs', 'chore-plant', 'chore', '2026-09-27', [LEO], 10),
  done('Fill in the school photo form', 'pen-line', 'task', '2026-09-24', [SAM]),
  done('Pack the camping bags', 'chore-pack', 'chore', '2026-09-18', [MAYA, LEO], 15),
  done('Book the flu shots', 'stethoscope', 'task', '2026-09-15', [ALEX]),
  done('Wrap the teacher’s gift', 'gift', 'chore', '2026-09-12', [MAYA], 5),
  done('Return the rental skates', 'bike', 'task', '2026-09-08', [SAM]),
  done('Clear out the toy box', 'archive', 'chore', '2026-09-05', [LEO], 10),
];
/** "Practise for the recital" was missed: not done on its day. */
const MISSED = COMPLETED[2]!.id;

/** For Show older: 13 more done in the summer, so Completed holds 26. */
export const OLDER = Array.from({ length: 13 }, (_, i) =>
  done(
    ['Sort the summer clothes', 'Wash the paddling pool', 'Pick the blackberries'][i % 3]!,
    (['shirt', 'chore-plant', 'utensils'] as const)[i % 3]!,
    i % 2 ? 'task' : 'chore',
    `2026-08-${String(30 - i * 2).padStart(2, '0')}`,
    [[MAYA], [LEO], [SAM]][i % 3]!,
    i % 2 ? 0 : 5,
  ),
);

// Archived: anything archived, newest first.
export const ARCHIVED = [
  item('Recorder practice', 'chore-music', 'chore', weekly(1, 2, 3, 4, 5), [LEO], {
    dayTypes: ['school_day'],
    archivedAt: '2026-10-02T15:00:00Z',
  }),
  item('Swim bag ready', 'chore-pack', 'chore', weekly(1), [MAYA], {
    archivedAt: '2026-09-14T15:00:00Z',
  }),
  item('Sell the old bike', 'bike', 'task', once('2026-08-30'), [ALEX], {
    archivedAt: '2026-09-01T15:00:00Z',
  }),
];

/** Each one-time item's occurrences: one per person for an "each" item, else one shared. */
export function occurrencesOf(items: ChoreRow[]): OnceOccurrence[] {
  const out: OnceOccurrence[] = [];
  const finished = new Set([...COMPLETED, ...OLDER].map((c) => c.id));
  for (const c of items) {
    if (c.schedule.freq !== 'once') continue;
    const date = c.schedule.on_date;
    // Planned two weeks ahead: the pumpkins (Oct 31) and later have no occurrence yet.
    if (date > '2026-10-28') continue;
    const whose = c.assignment === 'each' ? c.assignees : [null];
    for (const m of whose) {
      const status =
        c.id === MISSED
          ? 'missed'
          : finished.has(c.id)
            ? 'completed'
            : c.title === 'Wash the car' && m === MAYA
              ? 'completed'
              : 'scheduled';
      out.push({
        choreId: c.id,
        dueDate: date,
        memberId: m,
        status,
        changedAt: status === 'scheduled' ? null : `${date}T23:00:00Z`,
      });
    }
  }
  return out;
}
