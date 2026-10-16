import type { Repeat } from '@familywise/rules-engine';
import { DayMarks, Fold, Icon, PeriodMarks } from '@familywise/ui';
import {
  daysLine,
  type GoalPeriod,
  missedDaysLine,
  notDueLine,
  periodLabel,
  periodWord,
  shownDays,
  spanWords,
  startsAgainShort,
  thisPeriod,
  wonLine,
} from '@/lib/goal-periods';

/** The period going now (holding `today`), else the last one. */
export function currentPeriod(periods: GoalPeriod[], today: string): GoalPeriod | null {
  return periods.find((p) => p.start <= today && today <= p.end) ?? periods.at(-1) ?? null;
}

/** [RWD-15] A repeating goal's state for its pill: going, missed this week, or won this week. */
export function periodStatus(
  periods: GoalPeriod[],
  today: string,
  repeat: Exclude<Repeat, 'none'>,
): { status: 'active' | 'missed' | 'achieved'; words: string } | null {
  const now = currentPeriod(periods, today);
  if (!now || now.end < today) return null;
  if (now.outcome === 'won') return { status: 'achieved', words: `Won this ${periodWord(repeat)}` };
  if (now.outcome === 'missed') {
    return { status: 'missed', words: `Missed this ${periodWord(repeat)}` };
  }
  return null;
}

/**
 * [RWD-15][RWD-16] A repeating goal on Goals (the approved mockup): this period's days ("3 of 4 days ·
 * Friday no school") and a mark for each, the line when the period is lost or won, and its last
 * periods as marks with "Won 3 of the last 4 weeks".
 */
export function PeriodProgress({
  repeat,
  periods,
  today,
  pays,
  children,
}: {
  repeat: Exclude<Repeat, 'none'>;
  periods: GoalPeriod[];
  today: string;
  /** What a won period paid, for its line: "10 points". */
  pays: string | null;
  /** The rules' meters, for a goal without "every day it's due". */
  children?: React.ReactNode;
}) {
  const now = currentPeriod(periods, today);
  const recent = periods.filter((p) => p.start <= today).slice(-5);
  const won = wonLine(recent, repeat);
  const days = now ? shownDays(now) : [];
  const line = now ? daysLine(now) : null;
  const notDue = now ? notDueLine(now) : null;
  return (
    <div className="fw-goal__period">
      {now === null ? (
        <p className="fw-muted">
          Nothing counts yet: its first {periodWord(repeat)} hasn’t started.
        </p>
      ) : (
        <>
          {line ? (
            <p className="fw-muted">
              <b className="fw-goal__period-head">{thisPeriod(repeat)}:</b> {line}
              {notDue ? ` · ${notDue}` : ''}
            </p>
          ) : (
            <p className="fw-muted">
              <b className="fw-goal__period-head">{thisPeriod(repeat)}</b>
            </p>
          )}
          {now.outcome === 'missed' ? (
            <p className="fw-goal-line" data-kind="missed">
              <Icon name="repeat" />
              <span>{[missedDaysLine(now) ?? `Missed.`, startsAgainShort(now)].join(' ')}</span>
            </p>
          ) : now.outcome === 'won' ? (
            <p className="fw-goal-line" data-kind="won">
              <Icon name="trophy" />
              <span>
                Won this {periodWord(repeat)}
                {pays ? `: ${pays}` : '!'}
              </span>
            </p>
          ) : null}
          {days.length ? <DayMarks days={days} /> : null}
        </>
      )}
      {children}
      {recent.length ? (
        <div className="fw-goal__weeks">
          <span className="fw-muted">{won ?? `Its first ${periodWord(repeat)} is going now`}</span>
          <PeriodMarks
            label={`The last ${recent.length} ${periodWord(repeat, recent.length)}`}
            periods={recent.map((p) => ({
              key: p.start,
              outcome: p.outcome,
              label: periodLabel(p, repeat),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * [RWD-15] A goal's periods on its page (the approved mockup): folded to "Won 3 of the last 4 weeks ·
 * 30 points paid · this week 3 of 4 days", opening to each period, newest first, with what it paid.
 */
export function WeeksFold({
  repeat,
  periods,
  today,
  points,
}: {
  repeat: Exclude<Repeat, 'none'>;
  periods: GoalPeriod[];
  today: string;
  /** The points a won period pays; null when it pays something else. */
  points: number | null;
}) {
  const now = currentPeriod(periods, today);
  const shown = periods.filter((p) => p.start <= today);
  const won = shown.filter((p) => p.outcome === 'won').length;
  const plural = periodWord(repeat, 2);
  const nowLine = now && now.end >= today ? daysLine(now) : null;
  return (
    <Fold
      title={`${plural[0]!.toUpperCase()}${plural.slice(1)}`}
      headingId="goal-weeks-heading"
      summary={[
        <b key="won">{wonLine(shown, repeat) ?? `Its first ${periodWord(repeat)}`}</b>,
        [
          points !== null ? `${(points * won).toLocaleString('en-US')} points paid` : null,
          nowLine ? `${thisPeriod(repeat).toLowerCase()} ${nowLine}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ]}
    >
      {shown.length === 0 ? (
        <p className="fw-muted">Its first {periodWord(repeat)} hasn’t started yet.</p>
      ) : (
        <ul className="fw-list" aria-labelledby="goal-weeks-heading">
          {[...shown].reverse().map((p) => {
            const going = p.start <= today && today <= p.end;
            const words = {
              won: 'Won',
              missed: 'Missed',
              neutral: 'Nothing due',
              open: 'Going',
            }[p.outcome];
            return (
              <li key={p.start} className="fw-list__row" data-outcome={p.outcome}>
                <span className="fw-item">
                  <PeriodMarks
                    label={periodLabel(p, repeat)}
                    periods={[{ key: p.start, outcome: p.outcome, label: periodLabel(p, repeat) }]}
                  />
                  <span className="fw-item__body">
                    <strong>
                      {going ? `${thisPeriod(repeat)}, ` : ''}
                      {spanWords(p)}
                    </strong>
                    <span className="fw-muted">
                      {[missedDaysLine(p) ?? words, daysLine(p), notDueLine(p)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </span>
                {p.outcome === 'won' && points !== null ? (
                  <span className="fw-goal__status" data-status="achieved">
                    +{points}
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
