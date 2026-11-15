import { Button, Icon } from '@familywise/ui';
import Link from 'next/link';
import { clock } from '@/lib/chores';
import { monthDay, weekday } from '@/lib/goal-periods';
import { latestTime, onTimeLine } from '@/lib/on-time';
import { markOnTime } from './on-time-actions';

export interface OnTimeConfirm {
  /** "This makes Maya’s week of Nov 9 a win: 10 points." */
  text: string;
  /** "10 points", for the button. */
  pays: string | null;
  /** The answers the parent gave, kept for the confirm. */
  when: 'due' | 'at';
  at: string | null;
  by: string[];
}

export interface OnTimeTarget {
  id: string;
  title: string;
  dueDate: string;
  dueTime: string | null;
  memberId: string | null;
  assignees: string[];
}

/**
 * [CHR-24][US-326] **Done on time…** (the approved mockup): when it was done, "On time" (by its due
 * time) or an earlier time on its day; who did it when that isn't known; the goals it counts for; and,
 * for a week or goal already settled that it changes, what it pays, before the parent confirms. Inside
 * a page's own form (Today) the button sends it to `markOnTime`; elsewhere, `form` wraps it in one.
 */
export function OnTimePanel({
  item,
  people,
  doers,
  returnTo,
  goals = [],
  confirm = null,
  open = false,
  form = null,
}: {
  item: OnTimeTarget;
  people: { id: string; displayName: string }[];
  /** Who it credits without asking (its person, or its one assignee); null asks. */
  doers: string[] | null;
  /** The page to come back to, with its own query. */
  returnTo: string;
  /** The goals that count it, by title. */
  goals?: string[];
  confirm?: OnTimeConfirm | null;
  open?: boolean;
  /** A form of its own, with this page view's request id (outside Today's form). */
  form?: { request: string } | null;
}) {
  const latest = latestTime(item.dueTime);
  const send = markOnTime.bind(null, confirm ? `${item.id}:confirm` : item.id);
  const atChosen = confirm?.when === 'at';
  const chosen = confirm?.by ?? [];
  const pickable = [
    ...people.filter((p) => item.assignees.includes(p.id) || p.id === item.memberId),
    ...people.filter((p) => !item.assignees.includes(p.id) && p.id !== item.memberId),
  ];
  const day = `${weekday(item.dueDate)}, ${monthDay(item.dueDate)}`;
  const body = (
    <>
      <input type="hidden" name="return" value={returnTo} />
      <fieldset className="fw-fieldset fw-ontime__when">
        <legend className="fw-field__label">
          When was {item.title} done on {day}?
        </legend>
        <label className="fw-choice fw-ontime__choice">
          <input type="radio" name={`when:${item.id}`} value="due" defaultChecked={!atChosen} />
          <span>
            <b>On time</b>
            <span className="fw-muted fw-ontime__hint">{onTimeLine(item.dueTime)}</span>
          </span>
        </label>
        <label className="fw-choice fw-ontime__choice">
          <input type="radio" name={`when:${item.id}`} value="at" defaultChecked={atChosen} />
          <span>
            <span className="fw-ontime__earlier">
              <b>Earlier</b> at
              <input
                type="time"
                className="fw-input fw-ontime__time"
                name={`at:${item.id}`}
                max={latest}
                defaultValue={confirm?.at ?? latest}
                aria-label={`The time ${item.title} was done`}
              />
            </span>
            <span className="fw-muted fw-ontime__hint">
              Any time on {monthDay(item.dueDate)}
              {item.dueTime ? ` up to ${clock(item.dueTime)}` : ''}.
            </span>
          </span>
        </label>
      </fieldset>
      {doers ? (
        doers.map((d) => <input key={d} type="hidden" name={`otby:${item.id}`} value={d} />)
      ) : (
        <fieldset className="fw-fieldset">
          <legend className="fw-field__label">Who did {item.title}?</legend>
          <span className="fw-picker">
            {pickable.map((p) => (
              <label key={p.id} className="fw-choice">
                <input
                  type="checkbox"
                  name={`otby:${item.id}`}
                  value={p.id}
                  defaultChecked={chosen.includes(p.id)}
                />
                {p.displayName}
              </label>
            ))}
          </span>
        </fieldset>
      )}
      {confirm ? (
        <p className="fw-ontime__confirm" role="status">
          <Icon name="trophy" size={20} />
          <span>
            <b>{confirm.text}</b> It’s paid once.
          </span>
        </p>
      ) : goals.length > 0 ? (
        <p className="fw-ontime__goals">
          <Icon name="trophy" size={20} />
          <span>
            Counts for <b>{goals.join(', ')}</b>.
          </span>
        </p>
      ) : null}
      <span className="fw-actions">
        <Button
          type="submit"
          icon="check"
          formAction={form ? undefined : send}
          aria-label={`Mark ${item.title} done on time`}
        >
          {confirm
            ? confirm.pays
              ? `Mark on time and pay ${confirm.pays}`
              : 'Mark on time'
            : 'Mark done on time'}
        </Button>
        <Link href={returnTo} className="fw-btn fw-btn--ghost">
          Cancel
        </Link>
      </span>
    </>
  );
  return (
    <details
      className="fw-ontime"
      open={open || confirm !== null}
      id={`ontime-${item.id}`}
      data-confirm={confirm ? 'true' : undefined}
    >
      <summary>
        <Icon name="clock" size={20} />
        Done on time…
      </summary>
      {form ? (
        <form action={send} className="fw-ontime__body">
          <input type="hidden" name="request" value={form.request} />
          {body}
        </form>
      ) : (
        <div className="fw-ontime__body">{body}</div>
      )}
    </details>
  );
}
