import { Banner, Button, Fold, Icon } from '@familywise/ui';
import { type PenaltyPaybackRow, paybackLead } from '@/lib/paybacks';
import {
  money,
  owedTotal,
  type Penalty,
  type PenaltyPayment,
  type PenaltyReason,
  penaltyHistory,
} from '@/lib/penalties';
import {
  missedDays,
  type PenaltyRule,
  perMiss,
  ruleAmount,
  ruleOwing,
  monthDay,
} from '@/lib/penalty-rules';
import { ledgerDay } from '@/lib/points';
import { takeBackPenalty } from './actions';
import { GivePenaltyForm, type PenaltyPerson } from './give-form';
import { PaidForm } from './paid-form';

/** What a penalty change just did, from the address (?penalty=). */
export const PENALTY_NOTICES: Record<string, { kind: 'info' | 'notice'; text: string }> = {
  given: { kind: 'info', text: 'Penalty given. It shows on the board with its reason.' },
  paid: { kind: 'info', text: 'Payment recorded.' },
  back: { kind: 'info', text: 'Penalty taken back. The board no longer shows it.' },
  failed: { kind: 'notice', text: 'Nothing was changed. Try again in a moment.' },
};

/**
 * [PTS-09][US-1111] A member's Penalties (WP-120, the approved mockup): what they owe, each money
 * penalty with something owed and its Record paid, Give a penalty, and the history newest first with
 * Take back on each penalty not taken back (D-156). Folded to what they owe; open after a change.
 */
