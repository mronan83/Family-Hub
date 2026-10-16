'use client';

import { useState } from 'react';
import {
  Avatar,
  Banner,
  Button,
  MEMBER_COLORS,
  type AvatarKey,
  type MemberColor,
} from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { LINK_HELP } from '@/lib/calendars';
import { useFormAction } from '@/lib/forms';
import { COLOR_NAMES } from '@/lib/members';
import { saveCalendar } from './actions';

export interface CalendarFormInitial {
  name: string;
  color: MemberColor;
  memberIds: string[];
  showOnBoard: boolean;
}

/** A person a calendar can be for: the family's members still in it, in the family's order. */
export interface CalendarPerson {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

/**
 * [CAL-09][US-508] Who a calendar is for (WP-50, D-122): The whole family, or a tick a person. Ticking
 * a person clears The whole family; clearing every person ticks it again; ticking it clears them.
 */
function WhoFor({ members, initial }: { members: CalendarPerson[]; initial: string[] }) {
  const [ticked, setTicked] = useState(initial.filter((id) => members.some((m) => m.id === id)));
  return (
    <fieldset className="fw-field fw-fieldset">
      <legend className="fw-field__label">Who it’s for</legend>
      <div className="fw-picker">
        <label className="fw-picker__item">
          <input
            type="checkbox"
            name="wholeFamily"
            checked={ticked.length === 0}
            onChange={(e) => e.target.checked && setTicked([])}
          />
          The whole family
        </label>
        {members.map((m) => (
          <label key={m.id} className="fw-picker__item">
            <input
              type="checkbox"
              name="memberIds"
              value={m.id}
              checked={ticked.includes(m.id)}
              onChange={(e) =>
                setTicked((t) => (e.target.checked ? [...t, m.id] : t.filter((id) => id !== m.id)))
              }
            />
            <Avatar
              name={m.displayName}
              avatarKey={m.avatarKey}
              color={m.color}
              size={28}
              decorative
            />
            {m.displayName}
          </label>
        ))}
      </div>
      <span className="fw-field__help">
        Its events show on each of their screens and with their faces. The whole family’s show on
        everyone’s.
      </span>
    </fieldset>
  );
}

/**
 * [CAL-01][CAL-05][CAL-09] Add a calendar by its public link, or change one: its name, color, who it's
 * for and whether boards show it. The link is never shown again (it is in Vault); typing a new one
 * replaces it.
 */
export function CalendarForm({
  id,
  initial,
  members,
}: {
  id?: string;
  initial?: CalendarFormInitial;
  members: CalendarPerson[];
}) {
  const [state, onSubmit, pending] = useFormAction(saveCalendar, {} as FormState);
  const label = id ? `Edit ${initial?.name ?? 'calendar'}` : 'Add a calendar';
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={label}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={40}
          required
          defaultValue={initial?.name ?? ''}
          autoComplete="off"
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">
          {id ? 'Replace the link (optional)' : 'Public link'}
        </span>
        <input
          className="fw-input"
          name="url"
          type="text"
          inputMode="url"
          required={!id}
          placeholder="webcal://p01-caldav.icloud.com/published/2/…"
          autoComplete="off"
          spellCheck={false}
        />
        <span className="fw-field__help">
          {id
            ? 'The link is kept privately and isn’t shown again. Leave this empty to keep it.'
            : `${LINK_HELP} It’s kept privately and isn’t shown again.`}
        </span>
      </label>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Color</legend>
        <div className="fw-picker">
          {MEMBER_COLORS.map((c: MemberColor) => (
            <label key={c} className="fw-picker__item">
              <input
                type="radio"
                name="color"
                value={c}
                defaultChecked={(initial?.color ?? 'member-6') === c}
                className="fw-visually-hidden"
              />
              <span className="fw-swatch" style={{ background: `var(--${c}-line)` }} aria-hidden />
              <span>{COLOR_NAMES[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <WhoFor members={members} initial={initial?.memberIds ?? []} />
      <label className="fw-choice">
        <input type="checkbox" name="showOnBoard" defaultChecked={initial?.showOnBoard ?? true} />
        Show on the boards
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending} icon={id ? undefined : 'calendar'}>
          {pending
            ? id
              ? 'Saving…'
              : 'Adding and syncing…'
            : id
              ? 'Save calendar'
              : 'Add calendar'}
        </Button>
      </div>
    </form>
  );
}
