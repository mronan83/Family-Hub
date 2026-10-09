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
  const [years, members, todayTypes] = await Promise.all([
    loadYears(db!, household.id),
    loadMembers(db!, household.id),
    loadDayTypes(db!, household.id, today),
  ]);
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
