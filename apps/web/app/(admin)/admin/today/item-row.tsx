import { Button, Icon, ICON_NAMES, type IconName } from '@familywise/ui';
import type { ReactNode } from 'react';
import { actionsFor, doersFor, type DayItem, type DayAction } from '@/lib/admin-day';
import { clock, historyLine } from '@/lib/chores';
import { isLateTick, lateWords, onTimeState, onTimeTrace } from '@/lib/on-time';
import { nameList } from '@/lib/today';
import { type OnTimeConfirm, OnTimePanel } from '../on-time-panel';

export interface Person {
  id: string;
  displayName: string;
}

/** [CHR-24] What a row needs for **Done on time…** (WP-117). */
export interface OnTimeRow {
  /** The household's clock, 'YYYY-MM-DDTHH:MM'. */
  now: string;
  /** The page to come back to. */
  returnTo: string;
  /** The goals that count each item, by occurrence id. */
  goals?: Map<string, string[]>;
  /** The item whose settled week or goal asks first, and what it says. */
  confirm?: (OnTimeConfirm & { item: string }) | null;
  /** The item whose panel starts open. */
  open?: string | null;
}

const iconOf = (icon: string | null): IconName =>
  icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : 'list-check';

/** "Make bed" for a shared item; "Make bed (Maya)" for one person's own (D-47). */
export function itemLabel(i: DayItem, name: (id: string) => string): string {
  return i.memberId ? `${i.title} (${name(i.memberId)})` : i.title;
}

const BUTTONS: Record<
  Exclude<DayAction, 'done'>,
  { text: string; label: (l: string) => string }
> = {
  skip: { text: 'Skip', label: (l) => `Skip ${l}` },
  uncheck: { text: 'Uncheck', label: (l) => `Uncheck ${l}` },
  unskip: { text: 'Put back', label: (l) => `Put ${l} back` },
  approve: { text: 'Approve', label: (l) => `Approve ${l}` },
  reject: { text: 'Send back', label: (l) => `Send ${l} back` },
};
/** [CHR-24] Done on time… comes after Mark done, before Skip and Uncheck. */
const order = (a: DayAction | 'ontime') => (a === 'done' ? 0 : a === 'ontime' ? 1 : 2);

const ICONS: Record<DayAction, IconName> = {
  done: 'check',
  skip: 'moon',
  uncheck: 'undo',
  unskip: 'undo',
  approve: 'shield-check',
  reject: 'retry',
};

/**
 * [CHR-05][CHR-06][CHR-08] One item in a parent's day, inside the page's form: what it is, who it is
 * for, how it stands (06 §7.1: an icon and words), and the buttons for what a parent can do with it.
 * "Mark done" credits its person or its one assignee; a shared item with several asks who did it.
 * A done item can be ticked for "Not actually done".
 */
