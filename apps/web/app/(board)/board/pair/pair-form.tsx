'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { formatCode, normalizeCode } from '@/lib/devices';
import { useFormAction } from '@/lib/forms';
import { pairBoard } from './actions';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

/** [DEV-01] The code, typed on the board's own keypad (the kiosk has no keyboard). */
export function PairForm({ adminSignedIn }: { adminSignedIn: boolean }) {
  const [state, onSubmit, pending] = useFormAction(pairBoard, {} as FormState);
  const [digits, setDigits] = useState('');
  const press = (d: string) => setDigits((x) => (x + d).slice(0, 8));

  return (
    <form onSubmit={onSubmit} className="fw-pair" aria-label="Pair this board">
      <label className="fw-field" style={{ width: '100%' }}>
        <span className="fw-field__label">Pairing code from the admin app</span>
        <input
          className="fw-input fw-pair__code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={formatCode(digits)}
          onChange={(e) => setDigits(normalizeCode(e.target.value).slice(0, 8))}
        />
      </label>
      <div className="fw-keypad" role="group" aria-label="Keypad">
        {KEYS.map((d) => (
          <Button key={d} variant="secondary" onClick={() => press(d)}>
            {d}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => setDigits('')}>
          Clear
        </Button>
        <Button variant="secondary" onClick={() => press('0')}>
          0
        </Button>
        <Button
          variant="ghost"
          icon="chevron-left"
          onClick={() => setDigits((x) => x.slice(0, -1))}
        >
          Back
        </Button>
      </div>
      {adminSignedIn ? (
        <p className="fw-muted">Pairing signs this browser out of the admin app.</p>
      ) : null}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <Button type="submit" icon="link" disabled={pending || digits.length !== 8}>
        Pair this board
      </Button>
    </form>
  );
}
