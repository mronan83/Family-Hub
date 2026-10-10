import { ThemeLock, type Theme } from '@familywise/ui';
import type { Metadata } from 'next';
import type { Insights } from '@/lib/history';
import { InsightsView, RANGES, type Range } from '../../(admin)/admin/insights/view';

// The admin Insights page with a made-up member and no database (WP-17), for the UI suite: the
// 14 days of supabase/tests/190_streak_history.test.sql, in Day or Evening (?theme=evening), and a
// member with no history yet (?member=new).
export const metadata: Metadata = { title: 'Insights', robots: { index: false } };

const KID = '0de00000-0000-4000-8000-00000000d0a1';
const NEW = '0de00000-0000-4000-8000-00000000d0a2';
const day = (k: number) => `2026-10-${String(k).padStart(2, '0')}`;
const CLASSES = [
  'good',
  'good',
  'bad',
  'good',
  'good',
  'bad',
  'bad',
  'good',
  'good',
  'good',
  'neutral',
  'good',
  'good',
  'good',
] as const;
const DONE = [3, 3, 2, 3, 2, 0, 2, 3, 3, 3, 0, 3, 2, 3];
const MISSED = [0, 0, 1, 0, 0, 3, 1, 0, 0, 0, 0, 0, 0, 0];

function fixture(memberId: string): Insights {
  if (memberId === NEW) {
    return {
      member_id: NEW,
      from: day(1),
      to: day(14),
      streaks: {
        current_kind: null,
        current_length: 0,
        best_good: 0,
        longest_bad: 0,
        through: null,
      },
      days: [],
      rate: { done: 0, counted: 0 },
      most_missed: [],
      by_tag: [],
      trust: { checkoffs: 0, unchecked: 0, approved: 0, sent_back: 0, median_verify_seconds: null },
    };
  }
  return {
    member_id: KID,
    from: day(1),
    to: day(14),
    streaks: {
      current_kind: 'good',
      current_length: 6,
      best_good: 6,
      longest_bad: 2,
      through: day(14),
    },
    days: CLASSES.map((c, i) => ({
      date: day(i + 1),
      class: c,
      scheduled: 3,
      done: DONE[i]!,
      missed: MISSED[i]!,
    })),
    rate: { done: 32, counted: 37 },
    most_missed: [
      { chore_id: 'c2', title: 'Brush teeth', missed: 2 },
      { chore_id: 'c1', title: 'Make bed', missed: 2 },
      { chore_id: 'c3', title: 'Set the table', missed: 1 },
    ],
    by_tag: [
      { tag_id: 't2', name: 'Kitchen', done: 10, counted: 11 },
      { tag_id: 't1', name: 'Morning', done: 22, counted: 26 },
    ],
    trust: { checkoffs: 34, unchecked: 1, approved: 10, sent_back: 1, median_verify_seconds: 7200 },
  };
}

export default async function DevInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; member?: string; days?: string }>;
}) {
  const params = await searchParams;
  const theme: Theme = params.theme === 'evening' ? 'evening' : 'day';
  const memberId = params.member === 'new' || params.member === NEW ? NEW : KID;
  const days = Number(params.days);
  const range: Range = (RANGES as readonly number[]).includes(days) ? (days as Range) : 30;
  return (
    <main className="fw-page fw-page--wide">
      <ThemeLock theme={theme} />
      <InsightsView
        members={[
          { id: KID, name: 'Maya' },
          { id: NEW, name: 'Leo' },
        ]}
        memberId={memberId}
        range={range}
        insights={fixture(memberId)}
        weekStart={0}
        notice={null}
        basePath="/dev/insights"
      />
    </main>
  );
}
