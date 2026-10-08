// Goal meter (06 §7.2): a 28 px pill filling from teal to sun, with the count and percentage
// always written out, never color only.

export interface GoalMeterProps {
  label: string;
  value: number;
  target: number;
}

export function GoalMeter({ label, value, target }: GoalMeterProps) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  return (
    <div className="fw-meter">
      <div className="fw-meter__head">
        <span className="fw-meter__label">{label}</span>
        <span className="fw-meter__value">
          {value} of {target} · {pct}%
        </span>
      </div>
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
    </div>
  );
}
