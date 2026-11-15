import { Fold, Icon, ICON_NAMES, type IconName } from '@familywise/ui';
import type { DayItem } from '@/lib/admin-day';
import { clock } from '@/lib/chores';
import { monthDay, shortDay } from '@/lib/goal-periods';
import { lateWords, type MissedOrLateRow, onTimeTrace } from '@/lib/on-time';
import { doersFor } from '@/lib/admin-day';
import { OnTimePanel } from '../on-time-panel';
import type { OnTimeRow } from '../today/item-row';

const iconOf = (icon: string | null): IconName =>
  icon && (ICON_NAMES as readonly string[]).includes(icon) ? (icon as IconName) : 'list-check';

/**
 * [CHR-24][US-326] A child's page, **Missed or late** (the approved mockup): their chores of the last
 * 14 days that were missed, are open past their time, or were ticked late, each with Done on time…,
 * and those already marked on time with their trace. Folded to how many there are to look at.
 */
export function MissedOrLate({
  rows,
  people,
  request,
  onTime,
  open,
}: {
  rows: MissedOrLateRow<DayItem>[];
  people: { id: string; displayName: string }[];
  request: string;
  onTime: OnTimeRow;
  open: boolean;
}) {
  const toLook = rows.filter((r) => r.state !== 'marked').length;
  return (
    <Fold
      id="missed-or-late"
      title="Missed or late"
      headingId="missed-or-late-heading"
      open={open}
      waiting={toLook > 0 ? `${toLook} to look at` : undefined}
      summary={[
        <span key="s" className="fw-muted">
          {toLook > 0
            ? 'The last 14 days. Done on time counts a chore as done by its time.'
            : 'Nothing missed or late in the last 14 days.'}
        </span>,
      ]}
    >
      <p className="fw-muted">
        The last 14 days. Done on time counts a chore as done by its time, for points and goals.
      </p>
      {rows.length === 0 ? (
        <p className="fw-muted">Nothing missed or late in the last 14 days.</p>
      ) : (
        <ul className="fw-list" aria-labelledby="missed-or-late-heading">
          {rows.map(({ item, state, checkOff }) => {
            const trace = onTimeTrace(checkOff);
            return (
              <li key={item.id} className="fw-list__row fw-day__row" data-state={state}>
                <span className="fw-item">
                  <Icon name={iconOf(item.icon)} size={24} />
                  <span className="fw-item__body">
                    <strong>{item.title}</strong>
                    <span className="fw-muted fw-item__people">
                      {shortDay(item.dueDate)}, {monthDay(item.dueDate)}
                      {item.dueTime ? ` · ${clock(item.dueTime)}` : ''}
                    </span>
                    {state === 'late' && checkOff ? (
                      <span className="fw-history fw-history--late">
                        <Icon name="clock" size={20} />
                        {lateWords(item, checkOff).replace(/^done late/, 'Done late')}
                      </span>
                    ) : state === 'marked' ? (
                      <span className="fw-history fw-history--done">
                        <Icon name="check-circle" size={20} />
                        Done
                      </span>
                    ) : (
                      <span className="fw-history fw-history--missed">
                        <Icon name="minus-circle" size={20} />
                        {state === 'overdue' ? 'Open past its time' : 'Missed'}
                      </span>
                    )}
                    {trace ? (
                      <span className="fw-ontime__trace">
                        <Icon name="clock" size={18} />
                        {trace}
                      </span>
                    ) : null}
                  </span>
                </span>
                {state !== 'marked' ? (
                  <span className="fw-actions">
                    <OnTimePanel
                      item={item}
                      people={people}
                      doers={doersFor(item)}
                      returnTo={onTime.returnTo}
                      goals={onTime.goals?.get(item.id) ?? []}
                      confirm={onTime.confirm?.item === item.id ? onTime.confirm : null}
                      open={onTime.open === item.id}
                      form={{ request }}
                    />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Fold>
  );
}
