import { Avatar, Banner, Button, Fold } from '@familywise/ui';
import Link from 'next/link';
import type { DayType } from '@/lib/chores';
import { calendarDay } from '@/lib/chores';
import { cutoffWords } from '@/lib/lunch-picks';
import { CLOSURE_LABELS, DAY_TYPE_NAMES, type Day } from '@/lib/school';
import {
  archiveLine,
  archivedLine,
  closuresLine,
  cutoffLine,
  followersLine,
  termsLine,
  yearLine,
} from '@/lib/setup-facts';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import type { NavWho } from '../nav';
import { removeSchoolDate, saveLunchCutoff, setSchoolYearArchived } from './actions';
import type { ClosureRow, SchoolYearRow, TermRow } from './data';
import { ClosureForm, FollowersForm, SchoolYearForm, TermForm, type FollowerOption } from './forms';
import { Timeline } from './timeline';

function span(start: string, end: string): string {
  return start === end ? calendarDay(start) : `${calendarDay(start)} to ${calendarDay(end)}`;
}

export interface SchoolMember extends FollowerOption {
  /** Today's day type, and the school year it comes from. */
  today: { dayType: DayType; schoolYearId: string | null } | null;
}

/** [NFR-18] Which section of School comes back open (WP-94). */
export type SchoolSection = 'lunch' | 'add' | 'archived';

/**
 * [SCH-01][SCH-02] The household's school years (this year, next year, or two schools at once) and
 * what kind of day today is for each member. Chores set to school days, weekends or breaks follow
 * these (SCH-03). [NFR-18][D-120] Today and the school years stay open; the lunch cut-off, Add a
 * school year (to its button) and Archived (its count) fold (WP-94).
 */
export function SchoolView({
  today,
  members,
  years,
  cutoff,
  saved,
  open = null,
  waiting,
  who,
}: {
  today: string;
  members: SchoolMember[];
  years: SchoolYearRow[];
  /** [MEAL-09] The morning cut-off for lunch changes on the board, "HH:MM". */
  cutoff: string;
  saved: string | null;
  open?: SchoolSection | null;
  /** For a dev page; the live page leaves them to the header. */
  waiting?: number;
  who?: NavWho | null;
}) {
  const yearName = new Map(years.map((y) => [y.id, y.name]));
  const active = years.filter((y) => !y.archivedAt);
  const archived = years.filter((y) => y.archivedAt);
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/school" waiting={waiting} who={who} />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}

      <section className="fw-card" aria-labelledby="today-heading">
        <h1 id="today-heading">School year</h1>
        <h2 className="fw-subhead">Today, {calendarDay(today)}</h2>
        <ul className="fw-list" aria-label="Today for each member">
          {members.map((m) => (
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
                {m.today ? DAY_TYPE_NAMES[m.today.dayType] : '—'}
                {m.today?.schoolYearId ? (
                  <span className="fw-muted"> · {yearName.get(m.today.schoolYearId)}</span>
                ) : null}
              </span>
            </li>
          ))}
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
      <Fold
        id="lunch"
        title="Lunch changes"
        headingId="cutoff-heading"
        open={open === 'lunch'}
        summary={[<Line key="c" line={cutoffLine(cutoff)} />]}
      >
        <form action={saveLunchCutoff} className="fw-form" aria-label="Lunch changes">
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
      </Fold>

      {/* With no school year yet, adding one is all there is to do here. */}
      <Fold
        id="add-year"
        title="Add a school year"
        headingId="add-year-heading"
        button={{ label: 'Add a year', icon: 'plus' }}
        open={open === 'add' || active.length === 0}
      >
        <SchoolYearForm />
      </Fold>

      {archived.length > 0 ? (
        <Fold
          id="archived"
          title="Archived"
          headingId="archived-years-heading"
          open={open === 'archived'}
          summary={[<Line key="a" line={archivedLine(archived.map((y) => y.name))} />]}
        >
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
        </Fold>
      ) : null}
    </main>
  );
}

/** [NFR-18] Which section of a school year's page comes back open (WP-94). */
export type YearSection = 'closures' | 'terms' | 'followers' | 'dates';

