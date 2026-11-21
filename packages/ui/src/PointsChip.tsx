// Points chip (06 §7.2): a Sun pill with a star; a negative balance is a calm Plum tint with
// "to earn back", never red.
import { Icon } from './Icon';

export interface PointsChipProps {
  points: number;
  /** Show a sign, as on a tile ("+5"), rather than a balance ("120"). */
  signed?: boolean;
  size?: 'board' | 'admin';
  /**
   * [PTS-09] A narrow place (the board's rail): a negative balance as "−8" in the same calm tint,
   * without "to earn back", which the person's own screen says (WP-120).
   */
  compact?: boolean;
}

export function PointsChip({ points, signed, size = 'board', compact = false }: PointsChipProps) {
  const negative = points < 0;
  const value = Math.abs(points).toLocaleString('en-US');
  const text = negative
    ? compact
      ? `−${value}`
      : `−${value} to earn back`
    : signed
      ? `+${value}`
      : value;
  return (
    <span className={`fw-points${negative ? ' fw-points--negative' : ''}`} data-size={size}>
      <Icon name="star" size={size === 'board' ? 36 : 20} />
      <span className="fw-points__value">{text}</span>
      {negative ? null : <span className="fw-visually-hidden"> points</span>}
    </span>
  );
}
