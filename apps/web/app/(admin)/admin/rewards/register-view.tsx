import { Avatar, type AvatarKey, dateWords, Fold, Icon, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import { describeBonus, type BonusRule } from '@/lib/bonus';
import { time } from '@/lib/format';
import { signed } from '@/lib/points';
import {
  byDay,
  entryCount,
  entryWords,
  KIND_LABEL,
  type MemberTotal,
  moreLine,
  type RegisterEntry,
  type RegisterFilters,
  REGISTER_KINDS,
  REGISTER_PATH,
  registerHref,
  shownLine,
  toggleType,
  toggleWho,
  totalLine,
} from '@/lib/points-register';
import { Line } from '../fold-line';
import { AdminHeader } from '../header';
import { RegisterDates } from './register-dates';

export interface RegisterMember {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

export interface RegisterViewProps {
  filters: RegisterFilters;
  entries: RegisterEntry[];
  totals: MemberTotal[];
  /** Everyone whose chip shows: who earns rewards, and anyone with entries. */
  chips: RegisterMember[];
  /** Every member, for a name and a face on each entry. */
  members: RegisterMember[];
  /** Every bonus rule, archived ones included, for the bonus filter's words. */
  rules: Pick<BonusRule, 'id' | 'ruleType' | 'streakDays' | 'bonusPoints'>[];
  adminName: (userId: string) => string;
  timezone: string;
  /** The household's date (YYYY-MM-DD). */
  today: string;
  /** More filters open: a type, a date or a bonus is chosen. */
  moreOpen: boolean;
  /** The register's own address (the dev page's for the UI suite). */
  base?: string;
}

/**
 * [PTS-08] The household points register (WP-115, D-147), as the approved mockup draws it: the
 * filters (a child's chip, a bonus, and under More filters the type and the dates), then every entry
 * newest first under day headings, each with the child, the time, what it was for, its type, who or
 * what issued it and the amount; Show older adds the next 50 below.
 */
export function RegisterView({
  filters: f,
  entries,
  totals,
  chips,
  members,
  rules,
  adminName,
  timezone,
  today,
  moreOpen,
  base = REGISTER_PATH,
}: RegisterViewProps) {
  const href = (g: Partial<RegisterFilters>) => registerHref(g, base);
  const member = (id: string) => members.find((m) => m.id === id);
  const name = (id: string) => member(id)?.displayName ?? 'Someone';
  const rule = f.rule ? rules.find((r) => r.id === f.rule) : undefined;
  const count = entryCount(totals);
  const filtered = f.who.length > 0 || f.types.length > 0 || !!f.rule || !!f.from || !!f.to;
  const keep: Record<string, string> = {};
  if (f.who.length) keep.who = f.who.join(',');
  if (f.types.length) keep.type = f.types.join(',');
  if (f.rule) keep.rule = f.rule;

  const row = (e: RegisterEntry) => {
    const who = member(e.memberId);
    const { what, by } = entryWords(e, adminName);
    return (
      <li key={e.id} id={`e-${e.id}`} className="fw-row fw-ledger">
        <span className="fw-row__icon">
          {who ? (
            <Avatar
              name={who.displayName}
              avatarKey={who.avatarKey}
              color={who.color}
              size={32}
              decorative
            />
          ) : (
            <Icon name="person" size={28} />
          )}
        </span>
        <span className="fw-row__l1">
          {e.kind === 'bonus' && e.ruleId ? (
            <Link className="fw-row__name" href={href({ rule: e.ruleId })}>
              {what}
            </Link>
          ) : (
            <span className="fw-row__name">{what}</span>
          )}
        </span>
        <span className={`fw-ledger__amt${e.amount < 0 ? ' fw-ledger__amt--neg' : ''}`}>
          {signed(e.amount)}
        </span>
        <span className="fw-row__l2">
          <span className="fw-kind">{KIND_LABEL[e.kind]}</span> {name(e.memberId)} ·{' '}
          {time(e.at, timezone)}
          {e.kind === 'goal' && e.goalId ? (
            <>
              {' · goal '}
              <Link href={`/admin/goals/${e.goalId}`}>{e.goalTitle ?? e.reason ?? 'a goal'}</Link>
            </>
          ) : by ? (
            ` · ${by}`
          ) : null}
        </span>
      </li>
    );
  };

  const last = entries.at(-1);
  return (
    <main className="fw-page fw-page--wide">
      <AdminHeader current="/admin/rewards" />
      <Link className="fw-crumb" href="/admin/rewards">
        <Icon name="chevron-left" size={18} />
        Rewards
      </Link>
      <section className="fw-card fw-register" aria-labelledby="register-heading">
        <h1 id="register-heading">Points register</h1>
        <p className="fw-muted">
          Every points change for every child, newest first. Nothing here is ever edited or deleted.
        </p>
        <div className="fw-chips" role="group" aria-label="Whose">
          {chips.map((m) => {
            const on = f.who.includes(m.id);
            return (
              <Link
                key={m.id}
                className="fw-chip"
                role="button"
                aria-pressed={on}
                href={href(toggleWho(f, m.id))}
              >
                <Avatar
                  name={m.displayName}
                  avatarKey={m.avatarKey}
                  color={m.color}
                  size={30}
                  decorative
                />
                {m.displayName}
                <span className="fw-chip__tick">
                  <Icon name="check" size={16} />
                </span>
              </Link>
            );
          })}
          {f.who.length ? (
            <Link className="fw-chips__clear" href={href({ ...f, who: [], older: 0 })}>
              Clear
            </Link>
          ) : null}
        </div>
        {f.rule ? (
          <div className="fw-chips" role="group" aria-label="Bonus">
            <Link
              className="fw-chip"
              role="button"
              aria-pressed="true"
              aria-label={`Bonus: ${rule ? describeBonus(rule) : 'a bonus'}. Show every bonus`}
              href={href({ ...f, rule: null, older: 0 })}
            >
              <span className="fw-reward__icon fw-register__ruleicon">
                <Icon name={rule?.ruleType === 'streak_bonus' ? 'flame' : 'sparkles'} size={18} />
              </span>
              Bonus: {rule ? describeBonus(rule) : 'a bonus no longer here'}
              <Icon name="close" size={16} />
            </Link>
          </div>
        ) : null}
        <Fold
          variant="inner"
          id="more-filters"
          title="More filters"
          open={moreOpen}
          summary={[<Line key="m" line={moreLine(f, dateWords)} />]}
        >
          <div className="fw-field" role="group" aria-label="Type">
            <span className="fw-field__label">Type</span>
            <div className="fw-chips">
              {REGISTER_KINDS.map(({ kind, label }) => (
                <Link
                  key={kind}
                  className="fw-chip"
                  role="button"
                  aria-pressed={f.types.includes(kind)}
                  href={`${href(toggleType(f, kind))}#more-filters`}
                >
                  {label}
                  <span className="fw-chip__tick">
                    <Icon name="check" size={16} />
                  </span>
                </Link>
              ))}
              {f.types.length ? (
                <Link
                  className="fw-chips__clear"
                  href={`${href({ ...f, types: [], older: 0 })}#more-filters`}
                >
                  Clear
                </Link>
              ) : null}
            </div>
          </div>
          <RegisterDates
            key={`${f.from}:${f.to}`}
            from={f.from}
            to={f.to}
            keep={keep}
            action={base}
          />
          {f.from || f.to ? (
            <Link
              className="fw-chips__clear"
              href={`${href({ ...f, from: null, to: null, older: 0 })}#more-filters`}
            >
              Any day
            </Link>
          ) : null}
        </Fold>
      </section>

      <section className="fw-card fw-register" aria-label="Entries">
        <p className="fw-register__total">
          <Line line={totalLine(totals, { rule: !!f.rule, name, timeZone: timezone, today })} />
        </p>
        {entries.length === 0 ? (
          <p className="fw-empty">
            {filtered
              ? 'Nothing with these filters.'
              : 'No points yet. They arrive as the children check off chores.'}
          </p>
        ) : (
          byDay(entries, timezone, today).map((g) => (
            <div key={g.day}>
              <p className="fw-dh">
                {g.heading} <span className="fw-dh__n">· {g.entries.length}</span>
              </p>
              <ul className="fw-rows" aria-label={g.heading}>
                {g.entries.map(row)}
              </ul>
            </div>
          ))
        )}
        {last && entries.length < count ? (
          <div className="fw-older">
            <span className="fw-muted">{shownLine(entries.length, count)}</span>
            <Link
              className="fw-btn fw-btn--secondary"
              href={`${href({ ...f, older: f.older + 1 })}#e-${last.id}`}
            >
              Show older
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
