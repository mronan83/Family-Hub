'use client';

import { Avatar, Button, Icon } from '@familywise/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  weekMenus,
} from '@/lib/board-meals';
import { type MenuOption, type MenuSection, sectionLabel } from '@/lib/menu/sections';
import { peopleWords } from '@/lib/meals';
import type { BoardMember } from '@/lib/snapshot';
import { iconOf } from './picture';

type People = Map<string, BoardMember>;

function Face({ id, people, size }: { id: string; people: People; size: number }) {
  const m = people.get(id);
  return m ? (
    <Avatar name={m.displayName} avatarKey={m.avatarKey} color={m.color} size={size} decorative />
  ) : null;
}

/** [MEAL-10] An entry's people in the family's order (children first, then by name). */
function inOrder(ids: string[], people: People): BoardMember[] {
  return [...people.values()].filter((m) => ids.includes(m.id));
}

/**
 * [US-705][MEAL-10] One planned meal: its picture (the library meal's icon, else the meal of the
 * day's), what it is, and whose (each person's face, in the family's order; none for everyone).
 */
function Entry({ e, people, size }: { e: BoardMealEntry; people: People; size: number }) {
  const whose = inOrder(e.memberIds, people);
  const who = peopleWords(whose.map((m) => m.displayName));
  return (
    <li className="fw-meals__entry" aria-label={who ? `${e.name}, for ${who}` : undefined}>
      <Icon name={iconOf(e.icon, e.slot)} size={size} className="fw-meals__icon" />
      <span className="fw-meals__name">{e.name}</span>
      {whose.length ? (
        <span className="fw-meals__faces">
          {whose.map((m) => (
            <Face key={m.id} id={m.id} people={people} size={size} />
          ))}
        </span>
      ) : null}
    </li>
  );
}

/** What a child's school lunch says: what the school serves, or what they bring. */
function lunchText(l: BoardLunch): string | null {
  if (l.mode === 'buy') return l.menu ?? (l.noMenu ? 'No menu yet' : null);
  return l.packed.length ? l.packed.join(' · ') : null;
}

/**
 * [MEAL-04][MEAL-05][MENU-06] A child's school lunch: their face, Buys or Brings, and what it is.
 * On the home screen a buy day's entree options sit on one line, cut short with "…" when they don't
 * fit, and a tap opens the day's whole menu (WP-64, D-94). On the week, `brief` leaves the menu to
 * the menu's own rows.
 */
function Lunch({
  l,
  people,
  size,
  brief,
  onOpen,
}: {
  l: BoardLunch;
  people: People;
  size: number;
  brief?: boolean;
  onOpen?: (l: BoardLunch) => void;
}) {
  const who = people.get(l.memberId)?.displayName ?? 'Someone';
  const mode = l.mode === 'buy' ? 'Buys' : 'Brings';
  // [MEAL-11] On the week, a buy day with picks shows them all in place of the options (WP-49).
  const text = brief && l.mode === 'buy' && !l.noMenu ? (l.picked ?? null) : lunchText(l);
  const said = `${who} ${mode.toLowerCase()} lunch${text ? `: ${text}` : ''}`;
  const opens = !!(onOpen && l.sections?.length);
  return (
    <li className="fw-meals__lunch" data-mode={l.mode} aria-label={said}>
      <Face id={l.memberId} people={people} size={size} />
      <span className="fw-meals__mode" aria-hidden>
        {mode}
      </span>
      {opens ? (
        <button
          type="button"
          className="fw-meals__menu"
          aria-label={`Show ${who}’s whole lunch menu`}
          onClick={() => onOpen!(l)}
        >
          <span className="fw-meals__menu-text">{text}</span>
          <Icon name="chevron-right" size={size} />
        </button>
      ) : text ? (
        <span className="fw-meals__name" data-none={l.noMenu || undefined} aria-hidden>
          {text}
        </span>
      ) : null}
      {l.menuChanged ? <span className="fw-lunches__changed">Menu changed</span> : null}
    </li>
  );
}

/** [MENU-06] An option on its own line, its sides after "with" in the softer colour. */
function Option({ o }: { o: MenuOption }) {
  return (
    <li>
      {o.name}
      {o.sides.length ? (
        <span className="fw-menu__with"> with {o.sides.join(' with ')}</span>
      ) : null}
    </li>
  );
}

/**
 * [MENU-06][US-804] A buy day's whole menu, from a tap on a child's lunch on the home screen
 * (WP-64, D-94): each section and its options. Read only; it closes with Close or Escape.
 */
