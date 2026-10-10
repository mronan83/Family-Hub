'use client';

import { Banner, Button, MEMBER_COLORS, type MemberColor } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { LINK_HELP } from '@/lib/calendars';
import { useFormAction } from '@/lib/forms';
import { COLOR_NAMES } from '@/lib/members';
import { saveCalendar } from './actions';

export interface CalendarFormInitial {
  name: string;
  color: MemberColor;
  memberId: string | null;
  showOnBoard: boolean;
}

/**
 * [CAL-01][CAL-05] Add a calendar by its public link, or change one: its name, color, whose it is and
 * whether boards show it. The link is never shown again (it is in Vault); typing a new one replaces it.
 */
export function CalendarForm({
  id,
  initial,
  members,
}: {
  id?: string;
  initial?: CalendarFormInitial;
  members: { id: string; displayName: string }[];
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
              <span className="fw-swatch" style={{ background: `var(--${c})` }} aria-hidden />
              <span>{COLOR_NAMES[c]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="fw-field">
        <span className="fw-field__label">Whose calendar (optional)</span>
        <select className="fw-input" name="memberId" defaultValue={initial?.memberId ?? ''}>
          <option value="">The whole family</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </label>
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
