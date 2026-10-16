import type { Repeat } from '@familywise/rules-engine';
import type { Step } from '@familywise/rules-engine';
import {
  Avatar,
  type AvatarKey,
  DayMarks,
  Fold,
  Icon,
  type MemberColor,
  PeriodMarks,
} from '@familywise/ui';
import {
  childLine,
  familyMissedLine,
  familyPaid,
  familyWeekDetail,
  familyWonLine,
} from '@/lib/goal-perfect';
import { lateLine, type StepKind, stepChips, stepNudge, stepWonWords } from '@/lib/goal-steps';
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

/** [RWD-20] Who an every-child goal's lines name: each child's name, and their avatar. */
export interface ChildNames {
  name: (id: string) => string;
  member: (id: string) => { avatarKey: AvatarKey | null; color: MemberColor } | undefined;
}

/**
 * [RWD-20] Each child's period of an every-child goal (the approved addendum): their avatar and name,
 * how it stands for them ("3 of 4 days", "Missed Tuesday", "Nothing due this week"), and their days.
 */
export function ChildRows({
  period,
  repeat,
  who,
}: {
  period: GoalPeriod;
  repeat: Exclude<Repeat, 'none'>;
  who: ChildNames;
}) {
  return (
    <ul className="fw-goal__kids" aria-label={`Each child ${thisPeriod(repeat).toLowerCase()}`}>
      {(period.children ?? []).map((c) => {
        const m = who.member(c.memberId);
        const days = c.contributes ? shownDays(c) : [];
        return (
          <li key={c.memberId} className="fw-goal__kid" data-outcome={c.outcome}>
            <Avatar
              name={who.name(c.memberId)}
              avatarKey={m?.avatarKey ?? null}
              color={m?.color}
              size={36}
              decorative
            />
            <span className="fw-goal__kid-body">
              <b>{who.name(c.memberId)}</b>
              <span className="fw-muted">{childLine(c, period, repeat)}</span>
            </span>
            {days.length ? <DayMarks days={days} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

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
  steps = [],
  kind = 'misses',
  onTime = null,
  who,
  points = null,
  children,
}: {
  repeat: Exclude<Repeat, 'none'>;
  periods: GoalPeriod[];
  today: string;
  /** What a won period paid, for its line: "10 points". */
  pays: string | null;
  /** [RWD-18] Its steps, highest first, when it pays in steps. */
  steps?: Step[];
  kind?: StepKind;
  /** [RWD-17] Its first rule's time, for "Wednesday was after 6:00 pm." */
  onTime?: string | null;
  /** [RWD-20] An every-child goal: the children's names and avatars. */
  who?: ChildNames;
  /** [RWD-20] The points a won period pays each child; null when it pays something else. */
  points?: number | null;
  /** The rules' meters, for a goal without "every day it's due". */
  children?: React.ReactNode;
}) {
  const now = currentPeriod(periods, today);
  const recent = periods.filter((p) => p.start <= today).slice(-5);
  const won = wonLine(recent, repeat);
  const family = who && now?.children ? who : null;
  const days = now ? shownDays(now) : [];
  const line = now ? daysLine(steps.length ? { ...now, missesAllowed: 0 } : now) : null;
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
          {now.outcome === 'missed' && family ? (
            <p className="fw-goal-line" data-kind="missed">
              <Icon name="repeat" />
              <span>{familyMissedLine(now, family.name) ?? 'Missed.'}</span>
            </p>
          ) : now.outcome === 'won' && family ? (
            <p className="fw-goal-line" data-kind="won">
              <Icon name="trophy" />
              <span>{familyWonLine(now, family.name, points)}</span>
            </p>
          ) : now.outcome === 'missed' ? (
            <p className="fw-goal-line" data-kind="missed">
              <Icon name="repeat" />
              <span>
                {[
                  missedDaysLine(now) ?? `Missed.`,
                  lateLine(now.days, onTime),
                  startsAgainShort(now),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </span>
            </p>
          ) : now.outcome === 'won' ? (
            <p className="fw-goal-line" data-kind="won">
              <Icon name="trophy" />
              <span>
                Won this {periodWord(repeat)}
                {steps.length && now.step != null && steps[now.step]
                  ? `: ${steps[now.step]!.amount} points`
                  : pays
                    ? `: ${pays}`
                    : '!'}
              </span>
            </p>
          ) : null}
          {family ? (
            <ChildRows period={now} repeat={repeat} who={family} />
          ) : days.length ? (
            <DayMarks days={days} />
          ) : null}
          {now.outcome === 'open' && lateLine(now.days, onTime) ? (
            <p className="fw-muted">{lateLine(now.days, onTime)}</p>
          ) : null}
          {steps.length ? (
            <p className="fw-muted fw-goal__steps" data-testid="goal-steps">
              <b>Steps:</b> {stepChips(steps, kind, now.daysDue).join(' · ')}
              {now.outcome === 'open'
                ? (() => {
                    const n = stepNudge(
                      steps,
                      { reached: now.step ?? null, best: now.stepBest ?? null },
                      kind,
                    );
                    return n ? ` · ${n}` : '';
                  })()
                : ''}
            </p>
          ) : null}
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
  steps = [],
  kind = 'misses',
  who,
}: {
  repeat: Exclude<Repeat, 'none'>;
  periods: GoalPeriod[];
  today: string;
  /** The points a won period pays (each child, on an every-child goal); null when it pays something else. */
  points: number | null;
  /** [RWD-20] An every-child goal: the children's names, for each week's line. */
  who?: ChildNames;
  /** [RWD-18] Its steps, highest first, when it pays in steps: each won period pays its own. */
  steps?: Step[];
  kind?: StepKind;
}) {
  const now = currentPeriod(periods, today);
  const shown = periods.filter((p) => p.start <= today);
  const paidFor = (p: GoalPeriod) =>
    p.children && who
      ? familyPaid(p, points)
      : steps.length && p.step != null
        ? (steps[p.step]?.amount ?? 0)
        : (points ?? 0);
  /** "+20 each" for an every-child week paying two or more children, else "+20". */
  const paidPill = (p: GoalPeriod) => {
    const kids = (p.children ?? []).filter((c) => c.contributes).length;
    return p.children && who && kids > 1 ? `+${points ?? 0} each` : `+${paidFor(p)}`;
  };
  const paid = shown.filter((p) => p.outcome === 'won').reduce((sum, p) => sum + paidFor(p), 0);
  const plural = periodWord(repeat, 2);
  const nowLine =
    now && now.end >= today ? daysLine(steps.length ? { ...now, missesAllowed: 0 } : now) : null;
  return (
    <Fold
      title={`${plural[0]!.toUpperCase()}${plural.slice(1)}`}
      headingId="goal-weeks-heading"
      summary={[
        <b key="won">{wonLine(shown, repeat) ?? `Its first ${periodWord(repeat)}`}</b>,
        [
          points !== null ? `${paid.toLocaleString('en-US')} points paid` : null,
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
                      {p.children && who
                        ? familyWeekDetail(p, who.name, repeat)
                        : [
                            p.outcome === 'won' && steps.length
                              ? stepWonWords(steps, kind, p.step ?? null)
                              : (missedDaysLine(p) ?? words),
                            daysLine(steps.length ? { ...p, missesAllowed: 0 } : p),
                            notDueLine(p),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                    </span>
                  </span>
                </span>
                {p.outcome === 'won' && points !== null ? (
                  <span className="fw-goal__status" data-status="achieved">
                    {paidPill(p)}
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