export function ItemRow({
  item,
  today,
  people,
  me,
  only,
  selectable,
  extra,
  tail,
  onTime = null,
}: {
  item: DayItem;
  today: string;
  people: Person[];
  /** In My tasks: "Mark done" credits me. */
  me?: string;
  /** Offer only these actions. */
  only?: DayAction[];
  selectable?: boolean;
  extra?: ReactNode;
  /** Before the buttons: My tasks' bell (WP-40). */
  tail?: ReactNode;
  /** [CHR-24] Offer Done on time… where it applies. */
  onTime?: OnTimeRow | null;
}) {
  const names = new Map(people.map((p) => [p.id, p.displayName]));
  const name = (id: string) => names.get(id) ?? 'Someone';
  const label = itemLabel(item, name);
  const actions = actionsFor(item, today).filter((a) => !only || only.includes(a));
  // An open task is overdue only once its day has passed (D-31); until then it reads as open.
  // [CHR-24] A parent's Mark done on time reads as done, not as an approval.
  const shown =
    item.checkOff?.markedOnTime && item.status === 'approved'
      ? { ...item, status: 'completed' as const }
      : item;
  const history = historyLine(shown, item.dueDate < today ? item.kind : 'chore', name);
  // [CHR-24] A tick after its time says so; one marked on time carries its trace.
  const late = isLateTick(item, item.checkOff);
  const line = late
    ? {
        ...history,
        icon: 'clock' as IconName,
        tone: 'late' as const,
        text: `${item.memberId ? name(item.memberId) : nameList(item.doneBy.map(name))}: ${lateWords(item, item.checkOff!)}`,
      }
    : history;
  const trace = onTimeTrace(item.checkOff);
  const offerOnTime =
    onTime && !only ? onTimeState(item, item.checkOff, onTime.now) !== null : false;
  const confirm = onTime?.confirm?.item === item.id ? onTime.confirm : null;
  const forWhom = item.memberId ? name(item.memberId) : nameList(item.assignees.map(name));
  const doers = me ? [me] : doersFor(item);
  // The item's people first, then everyone else (D-30).
  const pickable = [
    ...people.filter((p) => item.assignees.includes(p.id) || p.id === item.memberId),
    ...people.filter((p) => !item.assignees.includes(p.id) && p.id !== item.memberId),
  ];

  return (
    <li id={`item-${item.id}`} className="fw-list__row fw-day__row" data-status={item.status}>
      {selectable && (item.status === 'completed' || item.status === 'approved') ? (
        <label className="fw-choice fw-day__select">
          <input type="checkbox" name="selected" value={item.id} />
          <span className="fw-visually-hidden">Select {label}</span>
        </label>
      ) : null}
      <span className="fw-item">
        <Icon name={iconOf(item.icon)} size={24} />
        <span className="fw-item__body">
          <strong>{item.title}</strong>
          <span className="fw-muted fw-item__people">
            {[item.dueTime ? clock(item.dueTime) : null, forWhom ? `for ${forWhom}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className={`fw-history fw-history--${line.tone}`}>
            <Icon name={line.icon} size={20} />
            {line.text}
          </span>
          {trace ? (
            <span className="fw-ontime__trace">
              <Icon name="clock" size={18} />
              {trace}
            </span>
          ) : null}
          {extra}
        </span>
      </span>
      {actions.length > 0 || tail || offerOnTime ? (
        <span className="fw-actions">
          {tail}
          {[...actions, ...(offerOnTime ? (['ontime'] as const) : [])]
            .sort((x, y) => order(x) - order(y))
            .map((a) => {
              if (a === 'ontime') {
                return (
                  <OnTimePanel
                    key="ontime"
                    item={item}
                    people={people}
                    doers={me ? [me] : doersFor(item)}
                    returnTo={onTime!.returnTo}
                    goals={onTime!.goals?.get(item.id) ?? []}
                    confirm={confirm}
                    open={onTime!.open === item.id}
                  />
                );
              }
              if (a !== 'done') {
                return (
                  <Button
                    key={a}
                    type="submit"
                    variant={a === 'approve' ? 'primary' : 'ghost'}
                    icon={ICONS[a]}
                    name="act"
                    value={`${a}:${item.id}`}
                    aria-label={BUTTONS[a].label(label)}
                  >
                    {BUTTONS[a].text}
                  </Button>
                );
              }
              if (doers) {
                return (
                  <span key={a}>
                    {doers.map((d) => (
                      <input key={d} type="hidden" name={`by:${item.id}`} value={d} />
                    ))}
                    <Button
                      type="submit"
                      icon={ICONS.done}
                      name="act"
                      value={`done:${item.id}`}
                      aria-label={`Mark ${label} done`}
                    >
                      Mark done
                    </Button>
                  </span>
                );
              }
              return (
                <details key={a} className="fw-day__who">
                  <summary>Mark done…</summary>
                  <fieldset className="fw-fieldset">
                    <legend className="fw-field__label">Who did {item.title}?</legend>
                    <span className="fw-picker">
                      {pickable.map((p) => (
                        <label key={p.id} className="fw-choice">
                          <input type="checkbox" name={`by:${item.id}`} value={p.id} />
                          {p.displayName}
                        </label>
                      ))}
                    </span>
                  </fieldset>
                  <Button
                    type="submit"
                    icon={ICONS.done}
                    name="act"
                    value={`done:${item.id}`}
                    aria-label={`Mark ${label} done`}
                  >
                    Mark done
                  </Button>
                </details>
              );
            })}
        </span>
      ) : null}
    </li>
  );
}
