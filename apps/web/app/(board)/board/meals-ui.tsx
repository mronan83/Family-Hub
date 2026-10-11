'use client';

import { Avatar, Icon } from '@familywise/ui';
import { useMemo } from 'react';
import {
  type BoardLunch,
  type BoardMealDay,
  type BoardMealEntry,
  type BoardMeals,
  dayHead,
  hasMeals,
  MEAL_SLOTS,
  mealDay,
  type MealSlot,
  noLunchReason,
  SLOT_WORDS,
  weekDates,
} from '@/lib/board-meals';
import type { BoardMember } from '@/lib/snapshot';
import { iconOf } from './picture';

type People = Map<string, BoardMember>;

function Face({ id, people, size }: { id: string; people: People; size: number }) {
  const m = people.get(id);
  return m ? (
    <Avatar name={m.displayName} avatarKey={m.avatarKey} color={m.color} size={size} decorative />
  ) : null;
}

/**
 * [US-705] One planned meal: its picture (the library meal's icon, else the meal of the day's), what
 * it is, and whose (a face, when it is one person's).
 */
function Entry({ e, people, size }: { e: BoardMealEntry; people: People; size: number }) {
  const who = e.memberId ? people.get(e.memberId)?.displayName : null;
  return (
    <li className="fw-meals__entry" aria-label={who ? `${e.name}, for ${who}` : undefined}>
      <Icon name={iconOf(e.icon, e.slot)} size={size} className="fw-meals__icon" />
      <span className="fw-meals__name">{e.name}</span>
      {e.memberId ? <Face id={e.memberId} people={people} size={size} /> : null}
    </li>
  );
}

/** What a child's school lunch says: what the school serves, or what they bring. */
function lunchText(l: BoardLunch): string | null {
  if (l.mode === 'buy') return l.menu ?? (l.noMenu ? 'No menu yet' : null);
  return l.packed.length ? l.packed.join(' · ') : null;
}

/** [MEAL-04][MEAL-05] A child's school lunch: their face, Buys or Brings, and what it is. */
function Lunch({ l, people, size }: { l: BoardLunch; people: People; size: number }) {
  const who = people.get(l.memberId)?.displayName ?? 'Someone';
  const mode = l.mode === 'buy' ? 'Buys' : 'Brings';
  const text = lunchText(l);
  return (
    <li
      className="fw-meals__lunch"
      data-mode={l.mode}
      aria-label={`${who} ${mode.toLowerCase()} lunch${text ? `: ${text}` : ''}`}
    >
      <Face id={l.memberId} people={people} size={size} />
      <span className="fw-meals__mode" aria-hidden>
        {mode}
      </span>
      {text ? (
        <span className="fw-meals__name" data-none={l.noMenu || undefined} aria-hidden>
          {text}
        </span>
      ) : null}
    </li>
  );
}

/** A day's meals for one person: what's for everyone and what's theirs; with none, the whole day. */
function forMember(day: BoardMealDay, memberId?: string): BoardMealDay {
  if (!memberId) return day;
  const mine = (e: BoardMealEntry) => e.memberId === null || e.memberId === memberId;
  return {
    ...day,
    slots: {
      breakfast: day.slots.breakfast.filter(mine),
      snack: day.slots.snack.filter(mine),
      lunch: day.slots.lunch.filter(mine),
      dinner: day.slots.dinner.filter(mine),
    },
    lunch: day.lunch.filter((l) => l.memberId === memberId),
  };
}

/**
 * [MEAL-06][US-705][D-80] Today's meals, above Today's list on the home screen (WP-28): breakfast,
 * snack, lunch (with each child's school lunch) and dinner, each only when something is planned.
 * Nothing shows on a day with no meals.
 */
