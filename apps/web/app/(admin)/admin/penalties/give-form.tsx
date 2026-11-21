'use client';

import { Avatar, type AvatarKey, Banner, Button, type MemberColor } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { amountInput, penaltyAmount, type PenaltyReason } from '@/lib/penalties';
import { boardActivity } from '@/lib/today';
import { givePenalty } from './actions';

export interface PenaltyPerson {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

/**
 * [PTS-09][US-1111] Give a penalty (WP-120, the approved mockup): who (on Home; a member's page has
 * one), a reason from the household's list, and its amount, filled in from the reason and changeable,
 * in the reason's points or money. It says what the board will show. The request id comes from the
 * page, so a double tap gives it once.
 */
export function GivePenaltyForm({
  people,
  reasons,
  requestId,
  back,
  fixed = null,
}: {
  /** Who can get one: members who earn rewards. */
  people: PenaltyPerson[];
  reasons: PenaltyReason[];
  requestId: string;
  /** The page to come back to. */
  back: string;
  /** On a member's page, the member it is for. */
  fixed?: string | null;
}) {
  const [state, onSubmit, pending] = useFormAction(givePenalty, {} as FormState);
  const [who, setWho] = useState<string | null>(
    fixed ?? (people.length === 1 ? people[0]!.id : null),
  );
  const [reasonId, setReasonId] = useState<string | null>(reasons[0]?.id ?? null);
  const reason = reasons.find((r) => r.id === reasonId) ?? null;
  const [amount, setAmount] = useState(reason ? amountInput(reason.unit, reason.amount) : '');
  const person = people.find((p) => p.id === who) ?? null;

  if (reasons.length === 0) {
    return (
      <p className="fw-muted">
        No penalty reasons yet. Add them in{' '}
        <a href="/admin/settings/penalties">Settings, Penalties</a>.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Give a penalty">
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="back" value={back} />
      {fixed ? (
        <input type="hidden" name="memberId" value={fixed} />
      ) : (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Who</legend>
          <div className="fw-seg">
            {people.map((p) => (
              <label key={p.id} className="fw-seg__item fw-penalty__who">
                <input
                  className="fw-seg__input"
                  type="radio"
                  name="memberId"
                  value={p.id}
                  checked={who === p.id}
                  onChange={() => setWho(p.id)}
                />
                <Avatar
                  name={p.displayName}
                  avatarKey={p.avatarKey}
                  color={p.color}
                  size={28}
                  decorative
                />
                {p.displayName}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Reason</legend>
        <div className="fw-seg">
          {reasons.map((r) => (
            <label key={r.id} className="fw-seg__item fw-penalty__reason">
              <input
                className="fw-seg__input"
                type="radio"
                name="reasonId"
                value={r.id}
                checked={reasonId === r.id}
                onChange={() => {
                  setReasonId(r.id);
                  setAmount(amountInput(r.unit, r.amount));
                }}
              />
              <span>
                {r.name}
                <small>{penaltyAmount(r.unit, r.amount)}</small>
              </span>
            </label>
          ))}
        </div>
        <span className="fw-field__help">
          The household’s penalty reasons. <a href="/admin/settings/penalties">Edit reasons</a> in
          Settings.
        </span>
      </fieldset>
      <label className="fw-field">
        <span className="fw-field__label">
          Penalty, in {reason?.unit === 'money' ? 'dollars' : 'points'}
        </span>
        <span className="fw-penalty__amount">
          {reason?.unit === 'money' ? <span aria-hidden>$</span> : null}
          <input
            className="fw-input"
            name="amount"
            inputMode={reason?.unit === 'money' ? 'decimal' : 'numeric'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoComplete="off"
          />
          <span className="fw-muted">{reason?.unit === 'money' ? 'owed' : 'points'}</span>
        </span>
        <span className="fw-field__help">Filled in from the reason; change it for this one.</span>
      </label>
      {reason ? (
        <p className="fw-penalty__preview">
          On the board, {person?.displayName ?? 'they'} see{person ? 's' : ''}:{' '}
          <b>
            {boardActivity({ type: 'penalty', amount: -1, label: reason.name })}{' '}
            {reason.unit === 'money' ? `$${amount || '0'} owed` : `−${amount || '0'}`}
          </b>
          .{' '}
          {reason.unit === 'money'
            ? 'Money is paid outside FamilyWise; record it here when it’s paid.'
            : `Points are taken at once, so ${person?.displayName ?? 'their'}${person ? '’s' : ''} points can go below 0.`}
        </p>
      ) : null}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending || !who} icon="minus-circle">
          Give the penalty
        </Button>
      </div>
    </form>
  );
}
