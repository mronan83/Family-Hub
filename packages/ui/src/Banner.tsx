// Banners (06 §7.2): stale data and offline, in tints, never red, never covering chores.
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './generated/icons';

export type BannerKind = 'stale' | 'offline' | 'info';

const BANNER_ICON: Record<BannerKind, IconName> = {
  stale: 'hourglass',
  offline: 'wifi-off',
  info: 'info',
};

export function Banner({ kind, children }: { kind: BannerKind; children: ReactNode }) {
  return (
    <div className={`fw-banner fw-banner--${kind}`} role="status">
      <Icon name={BANNER_ICON[kind]} className="fw-banner__icon" />
      <span>{children}</span>
    </div>
  );
}
