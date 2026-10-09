import { AVATAR_KEYS, MEMBER_COLORS, type AvatarKey, type MemberColor } from '@familywise/ui';

/** Names for the member colors (06 §4.2), for labels and screen readers; never shown alone. */
export const COLOR_NAMES: Record<MemberColor, string> = {
  'member-1': 'Blue',
  'member-2': 'Rose',
  'member-3': 'Orange',
  'member-4': 'Violet',
  'member-5': 'Green',
  'member-6': 'Teal',
};

export type MemberRole = 'child' | 'adult';

export interface MemberInput {
  displayName: string;
  role: MemberRole;
  avatarKey: AvatarKey | null;
  color: MemberColor;
  birthYear: number | null;
  earnsRewards: boolean;
  /** The admin's sign-in this adult is; always null for a child (no logins for children, ACC-04). */
  userId: string | null;
}

export type Parsed = { ok: true; value: MemberInput } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * [ACC-04][PTS-07] A member form, checked the way the database will check it (tenancy migration),
 * so the admin gets a plain line instead of a constraint error. The earns-rewards switch is sent
 * explicitly: the form starts it from the role (on for a child, off for an adult, D-32).
 */
export function parseMember(form: FormData, thisYear = new Date().getFullYear()): Parsed {
  const displayName = String(form.get('displayName') ?? '').trim();
  if (displayName.length < 1 || displayName.length > 40) {
    return { ok: false, message: 'Give them a name of up to 40 characters.' };
  }
  const role = form.get('role');
  if (role !== 'child' && role !== 'adult') return { ok: false, message: 'Choose child or adult.' };
  const avatar = String(form.get('avatarKey') ?? '');
  const avatarKey = (AVATAR_KEYS as readonly string[]).includes(avatar)
    ? (avatar as AvatarKey)
    : null;
  if (avatar && avatar !== 'initials' && !avatarKey)
    return { ok: false, message: 'Choose an avatar.' };
  const color = String(form.get('color') ?? 'member-1');
  if (!(MEMBER_COLORS as readonly string[]).includes(color)) {
    return { ok: false, message: 'Choose a color.' };
  }
  const yearText = String(form.get('birthYear') ?? '').trim();
  const birthYear = yearText ? Number(yearText) : null;
  if (
    birthYear !== null &&
    (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > thisYear)
  ) {
    return {
      ok: false,
      message: `Enter a birth year between 1900 and ${thisYear}, or leave it empty.`,
    };
  }
  const link = String(form.get('userId') ?? '');
  if (link && !UUID.test(link)) return { ok: false, message: 'Choose a sign-in from the list.' };
  return {
    ok: true,
    value: {
      displayName,
      role,
      avatarKey,
      color: color as MemberColor,
      birthYear,
      earnsRewards: form.get('earnsRewards') === 'on',
      userId: role === 'adult' && link ? link : null,
    },
  };
}

/** Database errors on a member save, as lines for the admin. */
export function memberSaveMessage(error: { code?: string | null; hint?: string | null }): string {
  if (error.hint === 'member_user_not_admin') {
    return 'Only an admin of this household can be linked. Invite them first.';
  }
  if (error.code === '23505') return 'That sign-in is already linked to another member.';
  return 'That didn’t save. Try again in a moment.';
}
