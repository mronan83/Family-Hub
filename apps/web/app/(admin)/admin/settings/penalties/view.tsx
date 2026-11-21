import { Banner, Button } from '@familywise/ui';
import { penaltyAmount, type PenaltyReason } from '@/lib/penalties';
import { AdminHeader } from '../../header';
import type { NavWho } from '../../nav';
import { removeReason, setPenaltiesOn } from '../../penalties/actions';
import { AddReasonForm } from './reason-form';

export const PENALTY_SETTINGS_NOTICES: Record<string, { kind: 'info' | 'notice'; text: string }> = {
  on: { kind: 'info', text: 'Penalties are on. Give one from Home or a child’s page.' },
  off: { kind: 'info', text: 'Penalties are off. The history stays.' },
  added: { kind: 'info', text: 'Reason added.' },
  removed: { kind: 'info', text: 'Reason removed. Penalties given with it keep it.' },
  failed: { kind: 'notice', text: 'That didn’t save. Try again in a moment.' },
};

/**
 * [PTS-09][US-1111] Settings, Penalties (WP-120, the approved mockup): the household's on/off (off for
 * a new family) and its penalty reasons, each with its amount in points or money, added and removed.
 * WP-121's penalty rules join this page later.
 */
export function PenaltySettingsView({
  on,
  reasons,
  notice,
  waiting,
  who,
}: {
  on: boolean;
  reasons: PenaltyReason[];
  notice?: string | null;
  waiting?: number;
  who?: NavWho | null;
}) {
  const n = notice ? PENALTY_SETTINGS_NOTICES[notice] : undefined;
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
                  <span className="fw-muted">{penaltyAmount(r.unit, r.amount)}</span>
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
    </main>
  );
}
