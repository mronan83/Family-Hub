'use client';

import { Avatar, Banner, Button, type AvatarKey, type MemberColor } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { CLOSURE_LABELS, CLOSURE_TYPES, type SchoolYearInput } from '@/lib/school';
import { saveClosure, saveFollowers, saveSchoolYear, saveTerm } from './actions';

function Message({ state }: { state: FormState }) {
  return state.message ? <Banner kind="notice">{state.message}</Banner> : null;
}

/** [SCH-01] Add or edit a school year. */
export function SchoolYearForm({ id, initial }: { id?: string; initial?: SchoolYearInput }) {
  const [state, onSubmit, pending] = useFormAction(saveSchoolYear, {} as FormState);
  return (
    <form
      onSubmit={onSubmit}
      className="fw-form"
      aria-label={id ? 'Edit school year' : 'Add a school year'}
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={40}
          required
          placeholder="2026–27"
          defaultValue={initial?.name ?? ''}
          autoComplete="off"
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">School (optional)</span>
        <input
          className="fw-input"
          name="schoolName"
          maxLength={80}
          defaultValue={initial?.schoolName ?? ''}
          autoComplete="off"
        />
      </label>
      <div className="fw-dates">
        <label className="fw-field">
          <span className="fw-field__label">First day</span>
          <input
            className="fw-input"
            type="date"
            name="startDate"
            required
            defaultValue={initial?.startDate ?? ''}
          />
        </label>
        <label className="fw-field">
          <span className="fw-field__label">Last day</span>
          <input
            className="fw-input"
            type="date"
            name="endDate"
            required
            defaultValue={initial?.endDate ?? ''}
          />
        </label>
      </div>
      <label className="fw-choice">
        <input
          type="checkbox"
          name="isDefault"
          role="switch"
          defaultChecked={initial?.isDefault ?? true}
        />
        Default
      </label>
      <p className="fw-field__help">
        Everyone follows the default school year unless you assign them another one. Next year can
        be a default too, as long as the dates don’t overlap.
      </p>
      <Message state={state} />
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          {id ? 'Save changes' : 'Add school year'}
        </Button>
      </div>
    </form>
  );
}

/** [SCH-01] Add a break or a day off: one day, or a range. */
export function ClosureForm({ schoolYearId }: { schoolYearId: string }) {
  const [state, onSubmit, pending] = useFormAction(saveClosure, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add a day off">
      <input type="hidden" name="schoolYearId" value={schoolYearId} />
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={60}
          required
          placeholder="Winter break"
          autoComplete="off"
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Kind</span>
        <select className="fw-input" name="closureType" defaultValue="break">
          {CLOSURE_TYPES.map((t) => (
            <option key={t} value={t}>
              {CLOSURE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="fw-dates">
        <label className="fw-field">
          <span className="fw-field__label">From</span>
          <input className="fw-input" type="date" name="startDate" required />
        </label>
        <label className="fw-field">
          <span className="fw-field__label">To (optional)</span>
          <input className="fw-input" type="date" name="endDate" />
        </label>
      </div>
      <p className="fw-field__help">
        A break makes its weekdays “Break”; any other kind makes them “Day off school”.
      </p>
      <Message state={state} />
      <div className="fw-actions">
        <Button type="submit" disabled={pending} icon="plus">
          Add day off
        </Button>
      </div>
    </form>
  );
}

/** [SCH-01] Add a term (for reference and, later, goal windows). */
export function TermForm({ schoolYearId }: { schoolYearId: string }) {
  const [state, onSubmit, pending] = useFormAction(saveTerm, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add a term">
      <input type="hidden" name="schoolYearId" value={schoolYearId} />
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={40}
          required
          placeholder="Fall"
          autoComplete="off"
        />
      </label>
      <div className="fw-dates">
        <label className="fw-field">
          <span className="fw-field__label">From</span>
          <input className="fw-input" type="date" name="startDate" required />
        </label>
        <label className="fw-field">
          <span className="fw-field__label">To</span>
          <input className="fw-input" type="date" name="endDate" required />
        </label>
      </div>
      <Message state={state} />
      <div className="fw-actions">
        <Button type="submit" variant="secondary" disabled={pending} icon="plus">
          Add term
        </Button>
      </div>
    </form>
  );
}

export interface FollowerOption {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

/** [SCH-02] Who follows this school year instead of the default. */
export function FollowersForm({
  schoolYearId,
  members,
  following,
}: {
  schoolYearId: string;
  members: FollowerOption[];
  following: string[];
}) {
  const [state, onSubmit, pending] = useFormAction(saveFollowers, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Who follows this school year">
      <input type="hidden" name="schoolYearId" value={schoolYearId} />
      <div className="fw-picker">
        {members.map((m) => (
          <label key={m.id} className="fw-picker__item">
            <input
              type="checkbox"
              name="members"
              value={m.id}
              defaultChecked={following.includes(m.id)}
            />
            <Avatar
              name={m.displayName}
              avatarKey={m.avatarKey}
              color={m.color}
              size={32}
              decorative
            />
            {m.displayName}
          </label>
        ))}
      </div>
      <Message state={state} />
      <div className="fw-actions">
        <Button type="submit" variant="secondary" disabled={pending}>
          Save who follows it
        </Button>
      </div>
    </form>
  );
}
