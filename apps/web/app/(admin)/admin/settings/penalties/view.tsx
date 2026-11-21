import { Banner, Button } from '@familywise/ui';
import Link from 'next/link';
import { penaltyAmount, type PenaltyReason } from '@/lib/penalties';
import { type PenaltyRule, ruleLine, ruleStatus, stoppedWords } from '@/lib/penalty-rules';
import { AdminHeader } from '../../header';
import type { NavWho } from '../../nav';
import { removeReason, setPenaltiesOn } from '../../penalties/actions';
import { AddReasonForm } from './reason-form';

export const PENALTY_SETTINGS_NOTICES: Record<string, { kind: 'info' | 'notice'; text: string }> = {
  on: { kind: 'info', text: 'Penalties are on. Give one from Home or a child’s page.' },
  off: { kind: 'info', text: 'Penalties are off. The history stays.' },
  added: { kind: 'info', text: 'Reason added.' },
  removed: { kind: 'info', text: 'Reason removed. Penalties given with it keep it.' },
  'rule-added': {
    kind: 'info',
    text: 'Rule added. Each miss adds to what’s owed when the day closes.',
  },
  'rule-saved': { kind: 'info', text: 'Rule saved. It counts from the next day close.' },
  'rule-stopped': {
    kind: 'info',
    text: 'Rule stopped. It adds nothing more; what it added stays until it’s paid or taken back.',
  },
  'rule-removed': { kind: 'info', text: 'Rule removed.' },
  'rule-used': {
    kind: 'notice',
    text: 'That rule has added misses, so it can’t be removed. Stop it instead.',
  },
  failed: { kind: 'notice', text: 'That didn’t save. Try again in a moment.' },
};

/**
 * [PTS-09][US-1111] Settings, Penalties (WP-120, the approved mockup): the household's on/off (off for
 * a new family) and its penalty reasons, each with its amount in points or money, added and removed.
 * [PTS-10][US-1112] And its penalty rules (WP-121): each with who, what counts, the amount per miss,
 * the max and the dates, and what it has on each person; Edit, and Add a rule.
 */
export function PenaltySettingsView({
  on,
  reasons,
  notice,
  waiting,
  who,
  rules = [],
  names = {},
  timezone = 'UTC',
}: {
  on: boolean;
  reasons: PenaltyReason[];
  /** [PTS-10] The household's penalty rules (WP-121). */
  rules?: PenaltyRule[];
  /** Display names by member id. */
  names?: Record<string, string>;
  /** The household's time zone, for when a rule was stopped. */
  timezone?: string;
  notice?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const n = notice ? PENALTY_SETTINGS_NOTICES[notice] : undefined;
  const name = (id: string) => names[id] ?? 'Someone';
  const usedBy = (reasonId: string) => {
    const k = rules.filter((r) => r.reasonId === reasonId).length;
    return k === 0 ? '' : `${k} ${k === 1 ? 'rule' : 'rules'}`;
  };
  return (
    <main className="fw-page">
      <AdminHeader current="/admin/settings/penalties" waiting={waiting} who={who} />
      {n ? <Banner kind={n.kind}>{n.text}</Banner> : null}
      <header className="fw-settings__head">
        <h1>Penalties</h1>
        <p className="fw-muted">
          Consequences the family agreed on, in points or money, each with a reason everyone can see
          on the board.
        </p>
      </header>

      <section className="fw-card" aria-labelledby="penalties-on-heading">
        <form action={setPenaltiesOn} className="fw-penalty__switch">
          <input type="hidden" name="on" value={on ? 'false' : 'true'} />
          <h2 id="penalties-on-heading">Penalties are {on ? 'on' : 'off'}</h2>
          <button
            type="submit"
            role="switch"
            aria-checked={on}
            aria-label="Penalties"
            className="fw-switch"
          >
            <span className="fw-switch__knob" />
          </button>
        </form>
        <p className="fw-muted">
          Parents can give a penalty to anyone who earns rewards. Turning this off hides Give a
          penalty and what’s owed on the board; the history stays. Off for a new family.
        </p>
      </section>

      <section className="fw-card" id="reasons" aria-labelledby="reasons-heading">
        <h2 id="reasons-heading">Penalty reasons</h2>
        <p className="fw-muted">
          What you pick from when you give a penalty. The amount fills in and can be changed each
          time. Removing a reason keeps the penalties already given.
        </p>
        {reasons.length === 0 ? (
          <p className="fw-muted">No reasons yet. Add the first one below.</p>
        ) : (
          <ul className="fw-list" aria-label="Penalty reasons">
            {reasons.map((r) => (
              <li key={r.id} className="fw-list__row">
                <span className="fw-item__body">
                  <strong>{r.name}</strong>
                  <span className="fw-muted">
                    {penaltyAmount(r.unit, r.amount)}
                    {usedBy(r.id) ? ` · used by ${usedBy(r.id)}` : ''}
                  </span>
                </span>
                <form action={removeReason}>
                  <input type="hidden" name="reasonId" value={r.id} />
                  <Button type="submit" variant="ghost" aria-label={`Remove ${r.name}`}>
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <AddReasonForm />
      </section>

      {/* [PTS-10][US-1112] Penalty rules (WP-121, the approved mockup). */}
      <section className="fw-card" id="rules" aria-labelledby="rules-heading">
        <h2 id="rules-heading">Penalty rules</h2>
        <p className="fw-muted">
          A rule adds to what someone owes each time a linked item is missed, between its dates and
          up to its max.
        </p>
        {rules.length === 0 ? (
          <p className="fw-muted">No rules yet.</p>
        ) : (
          <ul className="fw-list" aria-label="Penalty rules">
            {rules.map((r) => (
              <li key={r.id} className="fw-list__row" data-rule={r.id}>
                <span className="fw-item__body">
                  <strong>{r.name}</strong>
                  <span className="fw-muted">{ruleLine(r, name)}</span>
                  <span className="fw-penalty__status">
                    {r.stoppedAt ? `${stoppedWords(r.stoppedAt, timezone)} · ` : ''}
                    {ruleStatus(r, name)}
                  </span>
                </span>
                <Link
                  href={`/admin/settings/penalties/rules/${r.id}`}
                  aria-label={`Edit ${r.name}`}
                >
                  Edit
                </Link>
              </li>
            ))}
          </ul>
        )}
        {on ? (
          <div className="fw-actions">
            <Link className="fw-btn fw-btn--secondary" href="/admin/settings/penalties/rules/new">
              Add a rule
            </Link>
          </div>
        ) : (
          <p className="fw-muted">Turn penalties on to add a rule.</p>
        )}
      </section>
    </main>
  );
}
