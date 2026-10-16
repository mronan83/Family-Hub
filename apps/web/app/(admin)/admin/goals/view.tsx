import {
  Avatar,
  type AvatarKey,
  Banner,
  Button,
  Fold,
  GoalMeter,
  Icon,
  type IconName,
  type MemberColor,
  PeriodMarks,
} from '@familywise/ui';
import Image from 'next/image';
import Link from 'next/link';
import { day } from '@/lib/format';
import { bestLine, type Counted, countedLine, makesLine } from '@/lib/goal-perfect';
import { periodLabel, REPEAT_WORDS } from '@/lib/goal-periods';
import { goalSteps, stepChips, stepKind, stepNudge } from '@/lib/goal-steps';
import { describeRule, OPEN_STATUSES, payoutWords, STATUS_WORDS, streakLine } from '@/lib/goals';
import { AdminHeader } from '../header';
import { goalAction } from './actions';
import type { GoalRow } from './data';
import { type ChildNames, PeriodProgress, periodStatus } from './repeating';

export interface GoalsViewProps {
  goals: GoalRow[];
  members: {
    id: string;
    displayName: string;
    avatarKey?: AvatarKey | null;
    color?: MemberColor;
  }[];
  /** Tag and item names, for describing what a rule counts. */
  names: { tags: Map<string, string>; items: Map<string, string> };
  /** The household's parents, for "redeemed by". */
  admins: Map<string, string>;
  /** The shop's rewards by id, for what a goal pays. */
  prizes: Map<string, string>;
  timezone: string;
  /** The household's today, for a repeating goal's period going now. */
  today: string;
  notice: string | null;
  error: string | null;
}

/** "Oct 7" for a household-local date. */
const dateLabel = (iso: string) => day(`${iso}T12:00:00Z`, 'UTC');

export function GoalPicture({
  goal,
  size = 48,
}: {
  goal: Pick<GoalRow, 'icon' | 'imageUrl'>;
  size?: number;
}) {
  return goal.imageUrl ? (
    <Image
      src={goal.imageUrl}
      alt=""
      width={size}
      height={size}
      unoptimized
      className="fw-reward__photo"
    />
  ) : (
    <span className="fw-reward__icon" aria-hidden>
      <Icon name={goal.icon as IconName} size={28} />
    </span>
  );
}

/** "Started Oct 3 · ends Oct 17" / "Starts Oct 12" / "Started Oct 3, no end date". */
function dates(g: GoalRow): string {
  const start =
    g.status === 'scheduled'
      ? `Starts ${dateLabel(g.startDate)}`
      : `Started ${dateLabel(g.startDate)}`;
  return g.endDate ? `${start} · ends ${dateLabel(g.endDate)}` : `${start}, no end date`;
}

/** A goal's state; a repeating goal's says how this period stands (D-123's approved mockup). */
function GoalStatusPill({ goal: g, today }: { goal: GoalRow; today: string }) {
  const period =
    g.repeat !== 'none' && g.status === 'active' ? periodStatus(g.periods, today, g.repeat) : null;
  const status = period?.status ?? g.status;
  return (
    <span className="fw-goal__status" data-status={status}>
      {status === 'achieved' ? <Icon name="trophy" size={20} /> : null}
      {period
        ? period.words
        : g.status === 'achieved' && g.achievementCount > 1
          ? 'Achieved again'
          : STATUS_WORDS[g.status]}
    </span>
  );
}

type Names = {
  tags: Map<string, string>;
  items: Map<string, string>;
  goals?: Map<string, { title: string; repeat: GoalRow['repeat'] }>;
};

/**
 * [RWD-19] A rule counting another goal's weeks (the approved addendum): "1 of 3 weeks in a row · best
 * so far 1", and that goal's weeks since this one started, with what the week going now would make.
 */