function LunchDetails({
  l,
  people,
  onClose,
}: {
  l: BoardLunch;
  people: People;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.fw-details__close')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const who = people.get(l.memberId)?.displayName ?? 'Someone';
  return (
    <div className="fw-today__scrim">
      <div
        ref={box}
        className="fw-today__picker fw-details fw-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lunch-title"
      >
        <header className="fw-details__head">
          <Face id={l.memberId} people={people} size={56} />
          <h2 id="lunch-title">{`${who} buys lunch today`}</h2>
        </header>
        {l.picked ? (
          <p className="fw-lunches__picked">
            <strong>Picked: </strong>
            {l.picked}
            {l.menuChanged ? <span className="fw-lunches__changed">Menu changed</span> : null}
          </p>
        ) : null}
        <MenuList sections={l.sections ?? []} />
        <div className="fw-today__picker-actions">
          <Button variant="secondary" icon="close" className="fw-details__close" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/** [MENU-06] A day's menu, a section a heading with its options under it. */
export function MenuList({ sections }: { sections: MenuSection[] }) {
  return (
    <dl className="fw-details__facts fw-menu__sections">
      {sections.map((s, i) => (
        <div key={s.title ?? i} className="fw-menu__section">
          <dt>{s.title ? sectionLabel(s.title) : 'Menu'}</dt>
          <dd>
            <ul className="fw-menu__options">
              {s.options.map((o, j) => (
                <Option key={j} o={o} />
              ))}
            </ul>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * [MEAL-10] A day's meals for one person: what's for everyone and the entries that include them;
 * with none, the whole day.
 */
function forMember(day: BoardMealDay, memberId?: string): BoardMealDay {
  if (!memberId) return day;
  const mine = (e: BoardMealEntry) => !e.memberIds.length || e.memberIds.includes(memberId);
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
  const [open, setOpen] = useState<BoardLunch | null>(null);
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
                    <Lunch key={l.memberId} l={l} people={people} size={40} onOpen={setOpen} />
                  ))}
                </ul>
              </dd>
            </div>
          );
        })}
      </dl>
      {open ? <LunchDetails l={open} people={people} onClose={() => setOpen(null)} /> : null}
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
  onLunches,
}: {
  meals: BoardMeals | null;
  today: string;
  members: BoardMember[];
  /** [MEAL-09] Opens Lunches, where a child picks their coming week (WP-49). */
  onLunches?: () => void;
}) {
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const dates = weekDates(meals?.weekFrom ?? today);
  const days = dates.map((d) => mealDay(meals, d));
  const slots = weekSlots(days);
  const school = (meals?.lunch.length ?? 0) > 0;
  const menus = weekMenus(meals);
  const planned = days.some(hasMeals);
  return (
    <section className="fw-mweek" aria-labelledby="mweek-title">
      <h2 id="mweek-title" className="fw-mweek__title">
        <Icon name="utensils" size={48} />
        Meals this week
        <span className="fw-mweek__sub">
          {dayHead(dates[0]!, true)} to {dayHead(dates[6]!, true)}
        </span>
        {school && onLunches ? (
          <Button variant="secondary" icon="lunch" onClick={onLunches}>
            Lunches
          </Button>
        ) : null}
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
                            <Lunch key={l.memberId} l={l} people={people} size={36} brief />
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
            {menus.map((m) => (
              <MenuRows key={m.sourceId} menu={m} dates={dates} today={today} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * [MENU-06][US-804] A school menu's rows on the Meals screen (WP-64, D-94): its name, then a row a
 * section, each day's options on lines of their own; a day with nothing from it shows "–".
 */
function MenuRows({
  menu,
  dates,
  today,
}: {
  menu: ReturnType<typeof weekMenus>[number];
  dates: string[];
  today: string;
}) {
  return (
    <>
      <tr className="fw-mweek__menu-head" data-slot="menu">
        <th scope="rowgroup" colSpan={8}>
          {`School menu · ${menu.name}`}
        </th>
      </tr>
      {menu.rows.map((r) => (
        <tr key={r.title ?? ''} data-slot="menu">
          <th scope="row">{r.label ?? 'Menu'}</th>
          {dates.map((d) => {
            const day = menu.days.get(d);
            const s = day?.sections.find((x) => x.title === r.title);
            return (
              <td key={d} aria-current={d === today ? 'date' : undefined}>
                {s ? (
                  <ul className="fw-menu__options">
                    {s.options.map((o, j) => (
                      <Option key={j} o={o} />
                    ))}
                  </ul>
                ) : (
                  <span className="fw-mweek__empty">{day?.noService ?? '–'}</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
