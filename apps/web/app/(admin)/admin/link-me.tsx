import { Avatar, type AvatarKey, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import { linkMe } from './link-actions';

export interface LinkCandidate {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

/**
 * [CHR-14][CHR-15][ACC-04] "Which one is you?" (D-61): a parent whose sign-in isn't linked to anyone in
 * the family chooses themselves among the adults with no sign-in, in one tap, on the page they need it
 * for. A parent whose own record says Child is told how to change it, and one not in the family yet
 * how to add themselves.
 */
export function LinkMe({
  candidates,
  back,
  purpose,
}: {
  candidates: LinkCandidate[];
  /** The page to come back to once linked. */
  back: '/admin/reminders' | '/admin/my';
  /** What linking is for here: "your reminders", "your tasks". */
  purpose: string;
}) {
  return (
    <section className="fw-link-me" aria-labelledby="link-me-heading">
      <h2 id="link-me-heading">Which one is you?</h2>
      <p>
        Your sign-in isn’t linked to anyone in the family yet. Choose yourself, and {purpose} will
        find you.
      </p>
      {candidates.length > 0 ? (
        <ul className="fw-link-me__list" aria-label="Adults without a sign-in">
          {candidates.map((m) => (
            <li key={m.id}>
              <form action={linkMe}>
                <input type="hidden" name="member" value={m.id} />
                <input type="hidden" name="back" value={back} />
                <button type="submit" className="fw-link-me__choice">
                  <Avatar
                    name={m.displayName}
                    avatarKey={m.avatarKey}
                    color={m.color}
                    size={40}
                    decorative
                  />
                  <span>I’m {m.displayName}</span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fw-muted">Every adult in the family already has a sign-in.</p>
      )}
      <p className="fw-muted">
        Not listed? Only an adult can have a sign-in: if your record says Child, open it on{' '}
        <Link href="/admin/members">Members</Link> and choose Adult. Not in the family yet?{' '}
        <Link href="/admin/members/new">Add yourself</Link> as an adult.
      </p>
    </section>
  );
}
