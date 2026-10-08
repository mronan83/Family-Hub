// The 85-icon set (06 §8): 24 px grid, 2 px round stroke, currentColor. Bodies are generated from
// brand/icons and checked to contain only drawing elements, so inlining them is safe.
import { ICONS, type IconName } from './generated/icons';

export interface IconProps {
  name: IconName;
  /** Logical px: board 56 / 36 / 28, admin 24 / 20 (06 §8). */
  size?: number;
  /** Accessible name for an icon that stands alone; omit when a visible word sits next to it. */
  label?: string;
  className?: string;
}

/** Screen-reader name from the icon's index name (06 §10), e.g. `wifi-off` → "wifi off". */
export function iconLabel(name: IconName): string {
  return name.replace(/^chore-/, '').replace(/-/g, ' ');
}

export function Icon({ name, size = 24, label, className }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <svg
      className={className ? `fw-icon ${className}` : 'fw-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      data-icon={name}
      {...a11y}
      dangerouslySetInnerHTML={{ __html: ICONS[name].body }}
    />
  );
}
