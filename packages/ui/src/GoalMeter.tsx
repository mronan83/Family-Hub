// Goal meter (06 §7.2): a 28 px pill filling from teal to sun, with the count and percentage
// always written out, never color only.

export interface GoalMeterProps {
  label: string;
  value: number;
  target: number;
  /**
   * [NFR-16][D-127] The words under the bar instead of over it, as the approved goal mockups draw a
   * period's days ("3 of 4 days" on the left, "10 points" on the right). The bar keeps `label`.
   */
  foot?: { start: string; end?: string | null };
}

export function GoalMeter({ label, value, target, foot }: GoalMeterProps) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  return (
    <div className="fw-meter">
      {foot ? null : (
        <div className="fw-meter__head">
          <span className="fw-meter__label">{label}</span>
          <span className="fw-meter__value">
            {value} of {target} · {pct}%
          </span>
        </div>
      )}
      <div
        className="fw-meter__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${value} of ${target}, ${pct}%`}
      >
        <div className="fw-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      {foot ? (
        <div className="fw-meter__foot">
          <span>{foot.start}</span>
          {foot.end ? <span>{foot.end}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
