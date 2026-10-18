import { Avatar, Banner, Fold, Icon, type AvatarKey, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  applyFilters,
  byHeading,
  type ChoreFilters,
  COMPLETED_PAGE,
  completedCount,
  doAgainDates,
  filtersHref,
  HEADING_LABELS,
  moreFiltersLine,
  type OnceOccurrence,
  type Part,
  place,
  type Placed,
  rowParts,
  sections,
  togglePerson,
  type Words,
} from '@/lib/chore-sections';
import {
  calendarDay,
  clock,
  DAY_PART_LABELS,
  DAY_PARTS,
  describeSchedule,
  KIND_LABELS,
  lunchDaysNote,
} from '@/lib/chores';
import { andList } from '@/lib/format';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { HoldRow } from '../hold-row';
import type { NavWho } from '../nav';
import { setChoreArchived } from './actions';
import type { ChoreRow, TagRow } from './data';
import { DoAgainSheet } from './do-again';
import { TagPicker } from './tag-picker';

export interface ChipMember {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

type Item = ChoreRow & { lunchNote: string | null };

/** The page's state from its address: the filters, a fold opened, Completed's pages, Do again. */
export interface ChoresQuery {
  filters: ChoreFilters;
  /** "more", "completed" or "archived": a fold opened, as after a save in it. */
  open: string | null;
  /** How many times Show older was tapped. */
  older: number;
  /** Do again's sheet, for this item. */
  again: string | null;
}

const PARTS_CLASS: Record<NonNullable<Part['tone']>, string> = {
  late: 'fw-row__late',
  done: 'fw-row__done',
  pts: 'fw-row__pts',
};

function Parts({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 ? ' · ' : ''}
          {p.tone ? <span className={PARTS_CLASS[p.tone]}>{p.text}</span> : p.text}
        </span>
      ))}
    </>
  );
}

/**
 * [CHR-21][CHR-22][CHR-23][NFR-18][D-132] Chores and tasks in four sections (WP-96), as the approved
 * mockup draws them: person chips and More filters at the top; Scheduled (one-time items not done,
 * under Overdue, Today, This week and Later) and Recurring open; Completed folded to its count, the
 * newest 20 and then Show older; Archived folded. Each row is two lines with ⋯ (Edit, Duplicate,
 * Archive or Restore; Do again on a completed one), and held for the same menu. Private items show
 * only for their creator and assignees who sign in (RLS), marked with a lock.
 */
