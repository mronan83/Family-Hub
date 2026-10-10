import { Button, Icon, ICON_NAMES, type IconName } from '@familywise/ui';
import type { ReactNode } from 'react';
import { actionsFor, doersFor, type DayItem, type DayAction } from '@/lib/admin-day';
import { clock, historyLine } from '@/lib/chores';
import { nameList } from '@/lib/today';

export interface Person {
  id: string;
  displayName: string;
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
}) {
  const names = new Map(people.map((p) => [p.id, p.displayName]));
  const name = (id: string) => names.get(id) ?? 'Someone';
  const label = itemLabel(item, name);
  const actions = actionsFor(item, today).filter((a) => !only || only.includes(a));
  // An open task is overdue only once its day has passed (D-31); until then it reads as open.
  const line = historyLine(item, item.dueDate < today ? item.kind : 'chore', name);
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
          {extra}
        </span>
      </span>
      {actions.length > 0 || tail ? (
        <span className="fw-actions">
          {tail}
          {actions.map((a) => {
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
