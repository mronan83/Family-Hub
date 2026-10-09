import { Banner, Button, PointsChip } from '@familywise/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { isoDay } from '@/lib/format';
import { ledgerDay, ledgerLine, pointsWord, signed } from '@/lib/points';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../../header';
import { setArchived } from '../actions';
import { loadAdmins, loadMembers, loadPoints } from '../data';
import { MemberForm } from '../member-form';
import { PointsForm } from '../points-form';

export const metadata: Metadata = { title: 'Edit member' };

export default async function EditMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ adjusted?: string }>;
}) {
  const { id } = await params;
  const db = await serverClient();
  const user = await requireSignedIn(db, `/admin/members/${id}`);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
  ]);
  const member = members.find((m) => m.id === id);
  if (!member) notFound();
  const points = await loadPoints(db!, member.id);
  const linkedElsewhere = new Set(
    members.filter((m) => m.id !== id && m.userId).map((m) => m.userId),
  );
  // An adjustment shows who made it: the admin's member name, else their email.
  const adminName = (userId: string) =>
    members.find((m) => m.userId === userId)?.displayName ??
    admins.find((a) => a.userId === userId)?.email ??
    'an admin';
  const today = isoDay(household.timezone);
  const adjusted = Number((await searchParams).adjusted);
  const showPoints = member.earnsRewards || points.entries.length > 0;

  return (
    <main className="fw-page">
      <AdminHeader current="/admin/members" />
      <section className="fw-card">
        <h1>{member.displayName}</h1>
        <MemberForm
          id={member.id}
          initial={member}
          admins={admins.filter((a) => !linkedElsewhere.has(a.userId))}
        />
      </section>
      {showPoints ? (
        <section className="fw-card" id="points" aria-labelledby="points-heading">
          <div className="fw-bar">
            <h2 id="points-heading">Points</h2>
            <PointsChip points={points.balance} size="admin" />
          </div>
          {Number.isInteger(adjusted) && adjusted !== 0 ? (
            <Banner kind="info">
              {adjusted > 0 ? 'Added' : 'Took away'} {pointsWord(Math.abs(adjusted))}.
            </Banner>
          ) : null}
          {member.earnsRewards && !member.archivedAt ? (
            <PointsForm memberId={member.id} name={member.displayName} requestId={randomUUID()} />
          ) : (
            <p className="fw-muted">
              {member.displayName} doesn&rsquo;t earn rewards now, so their points can&rsquo;t be
              changed. What they earned stays.
            </p>
          )}
          {points.entries.length === 0 ? (
            <p className="fw-muted">
              No points yet. They arrive as {member.displayName} checks off chores.
            </p>
          ) : (
            <ul className="fw-list" aria-label={`${member.displayName}’s points`}>
              {points.entries.map((e) => (
                <li key={e.id} className="fw-list__row">
                  <span>
                    <strong>{ledgerDay(e.at, household.timezone, today)}</strong>{' '}
                    {ledgerLine(e, adminName)}
                  </span>
                  <strong>{signed(e.amount)}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="fw-muted">
            Points are earned when a chore is done and given back if it&rsquo;s unchecked. Nothing
            here is ever edited or deleted: to correct a mistake, add or take away points.
          </p>
        </section>
      ) : null}
      {!member.archivedAt ? (
        <section className="fw-card" aria-labelledby="archive-heading">
          <h2 id="archive-heading">Archive</h2>
          <p className="fw-muted">
            {member.displayName} leaves the board and their chores and goals stop showing. Their
            history stays, and you can restore them from Members.
          </p>
          <form action={setArchived}>
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="archive" value="true" />
            <Button type="submit" variant="ghost" icon="minus-circle">
              Archive {member.displayName}
            </Button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
