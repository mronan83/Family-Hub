import { DAY_TYPES, type DayType } from '@/lib/chores';
import { calendarDay } from '@/lib/chores';
import { countDayTypes, DAY_TYPE_NAMES, monthGrid, weekdayHeadings, type Day } from '@/lib/school';

/**
 * [SCH-01] A school year as month grids, each day shaded by its type (US-601: breaks and days off
 * on a timeline). Shading is never the only signal: the legend names each shade, every day has its
 * date and type as a tooltip, and the counts and the list of days off say the same in words.
 */
export function Timeline({
  days,
  weekStart,
  today,
  closureNames,
}: {
  days: Day[];
  weekStart: number;
  today: string;
  /** Closure name for each date that has one. */
  closureNames: Map<string, string>;
}) {
  const months = monthGrid(days, weekStart);
  const counts = countDayTypes(days);
  const headings = weekdayHeadings(weekStart);
  const shown = DAY_TYPES.filter((t) => counts[t] > 0);
  return (
    <div className="fw-timeline">
      <p className="fw-muted" data-testid="day-counts">
        {shown.map((t) => `${counts[t]} ${countLabel(t, counts[t])}`).join(' · ')}
      </p>
      <ul className="fw-legend" aria-label="Key">
        {shown.map((t) => (
          <li key={t}>
            <span className={`fw-cal__swatch fw-cal--${t}`} aria-hidden />
            {DAY_TYPE_NAMES[t]}
          </li>
        ))}
      </ul>
      <div className="fw-cal" aria-hidden>
        {months.map((m) => (
          <div key={m.label} className="fw-cal__month">
            <div className="fw-cal__label">{m.label}</div>
            <div className="fw-cal__grid">
              {headings.map((h) => (
                <span key={h} className="fw-cal__head">
                  {h[0]}
                </span>
              ))}
              {m.weeks.flat().map((d, i) =>
                d ? (
                  <span
                    key={d.day}
                    className={`fw-cal__day fw-cal--${d.dayType}${d.day === today ? ' fw-cal__day--today' : ''}`}
                    title={`${calendarDay(d.day)}: ${closureNames.get(d.day) ?? DAY_TYPE_NAMES[d.dayType]}`}
                  >
                    {Number(d.day.slice(8))}
                  </span>
                ) : (
                  <span key={`pad-${i}`} />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function countLabel(t: DayType, n: number): string {
  const one: Record<DayType, string> = {
    school_day: 'school day',
    no_school: 'day off school',
    break: 'break day',
    weekend: 'weekend day',
    summer: 'summer day',
  };
  const many: Record<DayType, string> = {
    school_day: 'school days',
    no_school: 'days off school',
    break: 'break days',
    weekend: 'weekend days',
    summer: 'summer days',
  };
  return n === 1 ? one[t] : many[t];
}