export function TodayMeals({
  meals,
  today,
  members,
  memberId,
}: {
  meals: BoardMeals | null;
  today: string;
  members: BoardMember[];
  /** On a person's own screen: what's for everyone, and theirs; as a card. */
  memberId?: string;
}) {
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const day = forMember(mealDay(meals, today), memberId);
  if (!hasMeals(day)) return null;
  const id = memberId ? 'me-meals' : 'dash-meals';
  return (
    <section className={memberId ? 'fw-today__card' : 'fw-dash__meals'} aria-labelledby={id}>
      {memberId ? (
        <h3 id={id}>Today’s meals</h3>
      ) : (
        <h2 id={id} className="fw-dash__head">
          <Icon name="utensils" size={40} />
          Today’s meals
        </h2>
      )}
      <dl className="fw-meals">
        {MEAL_SLOTS.map((slot) => {
          const entries = day.slots[slot];
          const lunch = slot === 'lunch' ? day.lunch : [];
          if (!entries.length && !lunch.length) return null;
          return (
            <div key={slot} className="fw-meals__slot" data-slot={slot}>
              <dt>{SLOT_WORDS[slot]}</dt>
              <dd>
                <ul className="fw-meals__list">
                  {entries.map((e) => (
                    <Entry key={e.id} e={e} people={people} size={40} />
                  ))}
                  {lunch.map((l) => (
                    <Lunch key={l.memberId} l={l} people={people} size={40} />
                  ))}
                </ul>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

/** The slots a week shows: dinner always, and any other meal planned on one of its days. */
function weekSlots(days: BoardMealDay[]): MealSlot[] {
  return MEAL_SLOTS.filter((s) => s === 'dinner' || days.some((d) => d.slots[s].length));
}

/**
 * [MEAL-06][US-705][D-80] The Meals screen (WP-28): the household week, a column a day and a row a
 * meal, then each child's school lunch; today stands out. It only shows: plans change on Meals in
 * the admin app.
 */
export function MealsWeek({
  meals,
  today,
  members,
}: {
  meals: BoardMeals | null;
  today: string;
  members: BoardMember[];
}) {
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const dates = weekDates(meals?.weekFrom ?? today);
  const days = dates.map((d) => mealDay(meals, d));
  const slots = weekSlots(days);
  const school = (meals?.lunch.length ?? 0) > 0;
  const planned = days.some(hasMeals);
  return (
    <section className="fw-mweek" aria-labelledby="mweek-title">
      <h2 id="mweek-title" className="fw-mweek__title">
        <Icon name="utensils" size={48} />
        Meals this week
        <span className="fw-mweek__sub">
          {dayHead(dates[0]!, true)} to {dayHead(dates[6]!, true)}
        </span>
      </h2>
      {planned ? null : (
        <p className="fw-today__muted">Nothing planned this week yet: plan meals on Meals.</p>
      )}
      <div className="fw-mweek__wrap">
        <table className="fw-mweek__grid">
          <thead>
            <tr>
              <td />
              {dates.map((d) => (
                <th
                  key={d}
                  scope="col"
                  className="fw-mweek__day"
                  aria-current={d === today ? 'date' : undefined}
                >
                  {dayHead(d)}
                  {d === today ? <span className="fw-mweek__today">Today</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot} data-slot={slot}>
                <th scope="row">{SLOT_WORDS[slot]}</th>
                {days.map((day) => (
                  <td key={day.date} aria-current={day.date === today ? 'date' : undefined}>
                    {day.slots[slot].length ? (
                      <ul className="fw-meals__list">
                        {day.slots[slot].map((e) => (
                          <Entry key={e.id} e={e} people={people} size={28} />
                        ))}
                      </ul>
                    ) : (
                      <span className="fw-mweek__empty" aria-label="Nothing planned">
                        –
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {school ? (
              <tr data-slot="school">
                <th scope="row">School lunch</th>
                {days.map((day) => {
                  const why = noLunchReason(meals, day.date);
                  return (
                    <td key={day.date} aria-current={day.date === today ? 'date' : undefined}>
                      {day.lunch.length ? (
                        <ul className="fw-meals__list">
                          {day.lunch.map((l) => (
                            <Lunch key={l.memberId} l={l} people={people} size={36} />
                          ))}
                        </ul>
                      ) : (
                        <span className="fw-mweek__empty">{why ?? '–'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
