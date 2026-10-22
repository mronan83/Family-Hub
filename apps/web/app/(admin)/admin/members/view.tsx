import { Avatar, Banner, Button, Fold, PointsChip } from '@familywise/ui';
import Link from 'next/link';
import {
  balanceText,
  ledgerDay,
  ledgerLine,
  type LedgerEntry,
  pointsWord,
  signed,
} from '@/lib/points';
import { membersArchivedLine, pointsLine } from '@/lib/reward-facts';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { linkMe } from '../link-actions';
import { setArchived } from './actions';
import type { MemberRow } from './data';
import { type AdminOption, MemberForm } from './member-form';
import { PointsForm } from './points-form';

/**
 * [ACC-04][PTS-07][PTS-02] The household's members: children and adults, with avatar, color, whether
 * they earn rewards and their points. Archived members keep their history and can be restored.
 * [NFR-18] The list open, Archived folded to how many and who (WP-95, D-120), open after an archive.
 */
export function MembersView({
  members,
  emailOf,
  balances,
  saved,
  archivedOpen = false,
}: {
  members: MemberRow[];
  /** An admin's email by their user id. */
  emailOf: Map<string, string>;
  balances: Map<string, number>;
  saved?: string;
  archivedOpen?: boolean;
}) {
  const active = members.filter((m) => !m.archivedAt);
  const archived = members.filter((m) => m.archivedAt);
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
                <span className="fw-item">
                  <Avatar
                    name={m.displayName}
                    avatarKey={m.avatarKey}
                    color={m.color}
                    size={40}
                    decorative
                  />
                  <span className="fw-item__body">
                    <strong>{m.displayName}</strong>
                    <span className="fw-muted">
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
        <Fold
          id="archived"
          title="Archived"
          headingId="archived-heading"
          open={archivedOpen}
          summary={[
            <Line key="a" line={membersArchivedLine(archived.map((m) => m.displayName))} />,
          ]}
        >
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
        </Fold>
      ) : null}
    </main>
  );
}

export interface MemberViewProps {
  member: MemberRow;
  /** Admins of the household who are not linked to another member. */
  admins: AdminOption[];
  /** [D-61] Sign-ins linked to another member, said on the form. */
  elsewhere: { email: string; name: string; archived: boolean }[];
  /** [D-61] "This is me" is offered; `mine` is the member the sign-in is on now, if any. */
  offerMe: { mine: string | null } | null;
  /** A banner at the top: linked, or why linking failed. */
  linked: boolean;
  linkError: string | null;
  points: { balance: number; entries: LedgerEntry[] };
  /** Who made an adjustment: the admin's member name, else their email. */
  adminName: (userId: string) => string;
  timezone: string;
  /** The household's date (YYYY-MM-DD). */
  today: string;
  /** Points just added (positive) or taken away (negative), from the address. */
  adjusted: number;
  /** [NFR-18] Points (and Change points) open again after a change (`memberOpen`). */
  pointsOpen: boolean;
  /** A fresh id for the points form, so a double tap posts once. */
  requestId: string;
}

/**
 * [ACC-04][PTS-01][PTS-02] A member's page: the form open; Points folded to the balance and the last
 * change, opening to Change points and the history, and open again after a change; Archive set apart
 * at the bottom (WP-95, D-120).
 */
export function MemberView({
  member,
  admins,
  elsewhere,
  offerMe,
  linked,
  linkError,
  points,
  adminName,
  timezone,
  today,
  adjusted,
  pointsOpen,
  requestId,
}: MemberViewProps) {
  const showPoints = member.earnsRewards || points.entries.length > 0;
  const canChange = member.earnsRewards && !member.archivedAt;
  const last = points.entries[0];
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/members" />
      <section className="fw-card">
        <h1>{member.displayName}</h1>
        {linked ? (
          <Banner kind="info">Linked: you’re {member.displayName} now.</Banner>
        ) : linkError ? (
          <Banner kind="notice">{linkError}</Banner>
        ) : null}
        <MemberForm id={member.id} initial={member} admins={admins} elsewhere={elsewhere} />
      </section>
      {offerMe ? (
        <section className="fw-card" aria-labelledby="me-heading">
          <h2 id="me-heading">Is this you?</h2>
          <p className="fw-muted">
            {offerMe.mine
              ? `Your sign-in is on ${offerMe.mine}, who is archived. Move it here, and your own tasks and reminders will find you.`
              : 'Your sign-in isn’t linked to anyone yet. Link it here, and your own tasks and reminders will find you.'}
          </p>
          <form action={linkMe}>
            <input type="hidden" name="member" value={member.id} />
            <input type="hidden" name="back" value={`/admin/members/${member.id}`} />
            <Button type="submit" variant="secondary" icon="person">
              This is me
            </Button>
          </form>
        </section>
      ) : null}
      {showPoints ? (
        <Fold
          id="points"
          title="Points"
          headingId="points-heading"
          open={pointsOpen}
          summary={[
            <Line
              key="p"
              line={pointsLine(
                points.balance,
                last ? { ...last, what: ledgerLine(last, adminName) } : null,
                timezone,
                today,
              )}
            />,
          ]}
        >
          <div className="fw-bar">
            <PointsChip points={points.balance} size="admin" />
          </div>
          {pointsOpen ? (
            <Banner kind="info">
              {adjusted > 0 ? 'Added' : 'Took away'} {pointsWord(Math.abs(adjusted))}.
            </Banner>
          ) : null}
          {canChange ? (
            <Fold
              variant="inner"
              id="change-points"
              title="Change points"
              headingId="change-points-heading"
              button={{ label: 'Change points', icon: 'plus' }}
              open={pointsOpen}
            >
              <PointsForm memberId={member.id} name={member.displayName} requestId={requestId} />
            </Fold>
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
                    <strong>{ledgerDay(e.at, timezone, today)}</strong> {ledgerLine(e, adminName)}
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
        </Fold>
      ) : null}
      {/* Set apart at the bottom, and rare (D-120). */}
      {!member.archivedAt ? (
        <Fold
          id="archive"
          title="Archive"
          headingId="archive-heading"
          summary={['Off the board; chores and goals stop showing; history kept']}
        >
          <p className="fw-muted">
            {member.displayName} leaves the board and their chores and goals stop showing. Their
            history stays, and you can restore them from Members.
          </p>
          <form action={setArchived}>
            <input type="hidden" name="id" value={member.id} />
            <input type="hidden" name="archive" value="true" />
            <Button type="submit" variant="danger" icon="minus-circle">
              Archive {member.displayName}
            </Button>
          </form>
        </Fold>
      ) : null}
    </main>
  );
}
