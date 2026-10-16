'use client';

import { Avatar, type AvatarKey, Button, Icon, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import { type ReactNode, useSyncExternalStore } from 'react';
import { useFormStatus } from 'react-dom';
import { type LunchChild, type LunchDay, MODE_WORDS } from '@/lib/lunch';
import {
  daySections,
  hasDaysToPick,
  LAST_CHILD_KEY,
  lunchDayStatus,
  openOn,
  schoolWeek,
} from '@/lib/lunch-list';
import { menuChanged, pickName, pickValue } from '@/lib/lunch-picks';
import { optionWords, pickOne, sectionLabel } from '@/lib/menu/sections';
import { setLunchDay, setLunchPicks } from './actions';
import { MenuText } from './menu-text';

/** A child of the list: their lunch week, their name and their face. */
export interface LunchListChild extends LunchChild {
  name: string;
  avatarKey?: AvatarKey | null;
  color?: MemberColor;
}

// The child chosen last, kept on this device (D-98). A store, so the page reads it as it hydrates.
const listeners = new Set<() => void>();
function subscribe(on: () => void) {
  listeners.add(on);
  window.addEventListener('storage', on);
  return () => {
    listeners.delete(on);
    window.removeEventListener('storage', on);
  };
}
function lastChild(): string | null {
  try {
    return window.localStorage.getItem(LAST_CHILD_KEY);
  } catch {
    return null;
  }
}
function choose(id: string) {
  try {
    window.localStorage.setItem(LAST_CHILD_KEY, id);
  } catch {
    // Storage blocked: the choice holds until the page is left.
  }
  chosenHere = id;
  listeners.forEach((on) => on());
}
let chosenHere: string | null = null;
const noChange = () => () => {};

const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const monthDay = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const noon = (date: string) => new Date(`${date}T12:00:00Z`);

/** [D-110] A submit that waits for the page to hydrate, and says so while it saves. */
function Submit({
  hydrated,
  children,
  ...rest
}: {
  hydrated: boolean;
  children: ReactNode;
} & Omit<Parameters<typeof Button>[0], 'children' | 'type'>) {
  const { pending } = useFormStatus();
  return (
    <Button {...rest} type="submit" disabled={!hydrated || pending} aria-busy={pending}>
      {children}
    </Button>
  );
}

/**
 * [MEAL-13][US-710] The lunch week as a list of days (WP-74, D-98), for one child at a time: a row
 * of the children's faces (none for a single child), opening on the child chosen last on this
 * device, with a dot on a child who still has a day without a choice; then their Monday to Friday,
 * every day closed at first. Closed, a day says its weekday, date, Buy or Bring, and a check once
 * it's complete; opened, Buy or Bring changes at the top and a Buy day lists its menu, a section
 * each, the picks checked. A day without school is greyed and doesn't open; today is outlined.
 * Changes and picks save as before (WP-26, WP-49), once the page has hydrated.
 */
export function LunchWeek({
  week,
  today,
  lunch,
}: {
  week: string;
  today: string;
  lunch: LunchListChild[];
}) {
  const hydrated = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  const stored = useSyncExternalStore(
    subscribe,
    () => chosenHere ?? lastChild(),
    () => null,
  );
  const shown = openOn(lunch, stored);
  return (
    <>
      {lunch.length > 1 ? (
        <div className="fw-lunchkids" role="group" aria-label="Whose lunches">
          {lunch.map((c) => {
            const dot = hasDaysToPick(c, today);
            return (
              <button
                key={c.memberId}
                type="button"
                className="fw-lunchkids__kid"
                aria-pressed={c.memberId === shown}
                aria-label={dot ? `${c.name}, has days to pick` : c.name}
                onClick={() => choose(c.memberId)}
              >
                <span className="fw-lunchkids__face">
                  <Avatar
                    name={c.name}
                    avatarKey={c.avatarKey}
                    color={c.color}
                    size={44}
                    decorative
                  />
                  {dot ? <span className="fw-lunchkids__dot" /> : null}
                </span>
                <span>{c.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {lunch.map((c) => (
        <ol
          key={c.memberId}
          className="fw-lunchdays"
          aria-label={`${c.name}’s lunch week`}
          hidden={c.memberId !== shown}
        >
          {schoolWeek(c.days).map((d) => (
            <Day
              key={d.date}
              week={week}
              child={c}
              d={d}
              today={d.date === today}
              hydrated={hydrated}
            />
          ))}
        </ol>
      ))}
    </>
  );
}

function Day({
  week,
  child,
  d,
  today,
  hydrated,
}: {
  week: string;
  child: LunchListChild;
  d: LunchDay;
  today: boolean;
  hydrated: boolean;
}) {
  const status = lunchDayStatus(d);
  const name = weekday.format(noon(d.date));
  const date = monthDay.format(noon(d.date));
  const head = (
    <>
      <span className="fw-lunchday__when">
        <span className="fw-lunchday__name">{name}</span>
        <span className="fw-lunchday__date">{date}</span>
        {today ? <span className="fw-lunchday__today">Today</span> : null}
      </span>
      <span className="fw-lunchday__end">
        {status === 'no-school' ? (
          <span className="fw-lunchday__none">No school</span>
        ) : (
          <>
            {/* [MEAL-09] A child's change waiting for a parent (WP-49). */}
            {d.request?.status === 'waiting' ? (
              <span className="fw-lunchday__waiting">Waiting</span>
            ) : null}
            <span className="fw-lunchday__mode" data-mode={d.mode}>
              {MODE_WORDS[d.mode!]}
            </span>
            {status === 'complete' ? (
              <span className="fw-lunchday__check" role="img" aria-label="Complete">
                <Icon name="check" />
              </span>
            ) : (
              <span className="fw-lunchday__todo" role="img" aria-label="Not picked yet" />
            )}
          </>
        )}
      </span>
    </>
  );
  if (status === 'no-school') {
    return (
      <li
        className="fw-lunchday fw-lunchday--off"
        data-date={d.date}
        data-today={today || undefined}
      >
        <div className="fw-lunchday__head">
          <span className="fw-lunchday__chev" />
          {head}
        </div>
      </li>
    );
  }
  return (
    <li className="fw-lunchday" data-date={d.date} data-today={today || undefined}>
      <details>
        <summary className="fw-lunchday__head">
          <Icon name="chevron-right" className="fw-lunchday__chev" />
          {head}
        </summary>
        <div className="fw-lunchday__body">
          <form action={setLunchDay} className="fw-lunchday__toggle">
            <input type="hidden" name="week" value={week} />
            <div role="group" aria-label={`${child.name}, ${name}: buy or bring`}>
              {(['buy', 'bring'] as const).map((m) =>
                m === d.mode ? (
                  <button key={m} type="button" className="fw-lunchday__opt-mode" aria-pressed>
                    {MODE_WORDS[m]}
                  </button>
                ) : (
                  <ModeSubmit
                    key={m}
                    hydrated={hydrated}
                    value={`${child.memberId}:${d.date}:${m}`}
                    label={MODE_WORDS[m]}
                  />
                ),
              )}
            </div>
          </form>
          {d.changed ? (
            <span className="fw-lunch__changed">
              {d.byBoard ? 'Changed on the board' : 'Changed from the usual'}
            </span>
          ) : null}
          {d.request?.status === 'waiting' ? (
            <Link href="/admin/today" className="fw-lunch__waiting">
              {d.request.mode === d.mode
                ? 'New picks waiting'
                : `${MODE_WORDS[d.request.mode]}? waiting`}
            </Link>
          ) : null}
          {d.mode === 'buy' ? <BuyDay week={week} child={child} d={d} hydrated={hydrated} /> : null}
        </div>
      </details>
    </li>
  );
}

function ModeSubmit({
  hydrated,
  value,
  label,
}: {
  hydrated: boolean;
  value: string;
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="lunch"
      value={value}
      className="fw-lunchday__opt-mode"
      aria-pressed={false}
      disabled={!hydrated || pending}
      aria-busy={pending}
    >
      {label}
    </button>
  );
}

/**
 * [MEAL-11][MEAL-13] A Buy day opened: the day's menu, a section each, with its options; the picks
 * checked and highlighted. One option where a section says "Choice of", any number elsewhere; each
 * section's inputs have a name of their own (WP-78). Saved with "Save …'s picks" (WP-49).
 */
function BuyDay({
  week,
  child,
  d,
  hydrated,
}: {
  week: string;
  child: LunchListChild;
  d: LunchDay;
  hydrated: boolean;
}) {
  if (!child.menuSourceId)
    return (
      <p className="fw-muted">{`No school menu for ${child.name}: choose one under Usual week.`}</p>
    );
  const sections = daySections(d);
  const picks = d.choices ?? [];
  if (!sections.length)
    return d.menu ? <MenuText day={d.menu} /> : <p className="fw-muted">No menu yet.</p>;
  return (
    <form action={setLunchPicks} className="fw-form fw-lunchday__picks">
      <input type="hidden" name="week" value={week} />
      <input type="hidden" name="member" value={child.memberId} />
      <input type="hidden" name="day" value={d.date} />
      {menuChanged(picks, sections) ? (
        <span className="fw-lunch__flag">Menu changed: look again</span>
      ) : null}
      {sections.map((s, i) => {
        const key = s.title ?? '';
        const one = pickOne(s.title);
        const mine = picks.find((p) => p.section === key)?.options ?? [];
        return (
          <fieldset key={key || i} className="fw-lunchday__section">
            <legend>
              {s.title ? sectionLabel(s.title) : 'Menu'}
              <span className="fw-muted">{one ? ' · pick one' : ' · any'}</span>
            </legend>
            <div className="fw-lunchday__opts">
              {s.options.map((o, j) => (
                <label key={j} className="fw-lunchday__opt">
                  <input
                    type={one ? 'radio' : 'checkbox'}
                    name={pickName(i)}
                    value={pickValue(key, j + 1, o.name)}
                    defaultChecked={mine.includes(j + 1)}
                  />
                  <span>{optionWords(o)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      <div className="fw-actions">
        <Submit hydrated={hydrated} variant="primary" icon="check">
          {`Save ${child.name}’s picks`}
        </Submit>
      </div>
    </form>
  );
}
