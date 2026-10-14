import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { addDays, dayName } from '@/lib/board-calendar';
import {
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

export interface MealsViewProps {
  /** The first day of the week shown, and today, both household dates. */
  week: string;
  today: string;
  days: string[];
  entries: PlanEntry[];
  meals: MealRow[];
  members: { id: string; displayName: string }[];
  /** A day and slot to add to, from an "Add" link. */
  addAt: { day: string; slot: Slot } | null;
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
 * for everyone or any set of people, with a note) with Change (earlier, later, remove) and Add; the week
 * before and after; "Add to the plan"; and copying last week here.
 */
export function MealsView({
  week,
  today,
  days,
  entries,
  meals,
  members,
  addAt,
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
            return (
              <li key={d} className="fw-meal-day" data-today={d === today ? true : undefined}>
                <h3 className="fw-meal-day__name" id={`day-${d}`}>
                  {dayName(d)}
                  {d === today ? <span className="fw-pill">Today</span> : null}
                </h3>
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
                            return (
                              <li key={e.id} className="fw-meal-entry">
                                <span className="fw-meal-entry__name">
                                  {meal ? <Icon name={meal.icon as IconName} size={20} /> : null}
                                  {name}
                                  {people.map((p) => (
                                    <span key={p.id} className="fw-pill">
                                      {p.name}
                                    </span>
                                  ))}
                                </span>
                                {e.notes ? <span className="fw-muted">{e.notes}</span> : null}
                                <details className="fw-meal-entry__change">
                                  <summary aria-label={`Change ${name}, ${label}`}>Change</summary>
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
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </section>

      <LunchSection
        week={week}
        days={days}
        lunch={lunch}
        menus={menus}
        names={new Map(members.map((m) => [m.id, m.displayName]))}
      />

      <section className="fw-card" id="add" aria-labelledby="add-heading">
        <h2 id="add-heading">Add to the plan</h2>
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
      </section>

      <section className="fw-card" aria-labelledby="copy-heading">
        <h2 id="copy-heading">Copy last week</h2>
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
      </section>
    </main>
  );
}
