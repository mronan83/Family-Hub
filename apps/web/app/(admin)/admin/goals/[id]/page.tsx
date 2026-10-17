import { Banner, Button, Fold } from '@familywise/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { dayAndTime, isoDay } from '@/lib/format';
import { daysLine, periodWord, REPEAT_WORDS, spanWords, thisPeriod } from '@/lib/goal-periods';
import { goalSteps, stepKind } from '@/lib/goal-steps';
import { eventWords, payoutWords, STATUS_WORDS } from '@/lib/goals';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { goalAction, removeGoalPhoto } from '../actions';
import { countableGoals, loadGoalEvents, loadGoals } from '../data';
import { GoalForm, type GoalLock } from '../goal-form';
import { GoalHead, GoalStatusPill } from '../view';
import { bringGoalsUpToDate, loadGoalContext } from '../load';
import { currentPeriod, WeeksFold } from '../repeating';

export const metadata: Metadata = { title: 'Goal' };

/**
 * [RWD-01][RWD-06][RWD-09] One goal: change it (what may change depends on how far it has got, D-56),
 * its photo, a review flag to clear, what happened to it and when, and cancelling it.
 */
export default async function GoalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ photo?: string; did?: string }>;
}) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/goals/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  await bringGoalsUpToDate(db!, household.id);
  const goals = await loadGoals(db!, household.id);
  const goal = goals.find((g) => g.id === id);
  if (!goal) notFound();
  const [events, ctx] = await Promise.all([
    loadGoalEvents(db!, id),
    loadGoalContext(
      db!,
      household.id,
      goal.payout.type === 'catalog_item' ? goal.payout.item_id : undefined,
    ),
  ]);
  const query = await searchParams;
  const removed = query.photo === 'removed';
  const stopped = query.did === 'stop';
  const today = isoDay(household.timezone);
  const repeat = goal.repeat;
  const now = repeat !== 'none' ? currentPeriod(goal.periods, today) : null;
  // A reached goal is locked as a finished one is: a change could take back what it unlocked (D-115).
  const lock: GoalLock = ['achieved', 'redeemed', 'expired', 'cancelled'].includes(goal.status)
    ? 'finished'
    : goal.status === 'scheduled' || goal.status === 'draft'
      ? 'none'
      : 'started';
  const who =
    goal.memberId === null
      ? `The whole family${goal.eachChild ? ' · every child meets it' : ''}`
      : (ctx.members.find((m) => m.id === goal.memberId)?.displayName ?? 'Someone');
  // [RWD-20] The children an every-child goal's weeks name.
  const childNames = {
    name: (mid: string) => ctx.members.find((m) => m.id === mid)?.displayName ?? 'Someone',
    member: (mid: string) => ctx.members.find((m) => m.id === mid),
  };
  const pays = payoutWords(goal.payout, goal.memberId === null, (i) => ctx.prizeNames.get(i));
  const actor = (e: (typeof events)[number]) =>
    e.actorType === 'admin' && e.actorId ? ` · ${ctx.adminNames.get(e.actorId) ?? 'A parent'}` : '';

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/goals" />
      {removed ? <Banner kind="info">The photo is removed; the icon shows instead.</Banner> : null}
      <GoalHead
        title={goal.title}
        pill={<GoalStatusPill goal={goal} today={today} />}
        line={
          <>
            {who} · {STATUS_WORDS[goal.status]}
            {repeat !== 'none'
              ? ` · ${REPEAT_WORDS[repeat].toLowerCase()}${now && daysLine(now) ? ` · ${thisPeriod(repeat).toLowerCase()} ${daysLine(now)}` : ''}`
              : goal.pct !== null
                ? ` · ${Math.round(goal.pct)}% there`
                : ''}
            {pays ? ` · Pays ${pays}` : ''}
          </>
        }
      />
      <section className="fw-card">
        {goal.needsReview ? (
          <div className="fw-goal__review">
            <Banner kind="notice">
              A check-off this goal needed was undone after its reward was given. Have a look (its
              history below says what happened), then clear this.
            </Banner>
            <form action={goalAction}>
              <Button
                type="submit"
                name="act"
                value={`review:${goal.id}`}
                variant="secondary"
                icon="check"
              >
                Clear
              </Button>
            </form>
          </div>
        ) : null}
        {goal.imageUrl ? (
          <div className="fw-reward__photo-row">
            <Image
              src={goal.imageUrl}
              alt={`Photo of ${goal.title}`}
              width={160}
              height={160}
              unoptimized
              className="fw-reward__photo fw-reward__photo--large"
            />
            <form action={removeGoalPhoto}>
              <input type="hidden" name="id" value={goal.id} />
              <Button type="submit" variant="ghost" icon="trash">
                Remove photo
              </Button>
            </form>
          </div>
        ) : null}
        {lock !== 'none' ? (
          <p className="fw-field__help">
            {lock === 'started' && repeat !== 'none'
              ? `It has started, so who it’s for, its start date and how it repeats stay as they are. A change counts from this ${periodWord(repeat)}, or from the next one when this one is already won; a ${periodWord(repeat)} already won keeps its rules and what it paid.`
              : lock === 'started'
                ? 'It has started, so who it’s for and its start date stay as they are. Changing its rules or end date works its progress out again from every check-off.'
                : goal.status === 'achieved'
                  ? 'It has been reached, so its rules and dates stay as they are. Its name, description and picture can still change.'
                  : 'It has finished, so its rules and dates stay as they are.'}
          </p>
        ) : null}
        <GoalForm
          id={goal.id}
          initial={{
            title: goal.title,
            description: goal.description,
            icon: goal.icon,
            memberId: goal.memberId,
            startDate: goal.startDate,
            endDate: goal.endDate,
            logic: goal.logic,
            repeat: goal.repeat,
            eachChild: goal.eachChild ?? false,
            payout: goal.payout,
            rules: goal.rules.map((r) => ({
              type: r.type,
              target: r.target,
              scope: 'all' in r.scope ? 'all' : r.scope.tag_ids?.length ? 'tags' : 'items',
              tagIds: 'all' in r.scope ? [] : (r.scope.tag_ids ?? []),
              itemIds: 'all' in r.scope ? [] : (r.scope.chore_ids ?? []),
              grace: r.params.grace_per_week ?? 1,
              misses: r.params.misses_allowed ?? 0,
              onTime: r.params.on_time ?? null,
              weight: r.weight,
              source: r.params.goal_id ?? null,
              inARow: r.params.in_a_row ?? false,
            })),
          }}
          members={ctx.earners}
          tags={ctx.tags}
          items={ctx.items}
          prizes={ctx.prizes}
          today={isoDay(household.timezone)}
          lock={lock}
          hasPhoto={!!goal.imagePath}
          countable={countableGoals(goals)}
        />
      </section>

      {repeat !== 'none' ? (
        <WeeksFold
          repeat={repeat}
          periods={goal.periods}
          today={today}
          points={goal.payout.type === 'points' ? goal.payout.amount : null}
          steps={goalSteps(goal.payout, goal.rules)}
          kind={stepKind(goal.rules)}
          who={goal.eachChild ? childNames : undefined}
        />
      ) : null}

      <Fold
        title="What happened"
        headingId="goal-history-heading"
        summary={
          events[0]
            ? [
                <span key="latest">
                  <b>Latest:</b> {eventWords(events[0])},{' '}
                  {dayAndTime(events[0].at, household.timezone)} · {events.length}{' '}
                  {events.length === 1 ? 'event' : 'events'}
                </span>,
              ]
            : undefined
        }
      >
        <ul className="fw-list" aria-labelledby="goal-history-heading">
          {events.map((e) => (
            <li key={e.id} className="fw-list__row">
              <span className="fw-item__body">
                <strong>{eventWords(e)}</strong>
                <span className="fw-muted">
                  {dayAndTime(e.at, household.timezone)}
                  {actor(e)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Fold>

      {goal.status !== 'redeemed' && goal.status !== 'cancelled' ? (
        <Fold
          id="stop"
          title={repeat !== 'none' && goal.status === 'active' ? 'Stop or cancel' : 'Cancel'}
          headingId="cancel-heading"
          open={stopped}
          summary={[
            repeat !== 'none' && goal.status === 'active'
              ? `Stop it after this ${periodWord(repeat)}, or cancel it now`
              : 'It stops counting and moves to the history',
          ]}
        >
          {stopped && goal.endDate ? (
            <Banner kind="info">
              It stops after{' '}
              {
                spanWords({ start: goal.endDate, end: goal.endDate, outcome: 'open' }).split(
                  ' to ',
                )[0]
              }
              : this {repeat === 'none' ? 'period' : periodWord(repeat)} still counts.
            </Banner>
          ) : null}
          {repeat !== 'none' && goal.status === 'active' ? (
            <p className="fw-muted">
              <b>Stop after this {periodWord(repeat)}</b> ends it on the last day of this{' '}
              {periodWord(repeat)}: it still counts and pays. <b>Cancel</b> stops it now; nothing
              more is paid.
            </p>
          ) : (
            <p className="fw-muted">It stops counting and moves to the history.</p>
          )}
          <div className="fw-actions">
            {repeat !== 'none' && goal.status === 'active' ? (
              <form action={goalAction}>
                <Button
                  type="submit"
                  name="act"
                  value={`stop:${goal.id}`}
                  variant="secondary"
                  icon="calendar-check"
                >
                  {`Stop after this ${periodWord(repeat)}`}
                </Button>
              </form>
            ) : null}
            <form action={goalAction}>
              <Button
                type="submit"
                name="act"
                value={`cancel:${goal.id}`}
                variant="danger"
                icon="minus-circle"
              >
                {`Cancel ${goal.title}`}
              </Button>
            </form>
          </div>
        </Fold>
      ) : null}
    </main>
  );
}
