'use client';

import {
  Avatar,
  AVATAR_KEYS,
  Banner,
  Button,
  MEMBER_COLORS,
  type MemberColor,
} from '@familywise/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { COLOR_NAMES, type MemberInput } from '@/lib/members';
import { saveMember } from './actions';

export interface AdminOption {
  userId: string;
  email: string;
}

/**
 * [ACC-04][PTS-07] Add or edit a member. For a new member the earns-rewards switch follows the
 * role (on for a child, off for an adult, D-32) until the admin sets it.
 */
export function MemberForm({
  id,
  initial,
  admins,
  elsewhere = [],
}: {
  id?: string;
  initial?: MemberInput;
  /** Admins of the household who are not linked to another member. */
  admins: AdminOption[];
  /** [D-61] Sign-ins linked to another member (archived ones too), said here rather than left out. */
  elsewhere?: { email: string; name: string; archived: boolean }[];
}) {
  const [state, onSubmit, pending] = useFormAction(saveMember, {} as FormState);
  const [role, setRole] = useState(initial?.role ?? 'child');
  const [earns, setEarns] = useState(initial?.earnsRewards ?? true);
  const [earnsTouched, setEarnsTouched] = useState(Boolean(initial));
  const [color, setColor] = useState<MemberColor>(initial?.color ?? 'member-1');
  const [name, setName] = useState(initial?.displayName ?? '');

  function chooseRole(next: 'child' | 'adult') {
    setRole(next);
    if (!earnsTouched) setEarns(next === 'child');
  }

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={id ? 'Edit member' : 'Add a member'}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="displayName"
          maxLength={40}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
        <span className="fw-field__help">A first name or nickname is enough.</span>
      </label>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Who they are</legend>
        <div className="fw-actions">
          {(['child', 'adult'] as const).map((r) => (
            <label key={r} className="fw-choice">
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => chooseRole(r)}
              />
              {r === 'child' ? 'Child' : 'Adult'}
            </label>
          ))}
        </div>
        <span className="fw-field__help">Children never sign in; they use the board.</span>
      </fieldset>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Avatar</legend>
        <div className="fw-picker">
          {AVATAR_KEYS.map((key) => (
            <label key={key} className="fw-picker__item">
              <input
                type="radio"
                name="avatarKey"
                value={key}
                defaultChecked={(initial ? initial.avatarKey : 'owl') === key}
                aria-label={key[0]!.toUpperCase() + key.slice(1)}
                className="fw-visually-hidden"
              />
              <Avatar name={key} avatarKey={key} size={48} decorative />
            </label>
          ))}
          <label className="fw-picker__item">
            <input
              type="radio"
              name="avatarKey"
              value="initials"
              defaultChecked={initial ? initial.avatarKey === null : false}
              aria-label="Initials"
              className="fw-visually-hidden"
            />
            <Avatar name={name || '?'} color={color} size={48} decorative />
          </label>
        </div>
      </fieldset>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Color</legend>
        <div className="fw-picker">
          {MEMBER_COLORS.map((c) => (
            <label key={c} className="fw-picker__item">
              <input
                type="radio"
                name="color"
                value={c}
                checked={color === c}
                onChange={() => setColor(c)}
                className="fw-visually-hidden"
              />
              <span className="fw-swatch" style={{ background: `var(--${c})` }} aria-hidden />
              <span>{COLOR_NAMES[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="fw-field">
        <span className="fw-field__label">Birth year (optional)</span>
        <input
          className="fw-input fw-input--short"
          name="birthYear"
          inputMode="numeric"
          pattern="[0-9]{4}"
          defaultValue={initial?.birthYear ?? ''}
          autoComplete="off"
        />
      </label>

      <label className="fw-choice">
        <input
          type="checkbox"
          name="earnsRewards"
          role="switch"
          checked={earns}
          onChange={(e) => {
            setEarns(e.target.checked);
            setEarnsTouched(true);
          }}
        />
        Earns rewards
      </label>
      <p className="fw-field__help">
        Members who earn rewards collect points, go through approval and count toward goals. On for
        children and off for adults to start; change it for anyone.
      </p>

      {role === 'adult' ? (
        <label className="fw-field">
          <span className="fw-field__label">Their sign-in</span>
          <select className="fw-input" name="userId" defaultValue={initial?.userId ?? ''}>
            <option value="">Not linked</option>
            {admins.map((a) => (
              <option key={a.userId} value={a.userId}>
                {a.email}
              </option>
            ))}
          </select>
          <span className="fw-field__help">
            Link the adult who is an admin, so their own tasks and reminders find them.
            {elsewhere.length > 0
              ? ` Already linked: ${elsewhere
                  .map((e) => `${e.email} to ${e.name}${e.archived ? ' (archived)' : ''}`)
                  .join('; ')}.`
              : ''}
          </span>
        </label>
      ) : (
        <p className="fw-field__help" data-testid="sign-in-child">
          Only an adult can have a sign-in. Choose Adult above to link one.
        </p>
      )}

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          {id ? 'Save changes' : 'Add member'}
        </Button>
        <Link href="/admin/members">Cancel</Link>
      </div>
    </form>
  );
}
