'use client';

import {
  Avatar,
  Banner,
  Button,
  Icon,
  IconPicker,
  type AvatarKey,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import {
  ASSIGNMENT_LABELS,
  ASSIGNMENTS,
  DAY_TYPE_LABELS,
  DAY_TYPES,
  defaultAssignment,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Assignment,
  type ChoreInput,
  type Freq,
  type Kind,
} from '@/lib/chores';
import { useFormAction } from '@/lib/forms';
import { LEAD_CHOICES } from '@/lib/reminder-settings';
import { saveChore } from './actions';

export interface MemberOption {
  id: string;
  displayName: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

export interface TagOption {
  id: string;
  name: string;
  color: MemberColor;
  icon: IconName | null;
}

const FREQ_LABELS: Record<Freq, string> = {
  daily: 'Every day',
  weekly: 'Some days',
  monthly: 'Monthly',
  once: 'Once',
};

/**
 * [CHR-01][CHR-09][CHR-10][CHR-11][CHR-13] Add or edit a chore (a routine) or a task (a to-do).
 * Built for a phone: the common fields first, the rest under "More options". A new chore starts
 * daily at 5 points and a new task once, today, at 0 points, until the admin changes them.
 */
export function ChoreForm({
  id,
  initial,
  defaultKind = 'chore',
  today,
  members,
  tags,
  approvalMode,
  offerVisibility,
}: {
  id?: string;
  initial?: ChoreInput;
  defaultKind?: Kind;
  /** Household-local today, "YYYY-MM-DD", for a new task's date. */
  today: string;
  members: MemberOption[];
  /** Active tags, plus any archived ones already on the item (shown, not offered). */
  tags: TagOption[];
  approvalMode: 'on' | 'off';
  /** Only an item's creator changes who sees it. */
  offerVisibility: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(saveChore, {} as FormState);
  const [kind, setKind] = useState<Kind>(initial?.kind ?? defaultKind);
  const [freq, setFreq] = useState<Freq>(
    initial?.schedule.freq ?? (defaultKind === 'task' ? 'once' : 'daily'),
  );
  const [points, setPoints] = useState(String(initial?.points ?? (defaultKind === 'task' ? 0 : 5)));
  const [assignment, setAssignment] = useState<Assignment>(
    initial?.assignment ?? defaultAssignment(initial?.kind ?? defaultKind),
  );
  const [people, setPeople] = useState(initial?.assignees.length ?? 0);
  const [touched, setTouched] = useState({
    points: Boolean(initial),
    freq: Boolean(initial),
    assignment: Boolean(initial),
  });
  const s = initial?.schedule;

  function chooseKind(next: Kind) {
    setKind(next);
    if (!touched.points) setPoints(next === 'task' ? '0' : '5');
    if (!touched.freq) setFreq(next === 'task' ? 'once' : 'daily');
    if (!touched.assignment) setAssignment(defaultAssignment(next));
  }

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={id ? 'Edit item' : 'Add an item'}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <input type="hidden" name="visibilityOffered" value={String(offerVisibility)} />

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">What it is</legend>
        <div className="fw-actions">
          {(['chore', 'task'] as const).map((k) => (
            <label key={k} className="fw-choice">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => chooseKind(k)}
              />
              {k === 'chore' ? 'Chore' : 'Task'}
            </label>
          ))}
        </div>
        <span className="fw-field__help">
          {kind === 'chore'
            ? 'A routine. If it isn’t done on its day, it counts as missed.'
            : 'A to-do. It stays open, and shows as overdue, until it’s done.'}
        </span>
      </fieldset>

      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="title"
          maxLength={80}
          required
          defaultValue={initial?.title ?? ''}
          autoComplete="off"
        />
      </label>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Who it’s for</legend>
        <div className="fw-picker">
          {members.map((m) => (
            <label key={m.id} className="fw-picker__item">
              <input
                type="checkbox"
                name="assignees"
                value={m.id}
                defaultChecked={initial?.assignees.includes(m.id) ?? false}
                onChange={(e) => {
                  // Read it now: React clears currentTarget before a queued update runs.
                  const on = e.currentTarget.checked;
                  setPeople((n) => n + (on ? 1 : -1));
                }}
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
        <span className="fw-field__help">Anyone in the family.</span>
      </fieldset>

      {/* [CHR-18] Only a question once there are several people (D-47). */}
      {people > 1 ? (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">With several people</legend>
          <div className="fw-actions">
            {ASSIGNMENTS.map((a) => (
              <label key={a} className="fw-choice">
                <input
                  type="radio"
                  name="assignment"
                  value={a}
                  checked={assignment === a}
                  onChange={() => {
                    setAssignment(a);
                    setTouched((t) => ({ ...t, assignment: true }));
                  }}
                />
                {ASSIGNMENT_LABELS[a]}
              </label>
            ))}
          </div>
          <span className="fw-field__help">
            {assignment === 'each'
              ? 'Each person has their own to check off, like making their own bed.'
              : 'Done once, by whoever gets to it, like feeding the dog.'}
          </span>
        </fieldset>
      ) : (
        <input type="hidden" name="assignment" value={assignment} />
      )}

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">How often</legend>
        <div className="fw-actions">
          {(Object.keys(FREQ_LABELS) as Freq[]).map((f) => (
            <label key={f} className="fw-choice">
              <input
                type="radio"
                name="freq"
                value={f}
                checked={freq === f}
                onChange={() => {
                  setFreq(f);
                  setTouched((t) => ({ ...t, freq: true }));
                }}
              />
              {FREQ_LABELS[f]}
            </label>
          ))}
        </div>
        {freq === 'weekly' ? (
          <div className="fw-picker" role="group" aria-label="Days of the week">
            {WEEKDAYS.map((d) => (
              <label key={d} className="fw-picker__item">
                <input
                  type="checkbox"
                  name="weekdays"
                  value={d}
                  defaultChecked={s?.freq === 'weekly' ? s.by_weekday.includes(d) : d <= 5}
                />
                {WEEKDAY_LABELS[d - 1]}
              </label>
            ))}
          </div>
        ) : null}
        {freq === 'monthly' ? (
          <label className="fw-field">
            <span className="fw-field__label">Day of the month</span>
            <input
              className="fw-input fw-input--short"
              name="monthDay"
              inputMode="numeric"
              defaultValue={s?.freq === 'monthly' ? s.by_month_day[0] : 1}
            />
          </label>
        ) : null}
        {freq === 'once' ? (
          <label className="fw-field">
            <span className="fw-field__label">{kind === 'task' ? 'Due date' : 'Date'}</span>
            <input
              className="fw-input"
              type="date"
              name="onDate"
              defaultValue={s?.freq === 'once' ? s.on_date : today}
            />
          </label>
        ) : null}
      </fieldset>

      <label className="fw-field">
        <span className="fw-field__label">Due time (optional)</span>
        <input
          className="fw-input"
          type="time"
          name="dueTime"
          defaultValue={initial?.dueTime ?? ''}
        />
        <span className="fw-field__help">
          Orders the day into morning, after school and evening. It never changes points.
        </span>
      </label>

      <label className="fw-field">
        <span className="fw-field__label">Reminders</span>
        <select
          className="fw-input"
          name="remindLeadMinutes"
          defaultValue={initial?.remindLeadMinutes == null ? '' : String(initial.remindLeadMinutes)}
        >
          <option value="">As each person chose</option>
          {LEAD_CHOICES.map((c) => (
            <option key={c.minutes} value={c.minutes}>
              {c.label}
            </option>
          ))}
        </select>
        <span className="fw-field__help">
          For people who turned reminders on. An item without a time reminds at their morning time.
          Each person switches an item’s reminders on or off with its bell in My tasks.
        </span>
      </label>

      <IconPicker legend="Icon" selected={initial?.icon ?? 'chore-bed'} start="home" />

      <label className="fw-field">
        <span className="fw-field__label">Points</span>
        <input
          className="fw-input fw-input--short"
          name="points"
          inputMode="numeric"
          value={points}
          onChange={(e) => {
            setPoints(e.target.value);
            setTouched((t) => ({ ...t, points: true }));
          }}
        />
        <span className="fw-field__help">Only members who earn rewards collect points.</span>
      </label>

      {tags.length > 0 ? (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Tags</legend>
          <div className="fw-picker">
            {tags.map((t) => (
              <label key={t.id} className="fw-picker__item">
                <input
                  type="checkbox"
                  name="tags"
                  value={t.id}
                  defaultChecked={initial?.tags.includes(t.id) ?? false}
                />
                <span
                  className="fw-swatch fw-swatch--small"
                  style={{ background: `var(--${t.color}-line)` }}
                  aria-hidden
                />
                {t.icon ? <Icon name={t.icon} size={20} /> : null}
                {t.name}
              </label>
            ))}
          </div>
          <span className="fw-field__help">
            <Link href="/admin/tags">Add or change tags</Link>
          </span>
        </fieldset>
      ) : (
        <p className="fw-field__help">
          No tags yet. <Link href="/admin/tags">Add tags</Link> to filter the list and set goals by
          category.
        </p>
      )}

      {offerVisibility ? (
        <>
          <label className="fw-choice">
            <input
              type="checkbox"
              name="private"
              role="switch"
              defaultChecked={initial?.visibility === 'private'}
            />
            Private
          </label>
          <p className="fw-field__help">
            Only you and the people it’s for who sign in can see it. It never shows on the board.
          </p>
        </>
      ) : null}

      <details className="fw-more">
        <summary>More options</summary>
        <div className="fw-form">
          <label className="fw-field">
            <span className="fw-field__label">Approval</span>
            <select
              className="fw-input"
              name="approval"
              defaultValue={initial?.approval ?? 'inherit'}
            >
              <option value="inherit">Family setting (approval is {approvalMode})</option>
              <option value="required">Always needs a parent’s OK</option>
              <option value="none">Never needs a parent’s OK</option>
            </select>
          </label>
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">On these days</legend>
            <div className="fw-picker">
              {DAY_TYPES.map((d) => (
                <label key={d} className="fw-picker__item">
                  <input
                    type="checkbox"
                    name="dayTypes"
                    value={d}
                    defaultChecked={initial ? initial.dayTypes.includes(d) : true}
                  />
                  {DAY_TYPE_LABELS[d]}
                </label>
              ))}
            </div>
            <span className="fw-field__help">
              For example, homework on school days only. These follow the school year once it’s set
              up.
            </span>
          </fieldset>
        </div>
      </details>

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending}>
          {id ? 'Save changes' : 'Save'}
        </Button>
        {id ? null : (
          <Button type="submit" variant="secondary" name="then" value="another" disabled={pending}>
            Save and add another
          </Button>
        )}
        <Link href="/admin/chores">Cancel</Link>
      </div>
    </form>
  );
}
