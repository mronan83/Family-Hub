// The FamilyWise lockups (06 §3): color on Day surfaces, reversed on Evening. Both are rendered and
// the nearest theme shows one, so the logo follows the page theme and .theme-day/.theme-evening.

const RATIO = { horizontal: 320 / 72, stacked: 222 / 160 } as const;

export interface LogoProps {
  lockup?: 'horizontal' | 'stacked';
  /** Rendered width in px; minimums are 112 (horizontal) and 72 (stacked) (06 §3.3). */
  width?: number;
}

export function Logo({
  lockup = 'horizontal',
  width = lockup === 'horizontal' ? 224 : 160,
}: LogoProps) {
  const height = Math.round(width / RATIO[lockup]);
  const src = (variant: 'color' | 'reversed') => `/brand/logo/familywise-${lockup}-${variant}.svg`;
  return (
    <span className="fw-logo">
      {/* Plain <img>: static SVG lockups served from /brand/logo. */}
      <img
        className="fw-logo__day"
        src={src('color')}
        alt="FamilyWise"
        width={width}
        height={height}
      />
      <img
        className="fw-logo__evening"
        src={src('reversed')}
        alt="FamilyWise"
        width={width}
        height={height}
      />
    </span>
  );
}
