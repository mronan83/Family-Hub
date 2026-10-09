// Banners (06 §7.2): stale data and offline, in tints, never red, never covering chores. A notice
// is the admin's "that didn't go through" line under a form: calm plum, an info icon, no alarm.
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './generated/icons';

export type BannerKind = 'stale' | 'offline' | 'info' | 'notice';

const BANNER_ICON: Record<BannerKind, IconName> = {
  stale: 'hourglass',
  offline: 'wifi-off',
  info: 'info',
  notice: 'info',
};

export function Banner({ kind, children }: { kind: BannerKind; children: ReactNode }) {
  return (
    <div className={`fw-banner fw-banner--${kind}`} role="status">
      <Icon name={BANNER_ICON[kind]} className="fw-banner__icon" />
      <span>{children}</span>
    </div>
  );
}
