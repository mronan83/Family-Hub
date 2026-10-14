import { Avatar, type AvatarProps, Button } from '@familywise/ui';
import { calendarDay } from '@/lib/chores';
import { time } from '@/lib/format';
import { byChild, MODE_WORDS, type WaitingLunch } from '@/lib/lunch';
import { picksWords, samePicks } from '@/lib/lunch-picks';
import { decideLunches } from './actions';
import type { Person } from './item-row';

/** A child as the group heads them: their face when the member list carries it. */
type Child = Person & { avatarKey?: AvatarProps['avatarKey']; color?: AvatarProps['color'] };

/** What staying as it was keeps: the day's lunch, or (picks only) the picks it had. */
function keepWords(w: WaitingLunch): string {
  return w.current && w.current !== w.mode ? `Keep ${MODE_WORDS[w.current]}` : 'Keep as it was';
}

/**
 * [MEAL-09][MEAL-11][US-707][D-95] The children's lunch changes from the board, waiting for a parent
 * (WP-49; mockup approved by the owner): a group a child, each day with its usual, the change and
 * the picks, Approve or Keep; Approve all on a group of two or more. Keeping a day drops the change
 * and its picks.
 */
export function LunchChanges({
  lunches,
  people,
  date,
  timezone,
}: {
  lunches: WaitingLunch[];
  people: Child[];
  date: string;
  timezone: string;
}) {
  if (lunches.length === 0) return null;
  const first = lunches.reduce((a, b) => (a.date < b.date ? a : b)).date;
  const last = lunches.reduce((a, b) => (a.date > b.date ? a : b)).date;
  return (
    <form action={decideLunches} className="fw-lunchq">
      <input type="hidden" name="date" value={date} />
      <h3 className="fw-subhead">
        {first === last
          ? `Lunch changes · ${calendarDay(first)}`
          : `Lunch changes · ${calendarDay(first)} to ${calendarDay(last)}`}
      </h3>
      {byChild(lunches).map((g) => {
        const who = people.find((p) => p.id === g.memberId);
        const name = who?.displayName ?? 'A child';
        const newest = g.changes.reduce((a, b) => (a.requestedAt > b.requestedAt ? a : b));
        const n = g.changes.length;
        return (
          <section
            key={g.memberId}
            className="fw-lunchq__child"
            aria-label={`${name}’s lunch changes`}
            data-member={g.memberId}
          >
            <div className="fw-lunchq__head">
              <div className="fw-lunchq__who">
                {who ? (
                  <Avatar
                    name={who.displayName}
                    avatarKey={who.avatarKey}
                    color={who.color}
                    size={32}
                    decorative
                  />
                ) : null}
                <strong>{name}</strong>
                <span className="fw-muted">
                  {`${n} ${n === 1 ? 'change' : 'changes'} · on the board, ${time(newest.requestedAt, timezone)}`}
                </span>
              </div>
              {n > 1 ? (
                <Button
                  type="submit"
                  name="lunch"
                  value={`approve:${g.changes.map((c) => c.id).join(',')}`}
                  icon="check"
                >
                  {n === 2 ? 'Approve both' : `Approve all ${n}`}
                </Button>
              ) : null}
            </div>
            <ul className="fw-lunchq__days">
              {g.changes.map((w) => {
                const modeChange = w.current !== w.mode;
                const picksOnly = !modeChange && !samePicks(w.choices, w.currentChoices);
                return (
                  <li key={w.id} className="fw-lunchq__day" data-date={w.date}>
                    <div className="fw-lunchq__date">
                      <strong>{calendarDay(w.date)}</strong>
                      <span className="fw-muted">{`usually ${MODE_WORDS[w.usual]}`}</span>
                    </div>
                    <div className="fw-lunchq__change">
                      {modeChange && w.current ? (
                        <>
                          <span className="fw-lunchq__was">{MODE_WORDS[w.current]}</span>
                          <span aria-hidden>→</span>
                        </>
                      ) : null}
                      <span className="fw-lunchq__mode" data-mode={w.mode}>
                        {MODE_WORDS[w.mode]}
                      </span>
                      {picksOnly ? <span className="fw-muted">new picks</span> : null}
                      {w.mode === 'buy' && w.choices.length ? (
                        <p className="fw-lunchq__picks">
                          Picked: <strong>{picksWords(w.choices)}</strong>
                        </p>
                      ) : w.mode === 'buy' ? (
                        <p className="fw-lunchq__picks">Nothing picked yet.</p>
                      ) : w.currentChoices.length ? (
                        <p className="fw-lunchq__picks">
                          {`${name}’s picks for the day are dropped if this is approved.`}
                        </p>
                      ) : null}
                    </div>
                    <div className="fw-actions fw-lunchq__buttons">
                      <Button
                        type="submit"
                        name="lunch"
                        value={`approve:${w.id}`}
                        icon="check"
                        aria-label={`Approve ${name}’s ${calendarDay(w.date)}: ${MODE_WORDS[w.mode]}`}
                      >
                        Approve
                      </Button>
                      <Button
                        type="submit"
                        name="lunch"
                        value={`keep:${w.id}`}
                        variant="ghost"
                        aria-label={`${keepWords(w)} for ${name} on ${calendarDay(w.date)}`}
                      >
                        {keepWords(w)}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </form>
  );
}
