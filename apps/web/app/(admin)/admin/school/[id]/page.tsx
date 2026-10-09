import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { calendarDay } from '@/lib/chores';
import { isoDay } from '@/lib/format';
import { CLOSURE_LABELS } from '@/lib/school';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { loadMembers } from '../../members/data';
import { removeSchoolDate, setSchoolYearArchived } from '../actions';
import { loadYear } from '../data';
import { ClosureForm, FollowersForm, SchoolYearForm, TermForm } from '../forms';
import { Timeline } from '../timeline';

export const metadata: Metadata = { title: 'School year' };

function span(start: string, end: string): string {
  return start === end ? calendarDay(start) : `${calendarDay(start)} to ${calendarDay(end)}`;
}

// [SCH-01][SCH-02] One school year: its dates, the timeline of school days, breaks and days off,
// its terms, and who follows it instead of the default.
export default async function SchoolYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/school/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [loaded, members] = await Promise.all([
    loadYear(db!, household.id, id),
    loadMembers(db!, household.id),
  ]);
  if (!loaded) notFound();
  const { year, terms, closures, followers, days } = loaded;
  const closureNames = new Map<string, string>();
  for (const c of closures) {
    for (const d of days) {
      if (d.day >= c.startDate && d.day <= c.endDate) closureNames.set(d.day, c.name);
    }
  }
  const { saved } = await searchParams;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/school" />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}
      <p>
        <Link href="/admin/school">← School years</Link>
      </p>

      <section className="fw-card" aria-labelledby="year-heading">
        <h1 id="year-heading">{year.name}</h1>
        <p className="fw-muted">
          {span(year.startDate, year.endDate)}
          {year.schoolName ? ` · ${year.schoolName}` : ''}
          {year.isDefault ? ' · Default' : ''}
          {year.archivedAt ? ' · Archived' : ''}
        </p>
        <Timeline
          days={days}
          weekStart={household.weekStart}
          today={isoDay(household.timezone)}
          closureNames={closureNames}
        />
      </section>

      <section className="fw-card" aria-labelledby="closures-heading">
        <h2 id="closures-heading">Breaks and days off</h2>
        {closures.length === 0 ? (
          <p className="fw-muted">None yet.</p>
        ) : (
          <ul className="fw-list" aria-label="Breaks and days off">
            {closures.map((c) => (
              <li key={c.id} className="fw-list__row">
                <span>
                  <strong>{c.name}</strong>
                  <span className="fw-muted">
                    {' · '}
                    {CLOSURE_LABELS[c.closureType]} · {span(c.startDate, c.endDate)}
                  </span>
                </span>
                <form action={removeSchoolDate}>
                  <input type="hidden" name="schoolYearId" value={year.id} />
                  <input type="hidden" name="kind" value="closure" />
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" variant="ghost" icon="trash">
                    Remove {c.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ClosureForm schoolYearId={year.id} />
      </section>

      <section className="fw-card" aria-labelledby="terms-heading">
        <h2 id="terms-heading">Terms</h2>
        {terms.length === 0 ? (
          <p className="fw-muted">None yet. Terms are for reference, and later for goal dates.</p>
        ) : (
          <ul className="fw-list" aria-label="Terms">
            {terms.map((t) => (
              <li key={t.id} className="fw-list__row">
                <span>
                  <strong>{t.name}</strong>
                  <span className="fw-muted"> · {span(t.startDate, t.endDate)}</span>
                </span>
                <form action={removeSchoolDate}>
                  <input type="hidden" name="schoolYearId" value={year.id} />
                  <input type="hidden" name="kind" value="term" />
                  <input type="hidden" name="id" value={t.id} />
                  <Button type="submit" variant="ghost" icon="trash">
                    Remove {t.name}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <TermForm schoolYearId={year.id} />
      </section>

      <section className="fw-card" aria-labelledby="followers-heading">
        <h2 id="followers-heading">Who follows it</h2>
        <p className="fw-muted">
          {year.isDefault
            ? 'Everyone follows this year unless you assign them another one. Tick someone here only if another school year would otherwise cover them.'
            : 'Tick who goes to this school; everyone else follows the default school year.'}
        </p>
        <FollowersForm
          schoolYearId={year.id}
          members={members.filter((m) => !m.archivedAt)}
          following={followers}
        />
      </section>

      <section className="fw-card" aria-labelledby="edit-year-heading">
        <h2 id="edit-year-heading">Dates and name</h2>
        <SchoolYearForm
          id={year.id}
          initial={{
            name: year.name,
            schoolName: year.schoolName,
            startDate: year.startDate,
            endDate: year.endDate,
            isDefault: year.isDefault,
          }}
        />
      </section>

      <section className="fw-card" aria-labelledby="archive-year-heading">
        <h2 id="archive-year-heading">{year.archivedAt ? 'Restore' : 'Archive'}</h2>
        <p className="fw-muted">
          {year.archivedAt
            ? 'It applies again, and anyone assigned to it follows it again.'
            : 'It stops applying; anyone following it goes back to the default. Its days off stay as a record.'}
        </p>
        <form action={setSchoolYearArchived}>
          <input type="hidden" name="id" value={year.id} />
          <input type="hidden" name="archive" value={year.archivedAt ? 'false' : 'true'} />
          <Button type="submit" variant="ghost" icon={year.archivedAt ? 'undo' : 'minus-circle'}>
            {year.archivedAt ? `Restore ${year.name}` : `Archive ${year.name}`}
          </Button>
        </form>
      </section>
    </main>
  );
}