export function ChoresView({
  items,
  occurrences,
  overdueSince,
  members,
  tags,
  query,
  today,
  weekStart,
  timeZone,
  banner,
  menuOpen = null,
  waiting,
  who,
}: {
  items: ChoreRow[];
  /** The one-time items' occurrences, for which section each is in. */
  occurrences: OnceOccurrence[];
  /** A recurring task's oldest day left open, by its id. */
  overdueSince: Record<string, string | null>;
  /** Active members, children first. */
  members: ChipMember[];
  tags: TagRow[];
  query: ChoresQuery;
  today: string;
  weekStart: number;
  timeZone: string;
  banner: ReactNode | null;
  /** The dev page's picture of an open ⋯ menu: the item's id. */
  menuOpen?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const f = query.filters;
  const all: Item[] = items.map((c) => ({
    ...c,
    lunchNote: c.lunchDays ? lunchDaysNote(c.lunchDays) : null,
  }));
  const shownItems = applyFilters(all, f);
  const placed = place(shownItems, occurrences, today, weekStart, timeZone);
  const s = sections(placed);
  const memberName = new Map(members.map((m) => [m.id, m.displayName]));
  const tagName = (id: string) => tags.find((t) => t.id === id)?.name ?? 'a tag';
  const chosen = f.people.map((id) => memberName.get(id)).filter((n): n is string => !!n);
  const filtered = f.people.length > 0 || Boolean(f.tag || f.kind || f.when);
  const more = Boolean(f.tag || f.kind || f.when);
  const here = filtersHref(f);
  const withQuery = (extra: Record<string, string>) => {
    const u = new URL(here, 'http://x');
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
    return `${u.pathname}${u.search}`;
  };
  const forWhom = chosen.length ? ` for ${chosen.join(' or ')}` : '';

  const row = (p: Placed<Item>, up = false) => {
    const c = p.item;
    // In the family's order: children first, then adults.
    const people = members.filter((m) => c.assignees.includes(m.id)).map((m) => m.displayName);
    const each = c.assignment === 'each' && people.length > 1 && p.section === 'recurring';
    const parts = rowParts(p, {
      today,
      timeZone,
      who: `${people.join(', ')}${each ? ', each their own' : ''}`,
      describe: describeSchedule,
      clock,
      overdueSince: overdueSince[c.id] ?? null,
    });
    return (
      <HoldRow
        key={c.id}
        id={`item-${c.id}`}
        menuLabel={`More for ${c.title}`}
        open={menuOpen === c.id}
        up={up}
        menu={
          <RowMenu
            item={c}
            section={p.section}
            back={here}
            againHref={withQuery({ again: c.id })}
          />
        }
      >
        <span className="fw-row__icon">
          <Icon name={c.icon} size={28} />
        </span>
        <span className="fw-row__l1">
          <Link className="fw-row__name" href={`/admin/chores/${c.id}`}>
            {c.title}
          </Link>
          {c.visibility === 'private' ? (
            <span className="fw-pill">
              <Icon name="lock" size={14} />
              Private
            </span>
          ) : null}
        </span>
        <span className="fw-row__l2">
          <span className="fw-kind">{KIND_LABELS[c.kind]}</span> <Parts parts={parts} />
        </span>
      </HoldRow>
    );
  };

  const [done, missed] = completedCount(s.completed).split(' · ') as [string, string?];
  const completedShown = s.completed.slice(0, COMPLETED_PAGE * (query.older + 1));
  const completedSummary: Words =
    s.completed.length === 0
      ? filtered
        ? [{ b: 'None done' }, `${forWhom}${more ? ' with these filters' : ''}`]
        : [{ b: 'None done yet' }, ' · done one-time items move here']
      : [
          { b: done },
          missed ? ` · ${missed}` : '',
          `${forWhom} · latest ${calendarDay(s.completed[0]!.finishedOn!)}`,
        ];
  const archivedSummary: Words =
    s.archived.length === 0
      ? [{ b: 'None archived' }, filtered ? `${forWhom}${more ? ' with these filters' : ''}` : '']
      : [{ b: `${s.archived.length} archived` }];
  const againItem = query.again ? all.find((c) => c.id === query.again) : undefined;
  const againPlaced = againItem ? s.completed.find((p) => p.item.id === againItem.id) : undefined;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/chores" waiting={waiting} who={who} />
      {banner}
      <section className="fw-card" aria-labelledby="chores-heading">
        <div className="fw-bar">
          <h1 id="chores-heading">Chores and tasks</h1>
          <div className="fw-actions">
            <Link className="fw-btn fw-btn--primary" href="/admin/chores/new">
              <Icon name="plus" className="fw-btn__icon" />
              <span>Add a chore</span>
            </Link>
            <Link className="fw-btn fw-btn--secondary" href="/admin/chores/new?kind=task">
              Add a task
            </Link>
          </div>
        </div>

        {/* [CHR-21] Person chips (Q2): a face on or off; several show what is any of theirs. */}
        <div className="fw-chips" role="group" aria-label="Whose">
          {members.map((m) => {
            const on = f.people.includes(m.id);
            return (
              <Link
                key={m.id}
                className="fw-chip"
                role="button"
                aria-pressed={on}
                href={filtersHref(togglePerson(f, m.id))}
              >
                <Avatar
                  name={m.displayName}
                  avatarKey={m.avatarKey}
                  color={m.color}
                  size={30}
                  decorative
                />
                {m.displayName}
                <span className="fw-chip__tick">
                  <Icon name="check" size={16} />
                </span>
              </Link>
            );
          })}
          {f.people.length ? (
            <Link className="fw-chips__clear" href={filtersHref({ ...f, people: [] })}>
              Clear
            </Link>
          ) : null}
        </div>

        {/* [CHR-21] More filters (Q1): Tag, Kind and Time of day, applied as tapped. */}
        <Fold
          variant="inner"
          id="more-filters"
          title="More filters"
          open={query.open === 'more'}
          summary={[
            <Line key="m" line={moreFiltersLine(f, tagName, shownItems.length, all.length)} />,
          ]}
        >
          <TagPicker
            value={f.tag ?? ''}
            options={[
              { value: '', label: 'Any tag', href: filtersHref({ ...f, tag: null }) },
              ...tags
                .filter((t) => !t.archivedAt || t.id === f.tag)
                .map((t) => ({
                  value: t.id,
                  label: t.name,
                  href: filtersHref({ ...f, tag: t.id }),
                })),
            ].map((o) => ({ ...o, href: withOpen(o.href) }))}
          />
          <div className="fw-field" role="group" aria-label="Kind">
            <span className="fw-field__label">Kind</span>
            <div className="fw-seg">
              {(
                [
                  [null, 'Both'],
                  ['chore', 'Chores'],
                  ['task', 'Tasks'],
                ] as const
              ).map(([k, label]) => (
                <Link
                  key={label}
                  className="fw-seg__item"
                  aria-current={f.kind === k ? 'true' : undefined}
                  href={withOpen(filtersHref({ ...f, kind: k }))}
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>
          <div className="fw-field" role="group" aria-label="Time of day">
            <span className="fw-field__label">Time of day</span>
            <div className="fw-seg">
              {[null, ...DAY_PARTS].map((w) => (
                <Link
                  key={w ?? 'any'}
                  className="fw-seg__item"
                  aria-current={f.when === w ? 'true' : undefined}
                  href={withOpen(filtersHref({ ...f, when: w }))}
                >
                  {w ? DAY_PART_LABELS[w] : 'Any'}
                </Link>
              ))}
            </div>
          </div>
          <p className="fw-field__help">
            Each applies as you tap it. Archived items are in their own section at the bottom.
          </p>
          {more ? (
            <div className="fw-actions">
              <Link
                className="fw-btn fw-btn--ghost"
                href={filtersHref({ ...f, tag: null, kind: null, when: null })}
              >
                Clear the filters
              </Link>
            </div>
          ) : null}
        </Fold>
      </section>

      <Fold
        id="scheduled"
        title="Scheduled"
        headingId="scheduled-heading"
        open
        count={s.scheduled.length}
      >
        {s.scheduled.length === 0 ? (
          <p className="fw-empty">
            {filtered
              ? `Nothing${forWhom} here${more ? ' with these filters' : ''}.`
              : 'Nothing one-time coming up. A task, or a chore set to Once, shows here by its date.'}
          </p>
        ) : (
          byHeading(s.scheduled).map((g) => (
            <div key={g.heading}>
              <p className={`fw-dh${g.heading === 'overdue' ? ' fw-dh--late' : ''}`}>
                {g.heading === 'overdue' ? <Icon name="hourglass" size={16} /> : null}
                {HEADING_LABELS[g.heading]} <span className="fw-dh__n">· {g.items.length}</span>
              </p>
              <ul className="fw-rows" aria-label={HEADING_LABELS[g.heading]}>
                {g.items.map((p) => row(p))}
              </ul>
            </div>
          ))
        )}
      </Fold>

      <Fold
        id="recurring"
        title="Recurring"
        headingId="recurring-heading"
        open
        count={s.recurring.length}
      >
        {s.recurring.length === 0 ? (
          <p className="fw-empty">
            {filtered
              ? `Nothing${forWhom} here${more ? ' with these filters' : ''}.`
              : 'Nothing repeats yet. A chore or task set to every day, week or month shows here.'}
          </p>
        ) : (
          <ul className="fw-rows" aria-label="Recurring">
            {s.recurring.map((p) => row(p))}
          </ul>
        )}
      </Fold>

      <Fold
        id="completed"
        title="Completed"
        headingId="completed-heading"
        open={query.open === 'completed' || query.older > 0 || Boolean(againPlaced)}
        count={s.completed.length ? completedCount(s.completed) : 0}
        summary={[<Line key="c" line={completedSummary} />]}
      >
        {s.completed.length === 0 ? (
          <p className="fw-empty">
            {filtered
              ? `None done${forWhom}${more ? ' with these filters' : ''}.`
              : 'None done yet. A one-time item moves here once it’s done.'}
          </p>
        ) : (
          <>
            <ul className="fw-rows" aria-label="Completed">
              {completedShown.map((p) => row(p, true))}
            </ul>
            {completedShown.length < s.completed.length ? (
              <div className="fw-older">
                <span className="fw-muted">
                  Showing the newest {completedShown.length} of {s.completed.length}.
                </span>
                <Link
                  className="fw-btn fw-btn--secondary"
                  href={`${withQuery({ older: String(query.older + 1) })}#completed`}
                >
                  Show older
                </Link>
              </div>
            ) : null}
          </>
        )}
      </Fold>

      <Fold
        id="archived"
        title="Archived"
        headingId="archived-heading"
        open={query.open === 'archived'}
        count={s.archived.length}
        summary={[<Line key="a" line={archivedSummary} />]}
      >
        {s.archived.length === 0 ? (
          <p className="fw-empty">
            {filtered
              ? `None archived${forWhom}${more ? ' with these filters' : ''}.`
              : 'None archived. An archived item leaves the board and keeps its history.'}
          </p>
        ) : (
          <ul className="fw-rows" aria-label="Archived">
            {s.archived.map((p) => row(p, true))}
          </ul>
        )}
      </Fold>

      <p className="fw-muted">
        <Link href="/admin/tags">Tags</Link> group the list and let goals count by category.
      </p>

      {againItem && againPlaced ? (
        <DoAgainSheet
          id={againItem.id}
          title={againItem.title}
          kind={againItem.kind}
          who={andList(
            members.filter((m) => againItem.assignees.includes(m.id)).map((m) => m.displayName),
          )}
          points={againItem.points}
          outcome={againPlaced.outcome!}
          finishedOn={calendarDay(againPlaced.finishedOn!)}
          choices={doAgainDates(today)}
          cancelHref={`${withQuery({ open: 'completed' })}#item-${againItem.id}`}
          back={here}
        />
      ) : null}
    </main>
  );

  function withOpen(href: string) {
    return `${href}${href.includes('?') ? '&' : '?'}open=more`;
  }
}

/** A row's ⋯ (Q5, Q10): by its section, Do again first on a completed one. */
function RowMenu({
  item,
  section,
  back,
  againHref,
}: {
  item: ChoreRow;
  section: string;
  back: string;
  againHref: string;
}) {
  const archive = (on: boolean) => (
    <form action={setChoreArchived}>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="archive" value={String(on)} />
      <input type="hidden" name="back" value={back} />
      <button
        type="submit"
        className={`fw-row__mi${on ? ' fw-row__mi--arch' : ''}`}
        aria-label={`${on ? 'Archive' : 'Restore'} ${item.title}`}
      >
        <Icon name={on ? 'archive' : 'undo'} size={20} />
        {on ? 'Archive' : 'Restore'}
      </button>
    </form>
  );
  const duplicate = (
    <Link
      className="fw-row__mi"
      href={`/admin/chores/new?from=${item.id}`}
      aria-label={`Duplicate ${item.title}`}
    >
      <Icon name="copy" size={20} />
      Duplicate
    </Link>
  );
  if (section === 'archived') {
    return (
      <>
        {archive(false)}
        {duplicate}
      </>
    );
  }
  return (
    <>
      {section === 'completed' ? (
        <Link
          className="fw-row__mi fw-row__mi--first"
          href={againHref}
          aria-label={`Do again: ${item.title}`}
        >
          <Icon name="repeat" size={20} />
          Do again…
        </Link>
      ) : null}
      <Link
        className="fw-row__mi"
        href={`/admin/chores/${item.id}`}
        aria-label={`Edit ${item.title}`}
      >
        <Icon name="edit" size={20} />
        Edit
      </Link>
      {duplicate}
      <span className="fw-row__sep" aria-hidden />
      {archive(true)}
    </>
  );
}

/** The banner after a save, an archive or Do again's Add it. */
export function choresBanner(p: {
  saved?: string;
  archived?: string;
  restored?: string;
  added?: string;
  on?: string;
  heading?: string;
}): ReactNode {
  if (p.added && p.on) {
    return (
      <Banner kind="info">
        Added <b>{p.added}</b> for {calendarDay(p.on)}. It’s in Scheduled, under {p.heading}.
      </Banner>
    );
  }
  if (p.saved) return <Banner kind="info">Saved {p.saved}.</Banner>;
  if (p.archived) return <Banner kind="info">Archived {p.archived}. It’s under Archived.</Banner>;
  if (p.restored) return <Banner kind="info">Restored {p.restored}.</Banner>;
  return null;
}
