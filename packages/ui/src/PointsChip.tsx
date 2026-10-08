// Points chip (06 §7.2): a Sun pill with a star; a negative balance is a calm Plum tint with
// "to earn back", never red.
import { Icon } from './Icon';

export interface PointsChipProps {
  points: number;
  /** Show a sign, as on a tile ("+5"), rather than a balance ("120"). */
  signed?: boolean;
  size?: 'board' | 'admin';
}

export function PointsChip({ points, signed, size = 'board' }: PointsChipProps) {
  const negative = points < 0;
  const value = Math.abs(points).toLocaleString('en-US');
  const text = negative ? `−${value} to earn back` : signed ? `+${value}` : value;
  return (
    <span className={`fw-points${negative ? ' fw-points--negative' : ''}`} data-size={size}>
      <Icon name="star" size={size === 'board' ? 36 : 20} />
      <span className="fw-points__value">{text}</span>
      {negative ? null : <span className="fw-visually-hidden"> points</span>}
    </span>
  );
}
