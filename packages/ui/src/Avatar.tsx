// Member avatars (06 §8.1): one of eight characters, or initials on the member's color. Keys and
// colors match the `member.avatar_key` and `member.color` checks in the tenancy migration.

export const AVATAR_KEYS = ['owl', 'bear', 'fox', 'cat', 'bunny', 'dog', 'frog', 'panda'] as const;
export type AvatarKey = (typeof AVATAR_KEYS)[number];

export const MEMBER_COLORS = [
  'member-1',
  'member-2',
  'member-3',
  'member-4',
  'member-5',
  'member-6',
  'member-7',
  'member-8',
  'member-9',
  'member-10',
  'member-11',
  'member-12',
  'member-13',
  'member-14',
  'member-15',
  'member-16',
] as const;
export type MemberColor = (typeof MEMBER_COLORS)[number];

export interface AvatarProps {
  name: string;
  avatarKey?: AvatarKey | null;
  color?: MemberColor;
  /** Logical px; 64 by default (06 §8.1). */
  size?: number;
  /** True when the name is already written next to the avatar. */
  decorative?: boolean;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0]];
  return letters.filter(Boolean).join('').toUpperCase();
}

export function Avatar({
  name,
  avatarKey,
  color = 'member-1',
  size = 64,
  decorative,
}: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (avatarKey) {
    return (
      // A plain <img>: the avatars are static SVG files served from /brand/avatars.
      <img
        className="fw-avatar"
        src={`/brand/avatars/avatar-${avatarKey}.svg`}
        alt={decorative ? '' : name}
        width={size}
        height={size}
        style={style}
      />
    );
  }
  return (
    <span
      className="fw-avatar fw-avatar--initials"
      style={{ ...style, background: `var(--${color})` }}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      {initials(name)}
    </span>
  );
}
