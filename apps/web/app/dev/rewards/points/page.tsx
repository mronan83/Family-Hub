import type { Metadata } from 'next';
import type { BonusRule } from '@/lib/bonus';
import { isoDay } from '@/lib/format';
import {
  type MemberTotal,
  parseRegisterQuery,
  type RegisterEntry,
  type RegisterFilters,
  shownCount,
} from '@/lib/points-register';
import { RegisterView } from '../../../(admin)/admin/rewards/register-view';

// [PTS-08] The points register (WP-115) with a made-up family and no database, for the UI suite and the
// side-by-side with its mockup: the demo family on Tuesday, Oct 27, 2026, its entries filtered here as
// points_register() filters them. ?theme=evening for Evening; the filters as on the real page.
export const metadata: Metadata = { title: 'Points register', robots: { index: false } };

const ZONE = 'America/Chicago';
const TODAY = '2026-10-27';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const ALEX = 'f2000000-0000-4000-8000-0000000000a1';
const SAM = 'f2000000-0000-4000-8000-0000000000a2';
const ALL_DONE = 'f3000000-0000-4000-8000-000000000001';
const SEVEN = 'f3000000-0000-4000-8000-000000000002';
const THIRTY = 'f3000000-0000-4000-8000-000000000003';
const GOAL = 'f4000000-0000-4000-8000-000000000001';

const RULES: BonusRule[] = [
  { id: ALL_DONE, ruleType: 'all_done_bonus', streakDays: null, bonusPoints: 5 },
  { id: SEVEN, ruleType: 'streak_bonus', streakDays: 7, bonusPoints: 20 },
  { id: THIRTY, ruleType: 'streak_bonus', streakDays: 30, bonusPoints: 50 },
].map((r) => ({ ...r, countsFrom: '2026-10-01', active: true, archivedAt: null }) as BonusRule);

let n = 0;
/** An entry at a time in Chicago (CDT, UTC−5, until Nov 1). */
const at = (day: string, hm: string) => new Date(Date.parse(`${day}T${hm}:00-05:00`)).toISOString();
const entry = (
  memberId: string,
  day: string,
  hm: string,
  o: Partial<RegisterEntry> & Pick<RegisterEntry, 'kind' | 'amount'>,
): RegisterEntry => ({
  id: `f9000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  memberId,
  at: at(day, hm),
  reason: null,
  forItem: false,
  itemTitle: null,
  goalId: null,
  goalTitle: null,
  ruleId: null,
  byType: 'system',
  by: null,
  ...o,
});
const earn = (who: string, day: string, hm: string, title: string | null, pts: number) =>
  entry(who, day, hm, { kind: 'earn', amount: pts, forItem: true, itemTitle: title });
const allDone = (who: string, day: string) =>
  entry(who, day, '02:05', {
    kind: 'bonus',
    amount: 5,
    reason: 'Everything done',
    ruleId: ALL_DONE,
  });

const dayBefore = (day: string, k: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - k * 86_400_000).toISOString().slice(0, 10);

/** The mockup's entries, newest first, then a month of older days. */
function entries(): RegisterEntry[] {
  n = 0;
  const list: RegisterEntry[] = [
    earn(LEO, TODAY, '18:58', 'Feed the dog', 5),
    entry(MAYA, TODAY, '18:40', {
      kind: 'spend',
      amount: -100,
      reason: 'Movie night',
      byType: 'admin',
      by: ALEX,
    }),
    entry(MAYA, TODAY, '16:15', {
      kind: 'adjustment',
      amount: 10,
      reason: 'Helped carry the groceries',
      byType: 'admin',
      by: SAM,
    }),
    allDone(LEO, TODAY),
    entry(MAYA, TODAY, '02:05', {
      kind: 'bonus',
      amount: 20,
      reason: '7 good days in a row',
      ruleId: SEVEN,
    }),
    entry(MAYA, '2026-10-26', '20:12', {
      kind: 'reversal',
      amount: -5,
      forItem: true,
      itemTitle: 'Make bed',
    }),
    entry(MAYA, '2026-10-26', '19:31', {
      kind: 'goal',
      amount: 25,
      reason: 'Read 5 books',
      goalId: GOAL,
      goalTitle: 'Read 5 books',
    }),
    earn(LEO, '2026-10-26', '19:02', null, 3),
    entry(LEO, '2026-10-26', '17:20', {
      kind: 'refund',
      amount: 30,
      reason: 'Pick the dinner',
      byType: 'admin',
      by: SAM,
    }),
    earn(MAYA, '2026-10-26', '07:45', 'Brush teeth', 2),
    allDone(MAYA, '2026-10-25'),
    allDone(LEO, '2026-10-25'),
  ];
  // Older days: each child makes their bed and brushes their teeth, with the odd perfect day.
  for (let k = 3; k <= 33; k++) {
    const day = dayBefore(TODAY, k);
    if (k === 5) {
      list.push(
        entry(MAYA, day, '18:10', {
          kind: 'spend',
          amount: -40,
          reason: 'Ice cream trip',
          byType: 'admin',
          by: SAM,
        }),
      );
    }
    if (k === 10) {
      list.push(
        entry(MAYA, day, '11:02', {
          kind: 'adjustment',
          amount: -15,
          reason: 'Lost the library book',
          byType: 'admin',
          by: ALEX,
        }),
      );
    }
    list.push(earn(MAYA, day, '07:45', 'Brush teeth', 2), earn(LEO, day, '07:40', 'Make bed', 5));
    if (k % 3 === 0) list.push(allDone(MAYA, day));
    if (k % 4 === 0) list.push(allDone(LEO, day));
  }
  return list.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

/** The fixture filtered as points_register() filters, in the household's own days. */
function filtered(all: RegisterEntry[], f: RegisterFilters): RegisterEntry[] {
  return all.filter((e) => {
    const day = isoDay(ZONE, new Date(e.at));
    return (
      (f.who.length === 0 || f.who.includes(e.memberId)) &&
      (f.types.length === 0 || f.types.includes(e.kind)) &&
      (!f.rule || e.ruleId === f.rule) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to)
    );
  });
}

function totals(list: RegisterEntry[]): MemberTotal[] {
  const by = new Map<string, MemberTotal>();
  for (const e of list) {
    const t = by.get(e.memberId) ?? {
      memberId: e.memberId,
      entries: 0,
      added: 0,
      taken: 0,
      latest: e.at,
    };
    t.entries += 1;
    if (e.amount > 0) t.added += e.amount;
    else t.taken += e.amount;
    if (e.at > t.latest) t.latest = e.at;
    by.set(e.memberId, t);
  }
  return [...by.values()];
}

const MEMBERS = [
  { id: MAYA, displayName: 'Maya', avatarKey: 'fox' as const, color: 'member-3' as const },
  { id: LEO, displayName: 'Leo', avatarKey: 'frog' as const, color: 'member-4' as const },
];
const ADMINS: Record<string, string> = { [ALEX]: 'Alex', [SAM]: 'Sam' };

export default async function DevPointsRegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const f = parseRegisterQuery(params);
  const matching = filtered(entries(), f);
  return (
    <div className={`admin ${theme}`}>
      <RegisterView
        filters={f}
        entries={matching.slice(0, shownCount(f))}
        totals={totals(matching)}
        chips={MEMBERS}
        members={MEMBERS}
        rules={RULES}
        adminName={(id) => ADMINS[id] ?? 'a parent'}
        timezone={ZONE}
        today={TODAY}
        moreOpen={f.types.length > 0 || !!f.from || !!f.to || !!f.rule}
        base="/dev/rewards/points"
      />
    </div>
  );
}