export function MemberPenalties({
  person,
  on,
  canGive,
  penalties,
  payments,
  reasons,
  requestId,
  adminName,
  timezone,
  today,
  notice,
  open,
  giveOpen = false,
  rules = [],
  paybacks = [],
}: {
  person: PenaltyPerson;
  /** Penalties are on for the household. */
  on: boolean;
  /** They earn rewards and aren't archived. */
  canGive: boolean;
  penalties: Penalty[];
  payments: PenaltyPayment[];
  reasons: PenaltyReason[];
  requestId: string;
  adminName: (userId: string) => string;
  timezone: string;
  today: string;
  notice: string | null;
  open: boolean;
  /** Give a penalty open (the dev page's; a parent opens it with its button). */
  giveOpen?: boolean;
  /** [PTS-10] The household's penalty rules, for what a rule's misses say (WP-121). */
  rules?: PenaltyRule[];
  /** [PTS-11] What goals paid back on their rules, for the history (WP-122). */
  paybacks?: PenaltyPaybackRow[];
}) {
  const owed = owedTotal(penalties);
  // One-time penalties still owed; a rule's misses are one line each (WP-121, the approved mockup).
  const owing = penalties.filter((p) => p.owed > 0 && !p.ruleId).reverse();
  const byRule = ruleOwing(
    penalties.map((p) => ({
      ruleId: p.ruleId ?? null,
      reason: p.reason,
      owed: p.owed,
      missedOn: p.missedOn ?? null,
      givenAt: p.givenAt,
    })),
  );
  const history = penaltyHistory(penalties, payments, paybacks);
  const back = `/admin/members/${person.id}`;
  const shown = notice ? PENALTY_NOTICES[notice] : null;
  return (
    <Fold
      id="penalties"
      title="Penalties"
      headingId="penalties-heading"
      open={open}
      summary={[owed > 0 ? `Owes ${money(owed)}` : 'Nothing owed']}
    >
      {shown ? <Banner kind={shown.kind}>{shown.text}</Banner> : null}
      <p className="fw-penalty__owes" data-owed={owed}>
        {owed > 0
          ? `${person.displayName} owes ${money(owed)}`
          : `${person.displayName} owes nothing`}
      </p>
      <p className="fw-muted">Money is paid outside FamilyWise. Record it here when it’s paid.</p>
      {owing.length > 0 || byRule.length > 0 ? (
        <ul className="fw-list" aria-label={`What ${person.displayName} owes`}>
          {owing.map((p) => (
            <li key={p.id} className="fw-penalty__owing">
              <span className="fw-penalty__head">
                <strong>{p.reason}</strong>
                <strong className="fw-penalty__amt">{money(p.owed)}</strong>
              </span>
              <span className="fw-muted">
                Given {ledgerDay(p.givenAt, timezone, today)}
                {p.givenBy ? ` by ${adminName(p.givenBy)}` : ''}
                {p.owed < p.amount
                  ? ` · ${money(p.amount - p.owed)} of ${money(p.amount)} paid`
                  : ''}
              </span>
              <PaidForm
                penaltyId={p.id}
                memberId={person.id}
                reason={p.reason}
                owed={p.owed}
                requestId={`${requestId.slice(0, 24)}${p.id.slice(24)}`}
                back={back}
              />
            </li>
          ))}
          {/* [PTS-10] A rule's misses still owed: what it adds, its max and dates, the days missed. */}
          {byRule.map((g) => {
            const rule = rules.find((r) => r.id === g.ruleId);
            return (
              <li key={g.ruleId} className="fw-penalty__owing" data-rule={g.ruleId}>
                <span className="fw-penalty__head">
                  <strong>{g.name}</strong>
                  <strong className="fw-penalty__amt">{money(g.owed)}</strong>
                </span>
                <span className="fw-muted">
                  {rule
                    ? `${perMiss(rule)} · max ${ruleAmount(rule.unit, rule.max)} · ${monthDay(rule.startDate)} to ${monthDay(rule.endDate)} · `
                    : ''}
                  missed {missedDays(g.missed, today)}
                </span>
                {/* [PTS-11] Paid back by a goal (WP-122, the approved mockup). */}
                {rule?.payback ? (
                  <span className="fw-penalty__payback" data-payback={rule.payback.goalId}>
                    <Icon name="undo" size={18} />
                    <span>
                      {paybackLead(rule.unit, rule.payback)} <strong>{rule.payback.goal}</strong>
                    </span>
                  </span>
                ) : null}
                <PaidForm
                  ruleId={g.ruleId}
                  memberId={person.id}
                  reason={g.name}
                  owed={g.owed}
                  requestId={`${requestId.slice(0, 24)}${g.ruleId.slice(24)}`}
                  back={back}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      {canGive && on ? (
        <Fold
          variant="inner"
          id="give-penalty"
          title="Give a penalty"
          headingId="give-penalty-heading"
          button={{ label: 'Give a penalty', icon: 'minus-circle' }}
          open={giveOpen}
        >
          <GivePenaltyForm
            people={[person]}
            reasons={reasons}
            requestId={requestId}
            back={back}
            fixed={person.id}
          />
        </Fold>
      ) : !on ? (
        <p className="fw-muted">
          Penalties are off. Turn them on in{' '}
          <a href="/admin/settings/penalties">Settings, Penalties</a>.
        </p>
      ) : null}
      {history.length > 0 ? (
        <>
          <h3 className="fw-penalty__sect">History</h3>
          <ul className="fw-list" aria-label={`${person.displayName}’s penalties`}>
            {history.map((e) => (
              <li key={e.key} className="fw-penalty__hrow">
                <span>
                  <strong>
                    {e.day
                      ? ledgerDay(`${e.day}T12:00:00Z`, 'UTC', today)
                      : ledgerDay(e.at, timezone, today)}
                  </strong>{' '}
                  {e.what} <span className="fw-penalty__tag">{e.tag}</span>
                  {e.by ? ` by ${adminName(e.by)}` : null}
                  {e.takeBack ? (
                    <form action={takeBackPenalty} className="fw-inline-form">
                      <input type="hidden" name="penaltyId" value={e.takeBack} />
                      <input type="hidden" name="back" value={back} />
                      <Button type="submit" variant="ghost" icon="undo">
                        Take back
                      </Button>
                    </form>
                  ) : null}
                </span>
                <strong className="fw-penalty__amt">{e.amount}</strong>
              </li>
            ))}
          </ul>
          <p className="fw-muted">
            Nothing here is edited or deleted. Take back adds an entry that gives the points back,
            or owes nothing; the board stops showing it.
          </p>
        </>
      ) : null}
    </Fold>
  );
}
