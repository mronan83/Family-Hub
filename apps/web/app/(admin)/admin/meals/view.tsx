import {
  type AvatarKey,
  Banner,
  Button,
  Fold,
  Icon,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import Link from 'next/link';
import { addDays, dayName } from '@/lib/board-calendar';
import {
  daySet,
  daySetWords,
  entryName,
  type MealRow,
  type PlanEntry,
  planByDay,
  type Slot,
  SLOT_ICONS,
  SLOT_WORDS,
  SLOTS,
  weekLabel,
} from '@/lib/meals';
import { AdminHeader } from '../header';
import { changeMealEntry, copyLastWeek } from './actions';
import { EntryForm } from './entry-form';
import { LunchSection } from './lunch-section';
import type { LunchChild } from '@/lib/lunch';

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** [MEAL-14] A folded day's name for a screen reader: "Thursday, Oct 15, today, 2 of 4 set". */
function dayWords(d: string, set: { set: number; of: number; complete: boolean }, today: boolean) {
  return `${weekday.format(noon(d))}, ${monthDay.format(noon(d))}${today ? ', today' : ''}, ${
    set.complete ? 'all set' : daySetWords(set)
  }`;
}

export interface MealsViewProps {
  /** The first day of the week shown, and today, both household dates. */
  week: string;
  today: string;
  days: string[];
  entries: PlanEntry[];
  meals: MealRow[];
  /** The family; faces for the lunch list's children (WP-74). */
  members: {
    id: string;
    displayName: string;
    avatarKey?: AvatarKey | null;
    color?: MemberColor;
  }[];
  /** A day and slot to add to, from an "Add" link. */
  addAt: { day: string; slot: Slot } | null;
  /** [MEAL-15] The entry opened for editing, from Change's "Edit" (WP-76). */
  editId?: string | null;
  /** [MEAL-14] A day to show opened, the one just added to or changed (WP-75). */
  openDay?: string | null;
  /** The new entry's id, made by the page. */
  newId: string;
  /** Each child's school lunch for the week (WP-26). */
  lunch: LunchChild[];
  /** The household's school menus, for each child's choice (WP-27). */
  menus?: { id: string; name: string }[];
  notice: string | null;
  error: string | null;
}

/**
 * [MEAL-01][MEAL-02][MEAL-03][MEAL-08] The week's meals for a parent: each day's breakfast, snack,
 * lunch and dinner, each slot's entries in order (a meal from the library or something written in,
 * for everyone or any set of people, with a note) with Change (earlier, later, edit, remove) and Add;
 * the week before and after; "Add to the plan"; and copying last week here. [MEAL-15] Edit opens the
 * entry's form in place, under it, filled with what was saved (WP-76).
 *
 * [MEAL-14][US-711][D-98] Every day is folded at first (WP-75): its weekday, date and "X of Y set",
 * or a check when every meal of the day has one; today stays outlined. Opened, it is the day as
 * before. A day opens by itself when one of its meals is being edited or was just added or changed.
 * "Add to the plan" and "Copy last week" follow the days, both folded at first; a day's Add opens
 * "Add to the plan" with that day and meal filled in. Folding is the browser's own (details), so it
 * works before the page hydrates.
 */
export function MealsView({
  week,
  today,
  days,
  entries,
  meals,
  members,
  addAt,
  editId = null,
  openDay = null,
  newId,
  lunch,
  menus = [],
  notice,
  error,
}: MealsViewProps) {
  const plan = planByDay(entries, days);
  const mealsById = new Map(meals.map((m) => [m.id, m]));
  // [MEAL-10] An entry's people, in the family's order.
  const whose = (ids: string[]) =>
    members.filter((m) => ids.includes(m.id)).map((m) => ({ id: m.id, name: m.displayName }));
  const thisWeek = days.includes(today);
  // [MEAL-14] The day opened by itself: the edited entry's, else the one just added to or changed.
  const editing = editId ? entries.find((e) => e.id === editId) : undefined;
  const opened = editing?.planDate ?? (openDay && days.includes(openDay) ? openDay : null);

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/meals" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <section className="fw-card" aria-labelledby="meals-heading">
        <div className="fw-goals__head">
          <h1 id="meals-heading">Meals</h1>
          <Link href="/admin/meals/library" className="fw-btn fw-btn--secondary">
            <Icon name="book-open" className="fw-btn__icon" />
            <span>Meal library</span>
          </Link>
        </div>
        <p className="fw-muted">
          Plan breakfast, snack, lunch and dinner for the week: a meal from the library or anything
          you write in, for everyone or any mix of people.
        </p>
        <nav className="fw-actions" aria-label="Weeks">
          <Link className="fw-btn fw-btn--ghost" href={`/admin/meals?week=${addDays(week, -7)}`}>
            <Icon name="chevron-left" className="fw-btn__icon" />
            <span>Last week</span>
          </Link>
          {thisWeek ? null : (
            <Link className="fw-btn fw-btn--ghost" href="/admin/meals">
              <span>This week</span>
            </Link>
          )}
          <Link className="fw-btn fw-btn--ghost" href={`/admin/meals?week=${addDays(week, 7)}`}>
            <span>Next week</span>
            <Icon name="chevron-right" className="fw-btn__icon" />
          </Link>
        </nav>
        <h2 id="week-heading">{weekLabel(week)}</h2>
        <ol className="fw-meal-week" aria-labelledby="week-heading">
          {days.map((d) => {
            const slots = plan.get(d)!;
            const set = daySet(slots);
            return (
              <li
                key={d}
                className="fw-lunchday fw-meal-day"
                data-date={d}
                data-today={d === today ? true : undefined}
              >
                <details open={d === opened || undefined}>
                  <summary className="fw-lunchday__head" aria-label={dayWords(d, set, d === today)}>
                    <Icon name="chevron-right" className="fw-lunchday__chev" />
                    <span className="fw-lunchday__when">
                      <span className="fw-lunchday__name">{weekday.format(noon(d))}</span>
                      <span className="fw-lunchday__date">{monthDay.format(noon(d))}</span>
                      {d === today ? <span className="fw-lunchday__today">Today</span> : null}
                    </span>
                    <span className="fw-lunchday__end">
                      {set.complete ? (
                        <span className="fw-lunchday__check" role="img" aria-label="All set">
                          <Icon name="check" />
                        </span>
                      ) : (
                        <span className="fw-meal-day__count">{daySetWords(set)}</span>
                      )}
                    </span>
                  </summary>
                  <div className="fw-meal-day__body">
                    {SLOTS.map((s) => {
                      const list = slots[s];
                      const label = `${dayName(d)} ${SLOT_WORDS[s].toLowerCase()}`;
                      return (
                        <div
                          key={s}
                          id={`${d}-${s}`}
                          className="fw-meal-slot"
                          role="group"
                          aria-label={label}
                        >
                          <div className="fw-meal-slot__head">
                            <span className="fw-meal-slot__name">
                              <Icon name={SLOT_ICONS[s]} size={20} />
                              {SLOT_WORDS[s]}
                            </span>
                            <Link
                              className="fw-meal-slot__add"
                              href={`/admin/meals?week=${week}&day=${d}&slot=${s}#add`}
                              aria-label={`Add to ${label}`}
                            >
                              <Icon name="plus" size={20} />
                              Add
                            </Link>
                          </div>
                          {list.length ? (
                            <ul className="fw-meal-slot__list">
                              {list.map((e, i) => {
                                const name = entryName(e, mealsById);
                                const meal = e.mealId ? mealsById.get(e.mealId) : undefined;
                                const people = whose(e.memberIds);
                                const isEditing = e.id === editId;
                                return (
                                  <li key={e.id} className="fw-meal-entry" id={`entry-${e.id}`}>
                                    <span className="fw-meal-entry__name">
                                      {meal ? (
                                        <Icon name={meal.icon as IconName} size={20} />
                                      ) : null}
                                      {name}
                                      {people.map((p) => (
                                        <span key={p.id} className="fw-pill">
                                          {p.name}
                                        </span>
                                      ))}
                                    </span>
                                    {e.notes ? <span className="fw-muted">{e.notes}</span> : null}
                                    <details className="fw-meal-entry__change">
                                      <summary aria-label={`Change ${name}, ${label}`}>
                                        Change
                                      </summary>
                                      <form action={changeMealEntry} className="fw-actions">
                                        <input type="hidden" name="week" value={week} />
                                        <input type="hidden" name="at" value={`${d}-${s}`} />
                                        {list.length > 1 && i > 0 ? (
                                          <Button
                                            type="submit"
                                            name="act"
                                            value={`earlier:${e.id}`}
                                            variant="ghost"
                                            icon="chevron-up"
                                            aria-label={`Move ${name} earlier`}
                                          >
                                            Earlier
                                          </Button>
                                        ) : null}
                                        {list.length > 1 && i < list.length - 1 ? (
                                          <Button
                                            type="submit"
                                            name="act"
                                            value={`later:${e.id}`}
                                            variant="ghost"
                                            icon="chevron-down"
                                            aria-label={`Move ${name} later`}
                                          >
                                            Later
                                          </Button>
                                        ) : null}
                                        <Link
                                          className="fw-btn fw-btn--ghost"
                                          href={`/admin/meals?week=${week}&edit=${e.id}#entry-${e.id}`}
                                          aria-label={`Edit ${name}, ${label}`}
                                        >
                                          <Icon name="edit" className="fw-btn__icon" />
                                          <span>Edit</span>
                                        </Link>
                                        <Button
                                          type="submit"
                                          name="act"
                                          value={`remove:${e.id}`}
                                          variant="ghost"
                                          icon="trash"
                                          aria-label={`Remove ${name} from ${label}`}
                                        >
                                          Remove
                                        </Button>
                                      </form>
                                    </details>
                                    {isEditing ? (
                                      <EntryForm
                                        id={e.id}
                                        week={week}
                                        days={days}
                                        today={today}
                                        members={members}
                                        meals={meals}
                                        initialDay={e.planDate}
                                        initialSlot={e.slot}
                                        entry={e}
                                        name={name}
                                        cancelHref={`/admin/meals?week=${week}&open=${d}#${d}-${s}`}
                                      />
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      </section>

      <Fold
        id="add"
        title="Add to the plan"
        headingId="add-heading"
        open={addAt !== null}
        button={{ label: 'Add a meal', icon: 'plus' }}
      >
        <EntryForm
          key={`${newId}-${addAt?.day ?? ''}-${addAt?.slot ?? ''}`}
          id={newId}
          week={week}
          days={days}
          today={today}
          members={members}
          meals={meals}
          initialDay={addAt?.day ?? (days.includes(today) ? today : days[0]!)}
          initialSlot={addAt?.slot ?? 'dinner'}
        />
      </Fold>

      <Fold title="Copy last week" headingId="copy-heading">
        <p className="fw-muted">
          Everything planned for last week, copied into this week on the same days. Each copy can be
          changed on its own.
        </p>
        <form action={copyLastWeek} className="fw-form" aria-label="Copy last week">
          <input type="hidden" name="week" value={week} />
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">Where this week already has a meal planned</legend>
            <div className="fw-actions">
              <label className="fw-choice">
                <input type="radio" name="mode" value="skip" defaultChecked />
                Keep it
              </label>
              <label className="fw-choice">
                <input type="radio" name="mode" value="overwrite" />
                Replace it with last week’s
              </label>
            </div>
          </fieldset>
          <div className="fw-actions">
            <Button type="submit" variant="secondary" icon="copy">
              Copy last week here
            </Button>
          </div>
        </form>
      </Fold>

      <LunchSection week={week} today={today} lunch={lunch} menus={menus} members={members} />
    </main>
  );
}
