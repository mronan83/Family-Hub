import { Avatar, Banner } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { calendarDay } from '@/lib/chores';
import { isoDay } from '@/lib/format';
import { DAY_TYPE_NAMES } from '@/lib/school';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { loadMembers } from '../members/data';
import { loadDayTypes, loadYears } from './data';
import { SchoolYearForm } from './forms';
import { saveLunchCutoff } from './actions';
import { Button } from '@familywise/ui';
import { cutoffWords } from '@/lib/lunch-picks';

export const metadata: Metadata = { title: 'School year' };

// [SCH-01][SCH-02] The household's school years (this year, next year, or two schools at once) and
// what kind of day today is for each member. Chores set to school days, weekends or breaks follow
// these (SCH-03).
export default async function SchoolPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/school');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const today = isoDay(household.timezone);
  const [years, members, todayTypes, settings] = await Promise.all([
    loadYears(db!, household.id),
    loadMembers(db!, household.id),
    loadDayTypes(db!, household.id, today),
    db!
      .from('household_settings')
      .select('lunch_cutoff')
      .eq('household_id', household.id)
      .maybeSingle(),
  ]);
  // [MEAL-09] The morning cut-off for lunch changes on the board (WP-49): 8:00 am by default.
  const cutoff = String(settings.data?.lunch_cutoff ?? '08:00').slice(0, 5);
  const yearName = new Map(years.map((y) => [y.id, y.name]));
  const typeOf = new Map(todayTypes.map((t) => [t.memberId, t]));
  const active = years.filter((y) => !y.archivedAt);
  const archived = years.filter((y) => y.archivedAt);
  const { saved } = await searchParams;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/school" />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}

      <section className="fw-card" aria-labelledby="today-heading">
        <h1 id="today-heading">School year</h1>
        <h2 className="fw-subhead">Today, {calendarDay(today)}</h2>
        <ul className="fw-list" aria-label="Today for each member">
          {members
            .filter((m) => !m.archivedAt)
            .map((m) => {
              const t = typeOf.get(m.id);
              return (
                <li key={m.id} className="fw-list__row">
                  <span className="fw-actions">
                    <Avatar
                      name={m.displayName}
                      avatarKey={m.avatarKey}
                      color={m.color}
                      size={32}
                      decorative
                    />
                    <strong>{m.displayName}</strong>
                  </span>
                  <span>
                    {t ? DAY_TYPE_NAMES[t.dayType] : '—'}
                    {t?.schoolYearId ? (
                      <span className="fw-muted"> · {yearName.get(t.schoolYearId)}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>

      <section className="fw-card" aria-labelledby="years-heading">
        <h2 id="years-heading">School years</h2>
        {active.length === 0 ? (
          <p className="fw-muted">
            None yet. Until you add one, every weekday counts as summer, so chores set to school
            days don’t appear.
          </p>
        ) : (
          <ul className="fw-list" aria-label="School years">
            {active.map((y) => (
              <li key={y.id} className="fw-list__row">
                <span>
                  <strong>{y.name}</strong>
                  {y.isDefault ? <span className="fw-pill fw-pill--tag">Default</span> : null}
                  <span className="fw-muted">
                    {' · '}
                    {calendarDay(y.startDate)} to {calendarDay(y.endDate)}
                    {y.schoolName ? ` · ${y.schoolName}` : ''}
                  </span>
                </span>
                <Link href={`/admin/school/${y.id}`} aria-label={`Open ${y.name}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* [MEAL-09][US-707] Lunch changes on the board close at a time each morning (D-95). */}
      <section className="fw-card" aria-labelledby="cutoff-heading">
        <h2 id="cutoff-heading">Lunch changes</h2>
        <form action={saveLunchCutoff} className="fw-form">
          <label className="fw-field">
            <span className="fw-field__label">Today’s lunch can change until</span>
            <input
              className="fw-input fw-input--time"
              type="time"
              name="cutoff"
              defaultValue={cutoff}
              required
            />
            <span className="fw-field__help">
              {`Household time, on school days; now ${cutoffWords(cutoff)}. After it, a day is locked on the board, and a change still waiting for a parent is dropped: the day stays as it was. A parent can change any day on Meals.`}
            </span>
          </label>
          <div className="fw-actions">
            <Button type="submit" variant="secondary" icon="check">
              Save the cut-off
            </Button>
          </div>
        </form>
      </section>

      <section className="fw-card" aria-labelledby="add-year-heading">
        <h2 id="add-year-heading">Add a school year</h2>
        <SchoolYearForm />
      </section>

      {archived.length > 0 ? (
        <section className="fw-card" aria-labelledby="archived-years-heading">
          <h2 id="archived-years-heading">Archived</h2>
          <ul className="fw-list" aria-label="Archived school years">
            {archived.map((y) => (
              <li key={y.id} className="fw-list__row">
                <span>{y.name}</span>
                <Link href={`/admin/school/${y.id}`} aria-label={`Open ${y.name}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
