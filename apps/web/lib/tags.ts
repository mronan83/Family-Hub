import { ICON_NAMES, MEMBER_COLORS, type IconName, type MemberColor } from '@familywise/ui';

// [CHR-10] Household tags (D-33): a name, one of the six categorical colors and an optional icon.
// Goals, filters and insights keep the tag's id, so renaming or archiving one never breaks a goal.
// A tag always shows its name; the color is never the only signal (06 §4.2).

export const TAG_COLORS = MEMBER_COLORS;

/** Icons offered for a tag: the chore icons and a few for times of day, school and rewards. */
export const TAG_ICONS: IconName[] = [
  'sun',
  'moon',
  'backpack',
  'home',
  'utensils',
  'star',
  'gift',
  'calendar',
  ...ICON_NAMES.filter((n) => n.startsWith('chore-')),
];

export interface TagInput {
  name: string;
  color: MemberColor;
  icon: IconName | null;
}

export type ParsedTag = { ok: true; value: TagInput } | { ok: false; message: string };

export function parseTag(form: FormData): ParsedTag {
  const name = String(form.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 30) {
    return { ok: false, message: 'Give the tag a name of up to 30 characters.' };
  }
  const color = String(form.get('color') ?? 'member-6');
  if (!(TAG_COLORS as readonly string[]).includes(color)) {
    return { ok: false, message: 'Choose a color.' };
  }
  const iconText = String(form.get('icon') ?? '');
  if (iconText && !(ICON_NAMES as readonly string[]).includes(iconText)) {
    return { ok: false, message: 'Choose an icon.' };
  }
  return {
    ok: true,
    value: { name, color: color as MemberColor, icon: iconText ? (iconText as IconName) : null },
  };
}

export function tagSaveMessage(error: { code?: string | null }): string {
  if (error.code === '23505') {
    return 'There’s already a tag with that name. If it’s archived, restore it instead.';
  }
  return 'That didn’t save. Try again in a moment.';
}
