import type { Metadata } from 'next';
import { parseChoreFilters } from '@/lib/chore-sections';
import { ItemView } from '../../(admin)/admin/chores/item-view';
import { NewItemView } from '../../(admin)/admin/chores/new-view';
import { choresBanner, ChoresView } from '../../(admin)/admin/chores/view';
import {
  ARCHIVED,
  COMPLETED,
  MEMBERS,
  OLDER,
  OVERDUE_SINCE,
  RECURRING,
  SCHEDULED,
  TAGS,
  TIME_ZONE,
  TODAY,
  WEEK_START,
  occurrencesOf,
  MAYA,
} from './fixture';

// [CHR-21][CHR-22][CHR-23][NFR-18] Chores and tasks in four sections (WP-96) with the made-up family
// and no database, for the UI suite and the side-by-side with the mockup. Today is Wed, Oct 14.
//   ?who=Maya,Leo   person chips chosen        ?tag=Kitchen&kind=chore&when=morning  More filters set
//   ?open=more|completed|archived  a fold open ?older=1&state=older  Completed with Show older
//   ?menu=<title>   that row's ⋯ open           ?again=<title>  Do again's sheet
//   ?state=empty    a family just started       ?banner=again   after Do again's Add it
//   ?page=item&open=coming-up   Feed the dog's page        ?page=copy  Duplicate's form (Homework)
//   ?page=again     Do again's Change more first (the garage, Sat)     ?theme=evening
export const metadata: Metadata = { title: 'Chores and tasks', robots: { index: false } };

const WHO = { name: 'Alex', avatarKey: 'owl' as const, color: 'member-1' as const };

export default async function DevChoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const all = [...SCHEDULED, ...RECURRING, ...COMPLETED, ...ARCHIVED];
  const byTitle = (t?: string) => all.find((c) => c.title === t);
  if (p.page === 'item') {
    const dog = byTitle('Feed the dog')!;
    const day = (d: string, status: string, id: string) => ({
      dueDate: d,
      members: [MAYA],
      occurrences: [
        {
          id,
          memberId: null,
          status: status as 'completed',
          doneBy: status === 'completed' ? [MAYA] : [],
        },
      ],
    });
    return (
      <div className={`admin ${theme}`}>
        <ItemView
          item={dog}
          members={MEMBERS}
          tags={TAGS}
          approvalMode="off"
          mine
          today={TODAY}
          comingUp={Array.from({ length: 15 }, (_, i) =>
            day(`2026-10-${String(14 + i).padStart(2, '0')}`, 'scheduled', `d${i}`),
          ).map((d, i) => (i === 14 ? { ...d, dueDate: '2026-10-28' } : d))}
          lastWeek={[
            day('2026-10-13', 'completed', 'l1'),
            day('2026-10-12', 'completed', 'l2'),
            day('2026-10-11', 'missed', 'l3'),
            day('2026-10-10', 'completed', 'l4'),
            day('2026-10-09', 'completed', 'l5'),
            day('2026-10-08', 'skipped', 'l6'),
            day('2026-10-07', 'completed', 'l7'),
          ]}
          open={p.open ?? null}
          waiting={2}
          who={WHO}
        />
      </div>
    );
  }
  if (p.page === 'copy' || p.page === 'again') {
    return (
      <div className={`admin ${theme}`}>
        <NewItemView
          members={MEMBERS}
          tags={TAGS}
          approvalMode="off"
          today={TODAY}
          original={byTitle(p.page === 'copy' ? 'Homework' : 'Clean out the garage')}
          date={p.page === 'again' ? '2026-10-17' : undefined}
          waiting={2}
          who={WHO}
        />
      </div>
    );
  }

  const items = p.state === 'empty' ? [] : p.state === 'older' ? [...all, ...OLDER] : all;
  const names = (p.who ?? '').split(',').filter(Boolean);
  const params = {
    who: MEMBERS.filter((m) => names.includes(m.displayName))
      .map((m) => m.id)
      .join(','),
    tag: TAGS.find((t) => t.name === p.tag)?.id,
    kind: p.kind,
    when: p.when,
  };
  return (
    <div className={`admin ${theme}`}>
      <ChoresView
        items={items}
        occurrences={occurrencesOf(items)}
        overdueSince={OVERDUE_SINCE}
        members={MEMBERS}
        tags={TAGS}
        query={{
          filters: parseChoreFilters(params),
          open: p.open ?? null,
          older: Number(p.older ?? 0) || 0,
          again: byTitle(p.again)?.id ?? null,
        }}
        today={TODAY}
        weekStart={WEEK_START}
        timeZone={TIME_ZONE}
        banner={
          p.banner === 'again'
            ? choresBanner({
                added: 'Clean out the garage',
                on: '2026-10-17',
                heading: 'This week',
              })
            : null
        }
        menuOpen={byTitle(p.menu)?.id ?? null}
        waiting={2}
        who={WHO}
      />
    </div>
  );
}
