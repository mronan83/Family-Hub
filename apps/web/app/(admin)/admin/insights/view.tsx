import { Banner, Button, Icon, type IconName } from '@familywise/ui';
import Link from 'next/link';
import { day } from '@/lib/format';
import { daysWord, duration, heatmapWeeks, type Insights, percent } from '@/lib/history';

export const RANGES = [7, 30, 90] as const;
export type Range = (typeof RANGES)[number];

const CLASS_WORDS = {
  good: { label: 'Good day', icon: 'check' },
  bad: { label: 'Bad day', icon: 'close' },
  open: { label: 'Waiting for a parent', icon: 'hourglass' },
  neutral: { label: 'Nothing that counted', icon: null },
} as const satisfies Record<string, { label: string; icon: IconName | null }>;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Wed, Oct 7" for a household-local date. */
const dateLabel = (iso: string) => day(`${iso}T12:00:00Z`, 'UTC');

/**
 * [RWD-12][US-408] A parent's insights for one member (WP-17, D-55): their runs of good and bad days,
 * how much of what counted they did, a day heatmap, what they miss most, completion by tag, and how
 * often a parent unchecks or sends back their check-offs, to inform the approval switch. Parent
 * words: "bad" is allowed here (06 §2), never on the board.
 */
export function InsightsView({
  members,
  memberId,
  range,
  insights,
  weekStart,
  notice,
  basePath,
  rebuild,
}: {
  members: { id: string; name: string }[];
  memberId: string;
  range: Range;
  insights: Insights;
  weekStart: number;
  notice: string | null;
  basePath: string;
  rebuild?: (form: FormData) => Promise<void>;
}) {
  const name = members.find((m) => m.id === memberId)?.name ?? 'This member';
  const href = (member: string, days: Range) => `${basePath}?member=${member}&days=${days}`;
  const s = insights.streaks;
  const t = insights.trust;
  const judged = t.approved + t.sent_back;
  const weeks = heatmapWeeks(insights.days, insights.from, insights.to, weekStart);
  const order = [...WEEKDAYS.slice(weekStart), ...WEEKDAYS.slice(0, weekStart)];

  return (
    <>
      <section className="fw-card" aria-labelledby="insights-heading">
        <h1 id="insights-heading">Insights</h1>
        <nav aria-label="Member" className="fw-insights__tabs">
          {members.map((m) => (
            <Link
              key={m.id}
              href={href(m.id, range)}
              className="fw-insights__tab"
              aria-current={m.id === memberId ? 'page' : undefined}
            >
              {m.name}
            </Link>
          ))}
        </nav>
        <nav aria-label="Range" className="fw-insights__tabs">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={href(memberId, r)}
              className="fw-insights__tab"
              aria-current={r === range ? 'page' : undefined}
            >
              Last {r} days
            </Link>
          ))}
        </nav>
        <p className="fw-muted">
          {s.through
            ? `${name}’s days from ${dateLabel(insights.from)} to ${dateLabel(insights.to)}. Today is added once it closes.`
            : `${name} has no days to show yet: history starts with their first routine.`}
        </p>
        {notice ? <Banner kind="notice">{notice}</Banner> : null}
      </section>

      <section className="fw-card" aria-labelledby="streaks-heading">
        <h2 id="streaks-heading">Streaks</h2>
        <dl className="fw-insights__stats">
          <div>
            <dt>Good run now</dt>
            <dd>
              {s.current_kind === 'good' ? daysWord(s.current_length) : '0 days'}
              {s.current_kind === 'bad' ? (
                <span className="fw-muted"> (bad streak of {daysWord(s.current_length)})</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>Best good run</dt>
            <dd>{daysWord(s.best_good)}</dd>
          </div>
          <div>
            <dt>Longest bad streak</dt>
            <dd>{daysWord(s.longest_bad)}</dd>
          </div>
        </dl>
        <p className="fw-muted">
          Over all of {name}’s history. A day with nothing that counted, or one still waiting for a
          parent, neither adds to a run nor breaks it.
        </p>
      </section>

      <section className="fw-card" aria-labelledby="rate-heading">
        <h2 id="rate-heading">Done</h2>
        <p className="fw-insights__big">
          {percent(insights.rate.done, insights.rate.counted)}
          <span className="fw-muted">
            {' '}
            {insights.rate.done} of {insights.rate.counted} routines that counted
          </span>
        </p>
        <Meter done={insights.rate.done} counted={insights.rate.counted} />
        <p className="fw-muted">Skipped routines, and ones someone else did, don’t count.</p>
      </section>

      <section className="fw-card" aria-labelledby="heat-heading">
        <h2 id="heat-heading">Day by day</h2>
        <div className="fw-insights__heat-wrap">
          <table className="fw-heat" aria-labelledby="heat-heading">
            <thead>
              <tr>
                {order.map((d) => (
                  <th key={d} scope="col">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week, i) => (
                <tr key={i}>
                  {week.map((cell, j) => {
                    if (!cell) return <td key={j} className="fw-heat__cell" data-class="none" />;
                    const cls = 'empty' in cell ? 'neutral' : cell.class;
                    const words = CLASS_WORDS[cls];
                    const detail =
                      'empty' in cell
                        ? 'no routines'
                        : `${cell.done} done of ${cell.scheduled}${cell.missed ? `, ${cell.missed} missed` : ''}`;
                    return (
                      <td
                        key={j}
                        className="fw-heat__cell"
                        data-class={cls}
                        title={`${dateLabel(cell.date)}: ${words.label}, ${detail}`}
                      >
                        {words.icon ? <Icon name={words.icon} size={16} /> : null}
                        <span className="fw-visually-hidden">
                          {dateLabel(cell.date)}: {words.label}, {detail}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="fw-insights__legend" aria-label="Key">
          {(['good', 'bad', 'open', 'neutral'] as const).map((c) => (
            <li key={c}>
              <span className="fw-heat__cell" data-class={c} aria-hidden="true">
                {CLASS_WORDS[c].icon ? <Icon name={CLASS_WORDS[c].icon} size={16} /> : null}
              </span>
              {CLASS_WORDS[c].label}
            </li>
          ))}
        </ul>
      </section>

      <section className="fw-card" aria-labelledby="missed-heading">
        <h2 id="missed-heading">Missed most</h2>
        {insights.most_missed.length === 0 ? (
          <p className="fw-muted">Nothing missed in these days.</p>
        ) : (
          <ul className="fw-list" aria-labelledby="missed-heading">
            {insights.most_missed.map((m) => (
              <li key={m.chore_id} className="fw-list__row">
                <strong>{m.title}</strong>
                <span className="fw-muted">
                  missed {m.missed === 1 ? 'once' : `${m.missed} times`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="tags-heading">
        <h2 id="tags-heading">By tag</h2>
        {insights.by_tag.length === 0 ? (
          <p className="fw-muted">No tagged routines in these days.</p>
        ) : (
          <ul className="fw-list" aria-labelledby="tags-heading">
            {insights.by_tag.map((g) => (
              <li key={g.tag_id} className="fw-list__row fw-insights__tag">
                <span>
                  <strong>{g.name}</strong>
                  <span className="fw-muted">
                    {' '}
                    {percent(g.done, g.counted)} · {g.done} of {g.counted}
                  </span>
                </span>
                <Meter done={g.done} counted={g.counted} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="fw-card" aria-labelledby="trust-heading">
        <h2 id="trust-heading">Checking</h2>
        <dl className="fw-insights__stats">
          <div>
            <dt>Check-offs</dt>
            <dd>{t.checkoffs}</dd>
          </div>
          <div>
            <dt>Unchecked by a parent</dt>
            <dd>
              {t.unchecked} <span className="fw-muted">({percent(t.unchecked, t.checkoffs)})</span>
            </dd>
          </div>
          <div>
            <dt>Sent back</dt>
            <dd>
              {t.sent_back} of {judged}{' '}
              <span className="fw-muted">({percent(t.sent_back, judged)})</span>
            </dd>
          </div>
          <div>
            <dt>Time to check</dt>
            <dd>{duration(t.median_verify_seconds)}</dd>
          </div>
        </dl>
        <p className="fw-muted">
          {name}’s own check-offs in these days, and what a parent did next. Few unchecked or sent
          back suggests check-offs can count straight away; many suggests they should wait for a
          parent (the switch is on Home).
        </p>
      </section>

      {rebuild ? (
        <section className="fw-card" aria-labelledby="rebuild-heading">
          <h2 id="rebuild-heading">History</h2>
          <p className="fw-muted">
            Kept up to date each hour from every check-off. Rebuilding reads it all again; the same
            check-offs always give the same history.
          </p>
          <form action={rebuild}>
            <input type="hidden" name="memberId" value={memberId} />
            <input type="hidden" name="days" value={range} />
            <Button type="submit" variant="secondary" icon="sync">
              Rebuild from history
            </Button>
          </form>
        </section>
      ) : null}
    </>
  );
}

function Meter({ done, counted }: { done: number; counted: number }) {
  const pct = counted === 0 ? 0 : Math.round((done / counted) * 100);
  return (
    <span className="fw-insights__meter" aria-hidden="true">
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}
