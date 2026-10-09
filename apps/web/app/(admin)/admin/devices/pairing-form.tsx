'use client';

import { Banner, Button } from '@familywise/ui';
import { formatCode } from '@/lib/devices';
import { time } from '@/lib/format';
import { useFormAction } from '@/lib/forms';
import { startPairing, type PairingState } from './actions';

/** [DEV-01] Add a board: name it, get a code to type on the board. */
export function PairingForm({ timeZone }: { timeZone: string }) {
  const [state, onSubmit, pending] = useFormAction(startPairing, {} as PairingState);
  const until = state.expiresAt ? time(state.expiresAt, timeZone) : '';
  return (
    <div className="fw-form">
      <form onSubmit={onSubmit} className="fw-form" aria-label="Add a board">
        <label className="fw-field">
          <span className="fw-field__label">Board name</span>
          <input
            className="fw-input"
            name="name"
            maxLength={60}
            placeholder="Kitchen"
            autoComplete="off"
            required
          />
        </label>
        {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
        <div className="fw-actions">
          <Button type="submit" icon="plus" disabled={pending}>
            Get a pairing code
          </Button>
        </div>
      </form>
      {state.code ? (
        <div className="fw-card" aria-live="polite">
          <p>
            On <strong>{state.name}</strong>, open the board and enter this code. It works once,
            until {until}.
          </p>
          <p className="fw-pairing-code" data-testid="pairing-code">
            {formatCode(state.code)}
          </p>
        </div>
      ) : null}
    </div>
  );
}
