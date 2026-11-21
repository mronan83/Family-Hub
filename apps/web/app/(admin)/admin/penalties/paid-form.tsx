'use client';

import { Banner, Button } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { amountInput, money } from '@/lib/penalties';
import { recordPaid } from './actions';

/**
 * [PTS-09][US-1111] Record paid on one money penalty: money paid outside FamilyWise, from $0.01 up to
 * what is owed on it, filled in with all of it (D-156 (4)).
 */
export function PaidForm({
  penaltyId,
  memberId,
  reason,
  owed,
  requestId,
  back,
}: {
  penaltyId: string;
  memberId: string;
  reason: string;
  /** Cents. */
  owed: number;
  requestId: string;
  back: string;
}) {
  const [state, onSubmit, pending] = useFormAction(recordPaid, {} as FormState);
  return (
    <form
      onSubmit={onSubmit}
      className="fw-form fw-penalty__paid"
      aria-label={`Record paid for ${reason}`}
    >
      <input type="hidden" name="penaltyId" value={penaltyId} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="back" value={back} />
      <label className="fw-field">
        <span className="fw-field__label">Paid</span>
        <span className="fw-penalty__amount">
          <span aria-hidden>$</span>
          <input
            className="fw-input"
            name="amount"
            inputMode="decimal"
            defaultValue={amountInput('money', owed)}
            required
            autoComplete="off"
          />
          <Button type="submit" disabled={pending} icon="check">
            Record paid
          </Button>
        </span>
        <span className="fw-field__help">Up to {money(owed)}, what is owed on this penalty.</span>
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
    </form>
  );
}
