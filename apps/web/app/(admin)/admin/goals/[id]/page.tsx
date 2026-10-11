import { Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound, redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { dayAndTime, isoDay } from '@/lib/format';
import { eventWords, STATUS_WORDS } from '@/lib/goals';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { goalAction, removeGoalPhoto } from '../actions';
import { loadGoalEvents, loadGoals } from '../data';
import { GoalForm, type GoalLock } from '../goal-form';
import { bringGoalsUpToDate, loadGoalContext } from '../load';

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
  searchParams: Promise<{ photo?: string }>;
}) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/goals/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  await bringGoalsUpToDate(db!, household.id);
  const goal = (await loadGoals(db!, household.id)).find((g) => g.id === id);
  if (!goal) notFound();
  const [events, ctx] = await Promise.all([
    loadGoalEvents(db!, id),
    loadGoalContext(db!, household.id),
  ]);
  const removed = (await searchParams).photo === 'removed';
  const lock: GoalLock = ['redeemed', 'expired', 'cancelled'].includes(goal.status)
    ? 'finished'
    : goal.status === 'scheduled' || goal.status === 'draft'
      ? 'none'
      : 'started';
  const who =
    goal.memberId === null
      ? 'The whole family'
      : (ctx.members.find((m) => m.id === goal.memberId)?.displayName ?? 'Someone');
  const actor = (e: (typeof events)[number]) =>
    e.actorType === 'admin' && e.actorId ? ` · ${ctx.adminNames.get(e.actorId) ?? 'A parent'}` : '';

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/goals" />
      {removed ? <Banner kind="info">The photo is removed; the icon shows instead.</Banner> : null}
      <section className="fw-card">
        <h1>{goal.title}</h1>
        <p className="fw-muted">
          {who} · {STATUS_WORDS[goal.status]}
          {goal.pct !== null ? ` · ${Math.round(goal.pct)}% there` : ''}
        </p>
        {goal.needsReview ? (
          <div className="fw-goal__review">
            <Banner kind="notice">
              A check-off this goal needed was undone after it was redeemed. Have a look, then clear
              this.
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
            {lock === 'started'
              ? 'It has started, so who it’s for and its start date stay as they are. Changing its rules or end date works its progress out again from every check-off.'
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
            rules: goal.rules.map((r) => ({
              type: r.type,
              target: r.target,
              scope: 'all' in r.scope ? 'all' : r.scope.tag_ids?.length ? 'tags' : 'items',
              tagIds: 'all' in r.scope ? [] : (r.scope.tag_ids ?? []),
              itemIds: 'all' in r.scope ? [] : (r.scope.chore_ids ?? []),
              grace: r.params.grace_per_week ?? 1,
            })),
          }}
          members={ctx.earners}
          tags={ctx.tags}
          items={ctx.items}
          today={isoDay(household.timezone)}
          lock={lock}
          hasPhoto={!!goal.imagePath}
        />
      </section>

      <section className="fw-card" aria-labelledby="goal-history-heading">
        <h2 id="goal-history-heading">What happened</h2>
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
      </section>

      {goal.status !== 'redeemed' && goal.status !== 'cancelled' ? (
        <section className="fw-card" aria-labelledby="cancel-heading">
          <h2 id="cancel-heading">Cancel</h2>
          <p className="fw-muted">It stops counting and moves to the history.</p>
          <form action={goalAction}>
            <Button
              type="submit"
              name="act"
              value={`cancel:${goal.id}`}
              variant="ghost"
              icon="minus-circle"
            >
              {`Cancel ${goal.title}`}
            </Button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
