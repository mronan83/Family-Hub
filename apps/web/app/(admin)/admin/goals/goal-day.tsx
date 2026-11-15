import { Icon, ICON_NAMES, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { doersFor, type DayItem } from '@/lib/admin-day';
import { clock } from '@/lib/chores';
import { monthDay, weekday } from '@/lib/goal-periods';
import { isDoneStatus, lateWords, onTimeTrace } from '@/lib/on-time';
import { OnTimePanel } from '../on-time-panel';
import type { OnTimeRow } from '../today/item-row';

const iconOf = (icon: string | null): IconName =>
  icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : 'list-check';

export interface GoalDayProps {
  goalId: string;
  date: string;
  /** The goal's chores that day that can be marked on time, or were. */
  rows: DayItem[];
  onTime: OnTimeRow;
  people: { id: string; displayName: string }[];
  request: string;
}

/**
 * [CHR-24][US-326] A goal's missed or late day, opened from its mark (the approved mockup): what the
 * goal counts that was missed or ticked late that day, each with Done on time…, and the day on Today.
 */
export function GoalDay({ date, rows, onTime, people, request }: GoalDayProps) {
  const title = `${weekday(date)}, ${monthDay(date)}`;
  return (
    <section className="fw-goal__day" aria-label={title}>
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="fw-muted">Nothing on this day can be marked on time.</p>
      ) : (
        <ul className="fw-list">
          {rows.map((item) => {
            // Marked on time: done, with its trace. Done but late (by its time, or the goal's own):
            // its tick. Otherwise missed.
            const trace = isDoneStatus(item.status) ? onTimeTrace(item.checkOff) : null;
            const state = trace
              ? 'marked'
              : item.checkOff && isDoneStatus(item.status)
                ? 'late'
                : 'missed';
            return (
              <li key={item.id} className="fw-list__row fw-day__row">
                <span className="fw-item">
                  <Icon name={iconOf(item.icon)} size={24} />
                  <span className="fw-item__body">
                    <strong>{item.title}</strong>
                    {item.dueTime ? (
                      <span className="fw-muted fw-item__people">{clock(item.dueTime)}</span>
                    ) : null}
                    {state === 'marked' ? (
                      <>
                        <span className="fw-history fw-history--done">
                          <Icon name="check-circle" size={20} />
                          Done
                        </span>
                        <span className="fw-ontime__trace">
                          <Icon name="clock" size={18} />
                          {trace}
                        </span>
                      </>
                    ) : state === 'late' && item.checkOff ? (
                      <span className="fw-history fw-history--late">
                        <Icon name="clock" size={20} />
                        {lateWords(item, item.checkOff).replace(/^done late/, 'Done late')}
                      </span>
                    ) : (
                      <span className="fw-history fw-history--missed">
                        <Icon name="minus-circle" size={20} />
                        Missed
                      </span>
                    )}
                  </span>
                </span>
                {state === 'marked' ? null : (
                  <span className="fw-actions">
                    <OnTimePanel
                      item={item}
                      people={people}
                      doers={doersFor(item)}
                      returnTo={onTime.returnTo}
                      confirm={onTime.confirm?.item === item.id ? onTime.confirm : null}
                      open={onTime.open === item.id}
                      form={{ request }}
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Link href={`/admin/today?date=${date}`}>Open the day</Link>
    </section>
  );
}
