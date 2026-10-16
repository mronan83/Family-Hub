import { Icon } from './Icon';

// [RWD-15][RWD-16] A repeating goal's marks (06 §7.2, WP-80): a mark per day of the week going now,
// and a mark per period won or missed. The state is in the shape and the words (an aria-label), never
// colour alone: done a filled check, missed a cross, a day with nothing due a dash, today ringed.

export type DayMarkState = 'done' | 'missed' | 'open' | 'today' | 'later' | 'none';

export interface DayMarksProps {
  /** Each day shown: its short name ("Mon") and its mark; `note` names a day with nothing due. */
  days: { date: string; label: string; mark: DayMarkState; note?: string }[];
}

const DAY_WORDS: Record<DayMarkState, string> = {
  done: 'done',
  missed: 'missed',
  open: 'waiting',
  today: 'today, to do',
  later: 'still to come',
  none: 'not due',
};

export function DayMarks({ days }: DayMarksProps) {
  return (
    <ol className="fw-days" aria-label="This week’s days">
      {days.map((d) => (
        <li
          key={d.date}
          className="fw-days__day"
          data-mark={d.mark}
          aria-label={`${d.label}: ${d.note ?? DAY_WORDS[d.mark]}`}
        >
          <span className="fw-days__mark" aria-hidden="true">
            {d.mark === 'done' ? (
              <Icon name="check" />
            ) : d.mark === 'missed' ? (
              <Icon name="close" />
            ) : d.mark === 'none' ? (
              <Icon name="minus" />
            ) : null}
          </span>
          <span className="fw-days__label" aria-hidden="true">
            {d.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export type PeriodMarkState = 'won' | 'missed' | 'neutral' | 'open';

export interface PeriodMarksProps {
  /** Oldest first; each with its words ("Week of Oct 5: won"). */
  periods: { key: string; outcome: PeriodMarkState; label: string }[];
  /** What the row is, read before its marks ("The last 5 weeks"). */
  label: string;
}

export function PeriodMarks({ periods, label }: PeriodMarksProps) {
  return (
    <ol className="fw-periods" aria-label={label}>
      {periods.map((p) => (
        <li
          key={p.key}
          className="fw-periods__period"
          data-outcome={p.outcome}
          aria-label={p.label}
        >
          {p.outcome === 'won' ? (
            <Icon name="trophy" />
          ) : p.outcome === 'missed' ? (
            <Icon name="close" />
          ) : p.outcome === 'neutral' ? (
            <Icon name="minus" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
