// "Which one is you?" (D-61): a parent links their own sign-in to themselves in the family in one tap,
// from Reminders, My tasks or an adult's page on Members. The database decides (link_my_member); this
// says where to go back to, who can be chosen, and the words.

/** Where a link goes back to: the page it was made on, and nowhere else. */
export function linkBack(raw: unknown): string {
  const back = typeof raw === 'string' ? raw : '';
  if (back === '/admin/reminders' || back === '/admin/my') return back;
  if (/^\/admin\/members\/[0-9a-f-]{36}$/.test(back)) return back;
  return '/admin/members';
}

/** Who a parent can say they are: the adults still here with no sign-in, by name. */
export function linkCandidates<
  M extends {
    role: 'child' | 'adult';
    userId: string | null;
    archivedAt: string | null;
    displayName: string;
  },
>(members: M[]): M[] {
  return members
    .filter((m) => m.role === 'adult' && !m.userId && !m.archivedAt)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** link_my_member()'s refusals, in the admin app's words. */
export const LINK_ERRORS: Record<string, string> = {
  link_not_adult:
    'Only an adult can have a sign-in. Open that record on Members and choose Adult first.',
  link_linked_to_someone_else: 'That one already has someone else’s sign-in.',
  link_member_archived: 'That one is archived. Restore them on Members first.',
  link_failed: 'That didn’t link. Try again in a moment.',
};

/** The error key for a refusal's hint (one this app knows, else the general one). */
export function linkError(hint: string | null | undefined): string {
  const key = `link_${hint ?? ''}`;
  return key in LINK_ERRORS ? key : 'link_failed';
}
