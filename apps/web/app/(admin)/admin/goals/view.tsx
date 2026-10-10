import { Banner, Button, GoalMeter, Icon, type IconName } from '@familywise/ui';
import Image from 'next/image';
import Link from 'next/link';
import { day } from '@/lib/format';
import { describeRule, OPEN_STATUSES, STATUS_WORDS, streakLine } from '@/lib/goals';
import { AdminHeader } from '../header';
import { goalAction } from './actions';
import type { GoalRow } from './data';

export interface GoalsViewProps {
  goals: GoalRow[];
  members: { id: string; displayName: string }[];
  /** Tag and item names, for describing what a rule counts. */
  names: { tags: Map<string, string>; items: Map<string, string> };
  /** The household's parents, for "redeemed by". */
  admins: Map<string, string>;
  timezone: string;
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
  timezone,
  notice,
  error,
}: GoalsViewProps) {
  const who = (id: string | null) =>
    id === null ? 'The whole family' : (members.find((m) => m.id === id)?.displayName ?? 'Someone');
  const open = goals
    .filter((g) => OPEN_STATUSES.includes(g.status))
    .sort((a, b) => OPEN_STATUSES.indexOf(a.status) - OPEN_STATUSES.indexOf(b.status));
  const history = goals.filter((g) => !OPEN_STATUSES.includes(g.status));

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
                      {who(g.memberId)} · {dates(g)}
                    </span>
                  </span>
                  <span className="fw-goal__status" data-status={g.status}>
                    {g.status === 'achieved' ? <Icon name="trophy" size={20} /> : null}
                    {g.status === 'achieved' && g.achievementCount > 1
                      ? 'Achieved again'
                      : STATUS_WORDS[g.status]}
                  </span>
                </div>
                {g.description ? <p className="fw-goal__description">{g.description}</p> : null}
                {g.pct === null ? (
                  <p className="fw-muted">Working out its progress…</p>
                ) : (
                  <div className="fw-goal__rules">
                    {g.rules.length > 1 ? (
                      <p className="fw-muted">
                        {g.logic === 'all'
                          ? 'Reached when every rule is met.'
                          : 'Reached when any one rule is met.'}
                      </p>
                    ) : null}
                    {g.rules.map((r) => {
                      const value =
                        r.type === 'STREAK'
                          ? Math.max(r.progress?.bestStreak ?? 0, r.progress?.currentStreak ?? 0)
                          : (r.progress?.current ?? 0);
                      return (
                        <div key={r.id} className="fw-goal__rule">
                          <GoalMeter
                            label={describeRule(r, names)}
                            value={Math.min(value, r.target)}
                            target={r.target}
                          />
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
                  </div>
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

      <section className="fw-card" aria-labelledby="history-heading">
        <h2 id="history-heading">History</h2>
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
      </section>
    </main>
  );
}
