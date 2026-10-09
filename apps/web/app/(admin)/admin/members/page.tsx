import { Avatar, Banner, Button } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { balanceText } from '@/lib/points';
import { serverClient } from '@/lib/supabase/server';
import { AdminHeader } from '../header';
import { setArchived } from './actions';
import { loadAdmins, loadBalances, loadMembers } from './data';

export const metadata: Metadata = { title: 'Members' };

// [ACC-04][PTS-07][PTS-02] The household's members: children and adults, with avatar, color, whether
// they earn rewards and their points. Archived members keep their history and can be restored.
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/members');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const [members, admins, balances] = await Promise.all([
    loadMembers(db!, household.id),
    loadAdmins(db!, household.id),
    loadBalances(db!, household.id),
  ]);
  const emailOf = new Map(admins.map((a) => [a.userId, a.email]));
  const active = members.filter((m) => !m.archivedAt);
  const archived = members.filter((m) => m.archivedAt);
  const { saved } = await searchParams;

  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/members" />
      {saved ? <Banner kind="info">Saved {saved}.</Banner> : null}
      <section className="fw-card" aria-labelledby="members-heading">
        <div className="fw-bar">
          <h1 id="members-heading">Members</h1>
          <Link className="fw-btn fw-btn--primary" href="/admin/members/new">
            Add a member
          </Link>
        </div>
        {active.length === 0 ? (
          <p className="fw-muted">No members yet. Add the first one.</p>
        ) : (
          <ul className="fw-list" aria-label="Members">
            {active.map((m) => (
              <li key={m.id} className="fw-list__row">
                <span className="fw-actions">
                  <Avatar
                    name={m.displayName}
                    avatarKey={m.avatarKey}
                    color={m.color}
                    size={40}
                    decorative
                  />
                  <span>
                    <strong>{m.displayName}</strong>
                    <span className="fw-muted">
                      {' · '}
                      {m.role === 'child' ? 'Child' : 'Adult'}
                      {' · '}
                      {m.earnsRewards
                        ? `Earns rewards · ${balanceText(balances.get(m.id) ?? 0)}`
                        : 'No rewards'}
                      {m.userId ? ` · Signs in as ${emailOf.get(m.userId) ?? 'an admin'}` : ''}
                    </span>
                  </span>
                </span>
                <Link href={`/admin/members/${m.id}`} aria-label={`Edit ${m.displayName}`}>
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="fw-card" aria-labelledby="archived-heading">
          <h2 id="archived-heading">Archived</h2>
          <p className="fw-muted">Off the board, with their history kept.</p>
          <ul className="fw-list" aria-label="Archived members">
            {archived.map((m) => (
              <li key={m.id} className="fw-list__row">
                <span>{m.displayName}</span>
                <form action={setArchived}>
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="archive" value="false" />
                  <Button type="submit" variant="ghost" icon="undo">
                    Restore {m.displayName}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
