'use client';

import { Avatar, Button, Icon } from '@familywise/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dayHead } from '@/lib/board-meals';
import {
  type LunchChild,
  type LunchDay,
  type LunchMode,
  type LunchPick,
  noLunchWords,
} from '@/lib/lunch';
import {
  type AskLunch,
  comingWeek,
  dayLine,
  lunchAnswerWords,
  menuChanged,
  missingPicks,
  picksWords,
  readWeek,
  type SeenLunch,
  shownDay,
  togglePick,
} from '@/lib/lunch-picks';
import { menuSections, type MenuSection, pickOne, sectionLabel } from '@/lib/menu/sections';
import type { BoardMember } from '@/lib/snapshot';

/** Reads each child's lunches for the seven days from a date (lunch_week); null offline. */
export type LoadLunches = (from: string) => Promise<LunchChild[] | null>;

/**
 * The week's lunches as the database has them, read again whenever the snapshot is (a change heard
 * through Realtime, D-80) and after this board's own change. A failed read is made again, up to
 * three reads (WP-77), before it gives up.
 */
function useWeek(load: LoadLunches | undefined, from: string, fetchedAt: string) {
  const [week, setWeek] = useState<{ from: string; children: LunchChild[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!load) return;
    let cancelled = false;
    void readWeek(
      () => load(from),
      undefined,
      undefined,
      () => cancelled,
    ).then((children) => {
      if (cancelled) return;
      if (children) {
        setWeek({ from, children });
        setFailed(false);
      } else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [load, from, fetchedAt, n]);
  const again = useCallback(() => setN((x) => x + 1), []);
  return { children: week?.from === from ? week.children : null, failed, again };
}

/** A day's menu by section, when it has one to pick from. */
function sectionsOf(d: LunchDay): MenuSection[] | null {
  return d.menu && !d.menu.noService && d.menu.items.length ? menuSections(d.menu.items) : null;
}

/**
 * [MEAL-11][US-707] A day's choices (D-89, D-94): each section of the day's menu with its options as
 * buttons, one to pick where it says "Choice of", any number elsewhere. Save sends the day as Buy
 * with these picks; it waits for a parent like any change.
 */
function DayChoices({
  date,
  who,
  sections,
  initial,
  onSave,
  onCancel,
}: {
  date: string;
  who: string;
  sections: MenuSection[];
  initial: LunchPick[];
  onSave: (picks: LunchPick[]) => void;
  onCancel: () => void;
}) {
  const [picks, setPicks] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('.fw-lunches__option')?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onCancel]);
  const missing = missingPicks(picks, sections);
  return (
    <div className="fw-today__scrim">
      <div
        ref={box}
        className="fw-today__picker fw-lunches__choices"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choices-title"
      >
        <h2 id="choices-title">{`${who}’s lunch on ${dayHead(date, true)}`}</h2>
        {sections.map((s, i) => {
          const key = s.title ?? '';
          const mine = picks.find((p) => p.section === key)?.options ?? [];
          const one = pickOne(s.title);
          const label = s.title ? sectionLabel(s.title) : 'Menu';
          return (
            <section key={key || i} className="fw-lunches__section" aria-labelledby={`sec-${i}`}>
              <h3 id={`sec-${i}`}>
                {label}
                <span className="fw-lunches__hint">{one ? 'Pick one' : 'Pick any'}</span>
              </h3>
              <ul className="fw-lunches__options" aria-labelledby={`sec-${i}`}>
                {s.options.map((o, j) => {
                  const on = mine.includes(j + 1);
                  return (
                    <li key={j}>
                      <button
                        type="button"
                        className="fw-lunches__option"
                        aria-pressed={on}
                        onClick={() => setPicks((p) => togglePick(p, s, j + 1))}
                      >
                        {on ? <Icon name="check-circle" size={36} /> : null}
                        <span>
                          {o.name}
                          {o.sides.length ? (
                            <span className="fw-menu__with"> with {o.sides.join(' with ')}</span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {missing.length ? (
          <p className="fw-lunches__hint">{`Still to pick: ${missing.join(' and ')}`}</p>
        ) : null}
        <div className="fw-today__picker-actions">
          <Button icon="check" onClick={() => onSave(picks)}>
            Save
          </Button>
          <Button variant="ghost" icon="close" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * [MEAL-09][MEAL-11][US-707] One school day of the week: Buy or Bring (the usual already set), the
 * picks of a buy day or "Pick your lunch", and how the change stands ("Waiting for a parent", "Sam
 * kept Buy"). An earlier day, or today after the cut-off, is locked.
 */
function DayCard({
  d,
  today,
  busy,
  online,
  onMode,
  onPick,
}: {
  d: LunchDay;
  today: string;
  busy: boolean;
  online: boolean;
  onMode: (mode: LunchMode) => void;
  onPick: () => void;
}) {
  const head = dayHead(d.date);
  if (!d.mode) {
    return (
      <li className="fw-lunches__day" data-date={d.date} data-mode="none">
        <h3>{head}</h3>
        <p className="fw-lunches__none">{noLunchWords(d.dayType)}</p>
      </li>
    );
  }
  const shown = shownDay(d);
  const sections = sectionsOf(d);
  const line = dayLine(d);
  const locked = !d.open;
  const changed = shown.mode === 'buy' && menuChanged(shown.picks, sections);
  return (
    <li
      className="fw-lunches__day"
      data-date={d.date}
      data-mode={shown.mode ?? 'none'}
      data-state={d.request?.status ?? (locked ? 'locked' : 'open')}
      aria-current={d.date === today ? 'date' : undefined}
    >
      <h3>{head}</h3>
      <div className="fw-lunches__modes" role="group" aria-label={`${head}: buy or bring`}>
        {(['buy', 'bring'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="fw-lunches__mode"
            aria-pressed={shown.mode === m}
            disabled={locked || busy || !online}
            onClick={() => shown.mode !== m && onMode(m)}
          >
            <Icon name={m} size={36} />
            {m === 'buy' ? 'Buy' : 'Bring'}
          </button>
        ))}
      </div>
      {line ? (
        <p className="fw-lunches__line" data-kind={d.request?.status}>
          <Icon name={d.request?.status === 'waiting' ? 'clock' : 'info'} size={32} />
          {line}
        </p>
      ) : null}
      {shown.mode === 'buy' ? (
        shown.picks.length ? (
          <button
            type="button"
            className="fw-lunches__picks"
            disabled={locked || busy || !online || !sections}
            onClick={onPick}
            aria-label={`${head}: ${picksWords(shown.picks, sections)}. Change`}
          >
            {picksWords(shown.picks, sections)}
          </button>
        ) : sections && !locked ? (
          <Button variant="secondary" icon="lunch" disabled={busy || !online} onClick={onPick}>
            Pick your lunch
          </Button>
        ) : (
          <p className="fw-lunches__none">{sections ? 'Nothing picked' : 'No menu yet'}</p>
        )
      ) : null}
      {changed ? <span className="fw-lunches__changed">Menu changed</span> : null}
      {locked ? (
        <p className="fw-lunches__none">
          <Icon name="lock" size={28} />
          Locked
        </p>
      ) : null}
    </li>
  );
}

/**
 * [MEAL-09][MEAL-11][US-707][D-95] Lunches on the board (WP-49): a child's coming school week (Monday
 * to Friday after a Sunday, D-94), each day's Buy or Bring and a buy day's picks from its menu. A
 * change waits for a parent, who approves it on Today. Done checks off the item that opened it, and
 * clears a parent's "kept" lines. Changing needs the internet: a change isn't queued.
 */
export function LunchesScreen({
  members,
  childIds,
  memberId,
  today,
  fetchedAt,
  online,
  load,
  ask,
  seen,
  onChild,
  onDone,
  say,
}: {
  members: BoardMember[];
  /** The children with a school lunch, in the family's order. */
  childIds: string[];
  memberId: string;
  today: string;
  fetchedAt: string;
  online: boolean;
  load?: LoadLunches;
  ask: AskLunch;
  seen: SeenLunch;
  onChild: (id: string) => void;
  onDone: () => void;
  say: (text: string) => void;
}) {
  const [weeks, setWeeks] = useState(0);
  const dates = comingWeek(today, weeks);
  const week = useWeek(load, dates[0]!, fetchedAt);
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const child = week.children?.find((c) => c.memberId === memberId) ?? null;
  const days = dates.map(
    (date) =>
      child?.days.find((d) => d.date === date) ??
      ({ date, dayType: 'school_day', mode: null, changed: false } as LunchDay),
  );
  const who = people.get(memberId)?.displayName ?? 'Your';

  const send = async (d: LunchDay, mode: LunchMode, picks: LunchPick[]) => {
    setBusy(d.date);
    const answer = await ask(memberId, d.date, mode, picks);
    setBusy(null);
    week.again();
    if (answer.ok) {
      say(answer.waiting ? 'Sent. A parent will look at it.' : 'Back as it was.');
      return true;
    }
    say('offline' in answer ? 'Lunches need the internet.' : lunchAnswerWords(answer.reason));
    return false;
  };

  const choose = choosing ? days.find((d) => d.date === choosing) : undefined;
  const chooseSections = choose ? sectionsOf(choose) : null;

  return (
    <section className="fw-lunches" aria-labelledby="lunches-title">
      <header className="fw-lunches__head">
        <h2 id="lunches-title" className="fw-mweek__title">
          <Icon name="lunch" size={48} />
          {`${who}’s lunches`}
          <span className="fw-mweek__sub">
            {dayHead(dates[0]!, true)} to {dayHead(dates[4]!, true)}
          </span>
        </h2>
        {childIds.length > 1 ? (
          <ul className="fw-lunches__children" aria-label="Whose lunches">
            {childIds.map((id) => {
              const m = people.get(id);
              return m ? (
                <li key={id}>
                  <button
                    type="button"
                    className="fw-lunches__child"
                    aria-pressed={id === memberId}
                    onClick={() => onChild(id)}
                  >
                    <Avatar
                      name={m.displayName}
                      avatarKey={m.avatarKey}
                      color={m.color}
                      size={56}
                      decorative
                    />
                    {m.displayName}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        ) : null}
        <div className="fw-lunches__weeks">
          <Button
            variant="ghost"
            icon="chevron-left"
            disabled={weeks === 0}
            onClick={() => setWeeks(0)}
          >
            This week
          </Button>
          <Button
            variant="ghost"
            icon="chevron-right"
            disabled={weeks === 1}
            onClick={() => setWeeks(1)}
          >
            Next week
          </Button>
        </div>
      </header>
      {!week.children ? (
        <p className="fw-today__muted">
          {week.failed || !online ? 'Lunches need the internet.' : 'Getting the week…'}
        </p>
      ) : !child ? (
        <p className="fw-today__muted">{`${who} has no school lunch to pick.`}</p>
      ) : (
        <ol className="fw-lunches__days" aria-label={`${who}’s week`}>
          {days.map((d) => (
            <DayCard
              key={d.date}
              d={d}
              today={today}
              busy={busy === d.date}
              online={online}
              onMode={async (mode) => {
                const ok = await send(d, mode, []);
                // Buying: straight on to the day's choices, when there is a menu to pick from.
                if (ok && mode === 'buy' && sectionsOf(d)) setChoosing(d.date);
              }}
              onPick={() => setChoosing(d.date)}
            />
          ))}
        </ol>
      )}
      <div className="fw-lunches__done">
        <p className="fw-today__muted">Changes wait for a parent to say yes.</p>
        <Button
          icon="check"
          onClick={() => {
            void seen(memberId);
            onDone();
          }}
        >
          Done
        </Button>
      </div>
      {choose && chooseSections ? (
        <DayChoices
          date={choose.date}
          who={who}
          sections={chooseSections}
          initial={shownDay(choose).mode === 'buy' ? shownDay(choose).picks : []}
          onCancel={() => setChoosing(null)}
          onSave={async (picks) => {
            setChoosing(null);
            await send(choose, 'buy', picks);
          }}
        />
      ) : null}
    </section>
  );
}