function CountedWeeks({
  goal: g,
  rule: r,
  source,
}: {
  goal: GoalRow;
  rule: GoalRow['rules'][number];
  source: GoalRow | undefined;
}) {
  if (!source || source.repeat === 'none') return null;
  const c: Counted = {
    current: r.progress?.current ?? 0,
    target: r.target,
    inARow: r.params.in_a_row === true,
    best: r.params.in_a_row ? (r.progress?.bestStreak ?? 0) : null,
    met: r.progress?.met ?? false,
    repeat: source.repeat,
  };
  const weeks = source.periods
    .filter((p) => p.start >= g.startDate)
    .slice(-5)
    .map((p) => ({ start: p.start, end: p.end, outcome: p.outcome }));
  const makes = makesLine(c, weeks, 'admin');
  return (
    <div className="fw-goal__counted">
      <span className="fw-muted">{[countedLine(c), bestLine(c)].filter(Boolean).join(' · ')}</span>
      {weeks.length ? (
        <div className="fw-goal__weeks">
          <span className="fw-muted">{makes ?? ''}</span>
          <PeriodMarks
            label={`${source.title}: its last ${weeks.length}`}
            periods={weeks.map((p) => ({
              key: p.start,
              outcome: p.outcome,
              label: periodLabel(p, source.repeat as Exclude<GoalRow['repeat'], 'none'>),
            }))}
          />
        </div>
      ) : null}
    </div>
  );
}