/**
 * [SCH-01][SCH-02] One school year: its dates, the timeline of school days, breaks and days off,
 * its terms, and who follows it instead of the default. [NFR-18][D-120] The timeline stays open; its
 * set-up sections fold to their facts, and Archive is set apart at the bottom (WP-94).
 */
export function SchoolYearView({
  year,
  terms,
  closures,
  followers,
  members,
  days,
  weekStart,
  today,
  saved,
  open = null,
  waiting,
  who,
}: {
  year: SchoolYearRow;
  terms: TermRow[];
  closures: ClosureRow[];
  /** The members ticked to follow it. */
  followers: string[];
  /** The household's members not archived. */
  members: FollowerOption[];
  days: Day[];
  weekStart: number;
  today: string;
  saved: string | null;
  open?: YearSection | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const closureNames = new Map<string, string>();
  for (const c of closures) {
    for (const d of days) {
      if (d.day >= c.startDate && d.day <= c.endDate) closureNames.set(d.day, c.name);
    }
  }
  const followerNames = members.filter((m) => followers.includes(m.id)).map((m) => m.displayName);
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/school" waiting={waiting} who={who} />
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
        <Timeline days={days} weekStart={weekStart} today={today} closureNames={closureNames} />
      </section>

      <Fold
        id="closures"
        title="Breaks and days off"
        headingId="closures-heading"
        open={open === 'closures'}
        summary={[<Line key="c" line={closuresLine(days, closures, today)} />]}
      >
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
        <Fold
          variant="inner"
          id="add-day-off"
          title="Add a day off"
          button={{ label: 'Add a day off', icon: 'plus' }}
          open={closures.length === 0}
        >
          <ClosureForm schoolYearId={year.id} />
        </Fold>
      </Fold>

      <Fold
        id="terms"
        title="Terms"
        headingId="terms-heading"
        open={open === 'terms'}
        summary={[<Line key="t" line={termsLine(terms.map((t) => t.name))} />]}
      >
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
        <Fold
          variant="inner"
          id="add-term"
          title="Add a term"
          button={{ label: 'Add a term', icon: 'plus' }}
          open={terms.length === 0}
        >
          <TermForm schoolYearId={year.id} />
        </Fold>
      </Fold>

      <Fold
        id="followers"
        title="Who follows it"
        headingId="followers-heading"
        open={open === 'followers'}
        summary={[<Line key="f" line={followersLine(followerNames, year.isDefault)} />]}
      >
        <p className="fw-muted">
          {year.isDefault
            ? 'Everyone follows this year unless you assign them another one. Tick someone here only if another school year would otherwise cover them.'
            : 'Tick who goes to this school; everyone else follows the default school year.'}
        </p>
        <FollowersForm schoolYearId={year.id} members={members} following={followers} />
      </Fold>

      <Fold
        id="dates"
        title="Dates and name"
        headingId="edit-year-heading"
        open={open === 'dates'}
        summary={[yearLine(year)]}
      >
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
      </Fold>

      {/* Set apart at the bottom, and rare (D-120). */}
      <Fold
        id="archive"
        title={year.archivedAt ? 'Restore' : 'Archive'}
        headingId="archive-year-heading"
        summary={[archiveLine(year.archivedAt !== null)]}
      >
        <p className="fw-muted">
          {year.archivedAt
            ? 'It applies again, and anyone assigned to it follows it again.'
            : 'It stops applying; anyone following it goes back to the default. Its days off stay as a record.'}
        </p>
        <form action={setSchoolYearArchived}>
          <input type="hidden" name="id" value={year.id} />
          <input type="hidden" name="archive" value={year.archivedAt ? 'false' : 'true'} />
          <Button
            type="submit"
            variant={year.archivedAt ? 'ghost' : 'danger'}
            icon={year.archivedAt ? 'undo' : 'minus-circle'}
          >
            {year.archivedAt ? `Restore ${year.name}` : `Archive ${year.name}`}
          </Button>
        </form>
      </Fold>
    </main>
  );
}
