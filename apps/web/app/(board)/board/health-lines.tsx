import { Icon } from '@familywise/ui';

/**
 * [DEV-08][US-205][US-206] The board's quiet lines about itself (06 §2, §7.2): offline, its
 * check-offs saved (wifi-off, plum); or what it shows is old (hourglass, sun). In the bar, never
 * over chores. Not a live region: the connection's status is the page's one.
 */
export function HealthLines({ offline, stale }: { offline: string | null; stale: string | null }) {
  if (!offline && !stale) return null;
  return (
    <div className="fw-board__health">
      {offline ? (
        <p className="fw-banner fw-banner--offline" data-health="offline">
          <Icon name="wifi-off" className="fw-banner__icon" />
          <span>{offline}</span>
        </p>
      ) : null}
      {stale ? (
        <p className="fw-banner fw-banner--stale" data-health="stale">
          <Icon name="hourglass" className="fw-banner__icon" />
          <span>{stale}</span>
        </p>
      ) : null}
    </div>
  );
}