/** [RWD-20] An every-child goal that doesn't repeat: each child's progress. */
function ChildProgress({ goal: g, who }: { goal: GoalRow; who: ChildNames }) {
  if (!g.children?.length) return null;
  return (
    <ul className="fw-goal__kids" aria-label="Each child">
      {g.children.map((c) => {
        const m = who.member(c.memberId);
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
              <span className="fw-muted">
                {!c.contributes
                  ? 'Nothing due'
                  : c.outcome === 'won'
                    ? 'Made it'
                    : `${Math.round(c.pct)}% there`}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** [RWD-02] A meter per rule, with a streak's run now and best. */
function RuleMeters({
  goal: g,
  names,
  goals = [],
}: {
  goal: GoalRow;
  names: Names;
  /** [RWD-19] The household's goals, for the weeks a rule counts. */
  goals?: GoalRow[];
}) {
  const steps = goalSteps(g.payout, g.rules);
  const weighted = steps.length > 0 && g.rules.length > 1;
  return (
    <div className="fw-goal__rules">
      {weighted ? (
        <p className="fw-muted">Weighted: reached at 100%, every rule met.</p>
      ) : g.rules.length > 1 ? (
        <p className="fw-muted">
          {g.logic === 'all'
            ? 'Reached when every rule is met.'
            : 'Reached when any one rule is met.'}
        </p>
      ) : null}
      {g.rules
        .filter((r) => r.type !== 'DAYS_DUE')
        .map((r) => {
          const value =
            r.type === 'STREAK'
              ? Math.max(r.progress?.bestStreak ?? 0, r.progress?.currentStreak ?? 0)
              : (r.progress?.current ?? 0);
          return (
            <div key={r.id} className="fw-goal__rule">
              <GoalMeter
                label={`${describeRule(r, names)}${weighted && r.weight ? ` · ${r.weight}%` : ''}`}
                value={Math.min(value, r.target)}
                target={r.target}
              />
              {r.type === 'PERIODS_WON' ? (
                <CountedWeeks
                  goal={g}
                  rule={r}
                  source={goals.find((x) => x.id === r.params.goal_id)}
                />
              ) : null}
              {r.type === 'STREAK' && r.progress ? (
                <span className="fw-muted">
                  {streakLine({
                    current: r.progress.currentStreak ?? 0,
                    best: r.progress.bestStreak ?? 0,
                    met: r.progress.met,
                  })}
                </span>
              ) : null}
            </div>
          );
        })}
      {steps.length && g.repeat === 'none' ? (
        <p className="fw-muted fw-goal__steps" data-testid="goal-steps">
          <b>Steps:</b> {stepChips(steps, stepKind(g.rules)).join(' · ')}
          {(() => {
            const nudge = stepNudge(
              steps,
              { reached: g.step ?? null, best: g.stepBest ?? null },
              stepKind(g.rules),
            );
            return nudge ? ` · ${nudge}` : '';
          })()}
        </p>
      ) : null}
    </div>
  );
}

/**
 * [RWD-01][RWD-04][RWD-09] A parent's goals: those in play, each with its rules and how far along they
 * are (as the rules engine last worked them out), to mark redeemed once achieved; and the history of
 * goals redeemed, ended or cancelled.
 */
export function GoalsView({
  goals,
  members,
  names,
  admins,
  prizes,
  timezone,
  today,
  notice,
  error,
}: GoalsViewProps) {
  const pays = (g: GoalRow) => {
    const words = payoutWords(g.payout, g.memberId === null, (i) => prizes.get(i));
    return words ? ` · Pays ${words}` : '';
  };
  const who = (id: string | null) =>
    id === null ? 'The whole family' : (members.find((m) => m.id === id)?.displayName ?? 'Someone');
  // [RWD-20] The children an every-child goal names; [RWD-19] the goals a rule may count.
  const childNames: ChildNames = {
    name: (id) => who(id),
    member: (id) => {
      const m = members.find((x) => x.id === id);
      return m ? { avatarKey: m.avatarKey ?? null, color: m.color ?? 'member-1' } : undefined;
    },
  };
  const allNames: Names = {
    ...names,
    goals: new Map(goals.map((g) => [g.id, { title: g.title, repeat: g.repeat }])),
  };
  const open = goals
    .filter((g) => OPEN_STATUSES.includes(g.status))
    .sort((a, b) => OPEN_STATUSES.indexOf(a.status) - OPEN_STATUSES.indexOf(b.status));
  const history = goals.filter((g) => !OPEN_STATUSES.includes(g.status));
  const count = (status: GoalRow['status']) => history.filter((g) => g.status === status).length;
  const historySummary = [
    count('redeemed') ? `${count('redeemed')} redeemed` : null,
    count('expired') ? `${count('expired')} ended` : null,
    count('cancelled') ? `${count('cancelled')} cancelled` : null,
  ].filter(Boolean) as string[];
  const toLook = history.filter((g) => g.needsReview).length;
  /** "Maya · each week · 1 miss allowed · Pays 10 points" for a repeating goal. */
  const repeatLine = (g: GoalRow) => {
    const misses = g.rules.find((r) => r.type === 'DAYS_DUE')?.params.misses_allowed ?? 0;
    return `${who(g.memberId)}${g.eachChild ? ' · every child meets it' : ''} · ${REPEAT_WORDS[g.repeat].toLowerCase()}${
      misses ? ` · ${misses} miss${misses > 1 ? 'es' : ''} allowed` : ''
    }${pays(g)}`;
  };

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/goals" />
      {error ? (
        <Banner kind="notice">{error}</Banner>
      ) : notice ? (
        <Banner kind="info">{notice}</Banner>
      ) : null}

      <section className="fw-card" aria-labelledby="goals-heading">
        <div className="fw-goals__head">
          <h1 id="goals-heading">Goals</h1>
          <Link href="/admin/goals/new" className="fw-btn fw-btn--primary">
            <Icon name="plus" className="fw-btn__icon" />
            <span>Set a goal</span>
          </Link>
        </div>
        <p className="fw-muted">
          Something to work toward, for a child or the whole family. Progress follows the
          check-offs: if one is undone, the goal follows it.
        </p>
        {open.length === 0 ? (
          <p>No goals going. Set one to give your family something to aim for.</p>
        ) : (
          <ul className="fw-goals" aria-label="Goals in play">
            {open.map((g) => (
              <li key={g.id} className="fw-goal" aria-labelledby={`goal-${g.id}`}>
                <div className="fw-item">
                  <GoalPicture goal={g} />
                  <span className="fw-item__body">
                    <strong id={`goal-${g.id}`}>{g.title}</strong>
                    <span className="fw-muted">
                      {g.repeat !== 'none' ? (
                        repeatLine(g)
                      ) : g.rules[0]?.type === 'PERIODS_WON' ? (
                        // [RWD-19] "Maya · counts Homework home every school day · Pays …".
                        <>
                          {who(g.memberId)} · counts{' '}
                          {goals.find((x) => x.id === g.rules[0]!.params.goal_id)?.title ??
                            'a removed goal'}
                          {pays(g)}
                        </>
                      ) : (
                        <>
                          {who(g.memberId)}
                          {g.eachChild ? ' · every child meets it' : ''} · {dates(g)}
                          {pays(g)}
                        </>
                      )}
                    </span>
                    {g.needsReview ? (
                      <span className="fw-goal__flag">
                        <Icon name="warning" size={20} />
                        Needs a look
                      </span>
                    ) : null}
                  </span>
                  <GoalStatusPill goal={g} today={today} />
                </div>
                {g.description ? <p className="fw-goal__description">{g.description}</p> : null}
                {g.pct === null ? (
                  <p className="fw-muted">Working out its progress…</p>
                ) : g.repeat !== 'none' ? (
                  <PeriodProgress
                    repeat={g.repeat}
                    periods={g.periods}
                    today={today}
                    pays={payoutWords(g.payout, g.memberId === null, (i) => prizes.get(i))}
                    steps={goalSteps(g.payout, g.rules)}
                    kind={stepKind(g.rules)}
                    onTime={g.rules[0]?.params.on_time ?? null}
                    who={g.eachChild ? childNames : undefined}
                    points={g.payout.type === 'points' ? g.payout.amount : null}
                  >
                    {g.rules.some((r) => r.type !== 'DAYS_DUE') ? (
                      <RuleMeters goal={g} names={allNames} goals={goals} />
                    ) : null}
                  </PeriodProgress>
                ) : (
                  <>
                    <RuleMeters goal={g} names={allNames} goals={goals} />
                    {g.eachChild ? <ChildProgress goal={g} who={childNames} /> : null}
                  </>
                )}
                <div className="fw-actions">
                  {g.status === 'achieved' ? (
                    <form action={goalAction}>
                      <Button
                        type="submit"
                        name="act"
                        value={`redeem:${g.id}`}
                        icon="gift"
                        aria-label={`Mark ${g.title} redeemed`}
                      >
                        Mark redeemed
                      </Button>
                    </form>
                  ) : null}
                  <Link
                    href={`/admin/goals/${g.id}`}
                    className="fw-btn fw-btn--ghost"
                    aria-label={`Change ${g.title}`}
                  >
                    <Icon name="edit" className="fw-btn__icon" />
                    <span>Change</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Fold
        title="History"
        headingId="history-heading"
        summary={
          historySummary.length
            ? [<b key="n">{historySummary.join(' · ')}</b>]
            : ['Goals that are redeemed, end or are cancelled are kept here.']
        }
        warning={toLook ? `${toLook} ${toLook === 1 ? 'needs' : 'need'} a look` : undefined}
      >
        {history.length === 0 ? (
          <p className="fw-muted">Goals that are redeemed, end or are cancelled are kept here.</p>
        ) : (
          <ul className="fw-list" aria-labelledby="history-heading">
            {history.map((g) => (
              <li key={g.id} className="fw-list__row">
                <span className="fw-item">
                  <GoalPicture goal={g} />
                  <span className="fw-item__body">
                    <strong>{g.title}</strong>
                    <span className="fw-muted">
                      {who(g.memberId)} · {STATUS_WORDS[g.status]}
                      {g.status === 'redeemed' && g.redeemedAt
                        ? ` ${day(g.redeemedAt, timezone)}${g.redeemedBy && admins.get(g.redeemedBy) ? ` by ${admins.get(g.redeemedBy)}` : ''}`
                        : g.status === 'expired' && g.endDate
                          ? ` ${dateLabel(g.endDate)}`
                          : g.status === 'cancelled' && g.archivedAt
                            ? ` ${day(g.archivedAt, timezone)}`
                            : ''}
                    </span>
                    {g.needsReview ? (
                      <span className="fw-goal__flag">
                        <Icon name="warning" size={20} />
                        Needs a look
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="fw-actions">
                  <Link
                    href={`/admin/goals/${g.id}`}
                    className="fw-btn fw-btn--ghost"
                    aria-label={`Details of ${g.title}`}
                  >
                    <span>Details</span>
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Fold>
    </main>
  );
}
