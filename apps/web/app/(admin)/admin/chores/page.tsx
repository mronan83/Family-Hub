import { Avatar, Banner, Icon } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import {
  clock,
  DAY_PART_LABELS,
  DAY_PARTS,
  calendarDay,
  describeSchedule,
  dueSummary,
  filterItems,
  KIND_LABELS,
  parseFilters,
  relativeDay,
} from '@/lib/chores';
import { isoDay } from '@/lib/format';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { loadMembers } from '../members/data';
import { loadChores, loadOccurrenceDates, loadTags } from './data';

export const metadata: Metadata = { title: 'Chores and tasks' };

function names(words: string[]): string {
  if (words.length <= 2) return words.join(' and ');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

// [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13] The family list: every member's chores and tasks in one
// place, filtered by person, tag, kind, time of day and whether archived. Private items appear only
// for their creator and for assignees who sign in (RLS), marked with a lock.
export default async function ChoresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/chores');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const today = isoDay(household.timezone);
  const lookback = new Date(Date.parse(`${today}T12:00:00Z`) - 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [chores, tags, members, occurrences] = await Promise.all([
    loadChores(db!, household.id),
    loadTags(db!, household.id),
    loadMembers(db!, household.id),
    loadOccurrenceDates(db!, household.id, lookback),
  ]);
  const due = dueSummary(occurrences, today);
  const params = await searchParams;
  const filters = parseFilters(params);
  const shown = filterItems(chores, filters);
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const saved = typeof params.saved === 'string' ? params.saved : null;
  const filtered = Boolean(filters.person || filters.tag || filters.kind || filters.when);

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/chores" />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}
      <section className="fw-card" aria-labelledby="chores-heading">
        <div className="fw-bar">
          <h1 id="chores-heading">Chores and tasks</h1>
          <div className="fw-actions">
            <Link className="fw-btn fw-btn--primary" href="/admin/chores/new">
              Add a chore
            </Link>
            <Link className="fw-btn fw-btn--secondary" href="/admin/chores/new?kind=task">
              Add a task
            </Link>
          </div>
        </div>

        <form method="get" className="fw-filters" aria-label="Filter the list">
          <label className="fw-field">
            <span className="fw-field__label">Person</span>
            <select className="fw-input" name="person" defaultValue={filters.person ?? ''}>
              <option value="">Everyone</option>
              {members
                .filter((m) => !m.archivedAt)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label className="fw-field">
            <span className="fw-field__label">Tag</span>
            <select className="fw-input" name="tag" defaultValue={filters.tag ?? ''}>
              <option value="">Any tag</option>
              {tags
                .filter((t) => !t.archivedAt)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="fw-field">
            <span className="fw-field__label">Kind</span>
            <select className="fw-input" name="kind" defaultValue={filters.kind ?? ''}>
              <option value="">Chores and tasks</option>
              <option value="chore">Chores</option>
              <option value="task">Tasks</option>
            </select>
          </label>
          <label className="fw-field">
            <span className="fw-field__label">Time of day</span>
            <select className="fw-input" name="when" defaultValue={filters.when ?? ''}>
              <option value="">Any time</option>
              {DAY_PARTS.map((p) => (
                <option key={p} value={p}>
                  {DAY_PART_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="fw-field">
            <span className="fw-field__label">Show</span>
            <select className="fw-input" name="status" defaultValue={filters.status}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <div className="fw-actions">
            <button type="submit" className="fw-btn fw-btn--ghost">
              Filter
            </button>
            {filtered || filters.status === 'archived' ? (
              <Link href="/admin/chores">Clear</Link>
            ) : null}
          </div>
        </form>

        {shown.length === 0 ? (
          <p className="fw-muted">
            {filtered || filters.status === 'archived'
              ? 'Nothing matches these filters.'
              : 'Nothing on the list yet. Add the first chore or task.'}
          </p>
        ) : (
          <ul className="fw-list" aria-label="Chores and tasks">
            {shown.map((c) => {
              // In the family's order: children first, then adults, each by name.
              const people = members.filter((m) => c.assignees.includes(m.id));
              const itemTags = c.tags.map((id) => tagById.get(id)).filter((t) => t !== undefined);
              return (
                <li key={c.id} className="fw-list__row">
                  <span className="fw-item">
                    <Icon name={c.icon} size={28} />
                    <span className="fw-item__body">
                      <span className="fw-actions">
                        <strong>{c.title}</strong>
                        {c.visibility === 'private' ? (
                          <span className="fw-pill">
                            <Icon name="lock" size={16} />
                            Private
                          </span>
                        ) : null}
                      </span>
                      <span className="fw-muted">
                        {KIND_LABELS[c.kind]}
                        {' · '}
                        {describeSchedule(c.schedule, c.kind)}
                        {c.dueTime ? ` · ${clock(c.dueTime)}` : ''}
                        {c.points > 0 ? ` · ${c.points} points` : ''}
                        {due.get(c.id)?.next
                          ? ` · Next: ${relativeDay(due.get(c.id)!.next!, today)}`
                          : ''}
                      </span>
                      {due.get(c.id)?.overdueSince ? (
                        <span className="fw-actions fw-overdue">
                          <Icon name="hourglass" size={16} />
                          Overdue since {calendarDay(due.get(c.id)!.overdueSince!)}
                        </span>
                      ) : null}
                      <span className="fw-actions fw-item__people">
                        {people.map((m) => (
                          <Avatar
                            key={m.id}
                            name={m.displayName}
                            avatarKey={m.avatarKey}
                            color={m.color}
                            size={24}
                            decorative
                          />
                        ))}
                        <span>{names(people.map((m) => m.displayName))}</span>
                      </span>
                      {itemTags.length > 0 ? (
                        <span className="fw-actions" aria-label="Tags">
                          {itemTags.map((t) => (
                            <span key={t.id} className="fw-pill fw-pill--tag">
                              <span
                                className="fw-swatch fw-swatch--small"
                                style={{ background: `var(--${t.color})` }}
                                aria-hidden
                              />
                              {t.name}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <Link href={`/admin/chores/${c.id}`} aria-label={`Edit ${c.title}`}>
                    Edit
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="fw-muted">
          <Link href="/admin/tags">Tags</Link> group the list and let goals count by category.
        </p>
      </section>
    </main>
  );
}
