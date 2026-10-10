'use client';

import type { RuleType } from '@familywise/rules-engine';
import {
  Avatar,
  type AvatarKey,
  Banner,
  Button,
  Icon,
  iconLabel,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { RULE_TYPES, RULE_WORDS, type ScopeChoice } from '@/lib/goals';
import { saveGoal } from './actions';

export interface GoalFormRule {
  type: RuleType;
  target: number;
  scope: ScopeChoice;
  tagIds: string[];
  itemIds: string[];
  grace: number;
}

export interface GoalFormInitial {
  title: string;
  description: string | null;
  icon: IconName;
  memberId: string | null;
  startDate: string;
  endDate: string | null;
  logic: 'all' | 'any';
  rules: GoalFormRule[];
}

/**
 * What may still change: everything while a goal waits to start; once it has started, not who it's
 * for or its start date; once it is redeemed, ended or cancelled, only its name, description and
 * picture (D-56).
 */
export type GoalLock = 'none' | 'started' | 'finished';

interface Row extends GoalFormRule {
  key: string;
}

const NEW_RULE: GoalFormRule = {
  type: 'COUNT',
  target: 10,
  scope: 'all',
  tagIds: [],
  itemIds: [],
  grace: 1,
};
const SCOPE_WORDS: Record<ScopeChoice, string> = {
  all: 'Everything',
  tags: 'Some tags',
  items: 'Some items',
};

let counter = 0;
const nextKey = () => `r${(counter += 1)}`;

/**
 * [RWD-01][RWD-02][RWD-03] Set a goal for a child who earns rewards, or the whole family: a name, its
 * dates, up to 5 rules (things done, days with everything done, good days in a row, points earned;
 * counting everything, some tags or some items) combined with all or any, and an icon or photo.
 */
export function GoalForm({
  id,
  initial,
  members,
  tags,
  items,
  icons,
  today,
  lock = 'none',
  hasPhoto = false,
}: {
  id: string;
  initial?: GoalFormInitial;
  members: { id: string; displayName: string; avatarKey: AvatarKey | null; color: MemberColor }[];
  tags: { id: string; name: string }[];
  items: { id: string; title: string }[];
  icons: IconName[];
  today: string;
  lock?: GoalLock;
  hasPhoto?: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(saveGoal, {} as FormState);
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.rules.length ? initial.rules : [NEW_RULE]).map((r) => ({ ...r, key: nextKey() })),
  );
  const change = (key: string, patch: Partial<GoalFormRule>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rulesLocked = lock === 'finished';
  const whoLocked = lock !== 'none';
  const who = initial ? (initial.memberId ?? 'family') : (members[0]?.id ?? 'family');
  const label = initial ? `Edit ${initial.title}` : 'Set a goal';

  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={label} encType="multipart/form-data">
      <input type="hidden" name="id" value={id} />
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="title"
          maxLength={80}
          required
          defaultValue={initial?.title ?? ''}
          autoComplete="off"
          placeholder="Movie night"
        />
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Description (optional)</span>
        <input
          className="fw-input"
          name="description"
          maxLength={300}
          defaultValue={initial?.description ?? ''}
          autoComplete="off"
        />
      </label>

      {whoLocked ? (
        <input type="hidden" name="member" value={who} />
      ) : (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Who it’s for</legend>
          <div className="fw-picker">
            {members.map((m) => (
              <label key={m.id} className="fw-picker__item">
                <input type="radio" name="member" value={m.id} defaultChecked={who === m.id} />
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
            <label className="fw-picker__item">
              <input type="radio" name="member" value="family" defaultChecked={who === 'family'} />
              <Icon name="family" size={24} />
              The whole family
            </label>
          </div>
          <span className="fw-field__help">
            Goals are for those who earn rewards, or everyone together.
          </span>
        </fieldset>
      )}

      <div className="fw-goal-form__dates">
        {whoLocked ? (
          <input type="hidden" name="startDate" value={initial?.startDate ?? today} />
        ) : (
          <label className="fw-field">
            <span className="fw-field__label">Starts</span>
            <input
              className="fw-input"
              type="date"
              name="startDate"
              required
              defaultValue={initial?.startDate ?? today}
            />
          </label>
        )}
        {rulesLocked ? (
          <input type="hidden" name="endDate" value={initial?.endDate ?? ''} />
        ) : (
          <label className="fw-field">
            <span className="fw-field__label">Ends (optional)</span>
            <input
              className="fw-input"
              type="date"
              name="endDate"
              defaultValue={initial?.endDate ?? ''}
            />
          </label>
        )}
      </div>

      <input type="hidden" name="rule-keys" value={rows.map((r) => r.key).join(',')} />
      {rows.map((r, i) => (
        <RuleRow
          key={r.key}
          row={r}
          n={i + 1}
          only={rows.length === 1}
          locked={rulesLocked}
          tags={tags}
          items={items}
          onChange={(patch) => change(r.key, patch)}
          onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
        />
      ))}
      {!rulesLocked && rows.length < 5 ? (
        <div className="fw-actions">
          <Button
            type="button"
            variant="secondary"
            icon="plus"
            onClick={() => setRows((rs) => [...rs, { ...NEW_RULE, key: nextKey() }])}
          >
            Add a rule
          </Button>
        </div>
      ) : null}
      {rows.length > 1 ? (
        rulesLocked ? (
          <input type="hidden" name="logic" value={initial?.logic ?? 'all'} />
        ) : (
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">It’s reached when</legend>
            <div className="fw-actions">
              <label className="fw-choice">
                <input
                  type="radio"
                  name="logic"
                  value="all"
                  defaultChecked={(initial?.logic ?? 'all') === 'all'}
                />
                Every rule is met
              </label>
              <label className="fw-choice">
                <input
                  type="radio"
                  name="logic"
                  value="any"
                  defaultChecked={initial?.logic === 'any'}
                />
                Any one rule is met
              </label>
            </div>
          </fieldset>
        )
      ) : (
        <input type="hidden" name="logic" value="all" />
      )}

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Icon, shown when there’s no photo</legend>
        <div className="fw-picker">
          {icons.map((name) => (
            <label key={name} className="fw-picker__item fw-picker__item--icon">
              <input
                type="radio"
                name="icon"
                value={name}
                defaultChecked={(initial?.icon ?? 'trophy') === name}
                className="fw-visually-hidden"
              />
              <Icon name={name} size={24} />
              <span className="fw-visually-hidden">{iconLabel(name)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="fw-field">
        <span className="fw-field__label">
          {hasPhoto ? 'A new photo (optional)' : 'Photo (optional)'}
        </span>
        <input
          className="fw-input"
          name="photo"
          type="file"
          accept="image/jpeg,image/png,image/webp"
        />
        <span className="fw-field__help">JPEG, PNG or WebP, up to 2 MB.</span>
      </label>

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {initial ? 'Save changes' : 'Set goal'}
        </Button>
      </div>
    </form>
  );
}

function RuleRow({
  row,
  n,
  only,
  locked,
  tags,
  items,
  onChange,
  onRemove,
}: {
  row: Row;
  n: number;
  only: boolean;
  locked: boolean;
  tags: { id: string; name: string }[];
  items: { id: string; title: string }[];
  onChange: (patch: Partial<GoalFormRule>) => void;
  onRemove: () => void;
}) {
  const name = (field: string) => `rule-${row.key}-${field}`;
  if (locked) {
    // A finished goal's rules stay as they are; they are sent back unchanged.
    return (
      <>
        <input type="hidden" name={name('type')} value={row.type} />
        <input type="hidden" name={name('target')} value={row.target} />
        <input type="hidden" name={name('scope')} value={row.scope} />
        {row.tagIds.map((t) => (
          <input key={t} type="hidden" name={name('tag')} value={t} />
        ))}
        {row.itemIds.map((t) => (
          <input key={t} type="hidden" name={name('item')} value={t} />
        ))}
        <input type="hidden" name={name('grace')} value={row.grace} />
      </>
    );
  }
  return (
    <fieldset className="fw-field fw-fieldset fw-goal-rule">
      <legend className="fw-field__label">{only ? 'Rule' : `Rule ${n}`}</legend>
      <div className="fw-goal-rule__head">
        <label className="fw-field">
          <span className="fw-field__label">Counts</span>
          <select
            className="fw-input"
            name={name('type')}
            value={row.type}
            onChange={(e) => onChange({ type: e.target.value as RuleType })}
          >
            {RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RULE_WORDS[t].label}
              </option>
            ))}
          </select>
        </label>
        <label className="fw-field">
          <span className="fw-field__label">Target</span>
          <input
            className="fw-input fw-input--short"
            name={name('target')}
            type="number"
            inputMode="numeric"
            min={1}
            max={100000}
            required
            value={row.target}
            onChange={(e) => onChange({ target: Number(e.target.value) })}
          />
        </label>
        {row.type === 'STREAK' ? (
          <label className="fw-field">
            <span className="fw-field__label">Misses forgiven a week</span>
            <select
              className="fw-input fw-input--short"
              name={name('grace')}
              value={row.grace}
              onChange={(e) => onChange({ grace: Number(e.target.value) })}
            >
              {[0, 1, 2, 3].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <fieldset className="fw-fieldset">
        <legend className="fw-field__label">What counts</legend>
        <div className="fw-actions">
          {(['all', 'tags', 'items'] as const).map((s) => (
            <label key={s} className="fw-choice">
              <input
                type="radio"
                name={name('scope')}
                value={s}
                checked={row.scope === s}
                onChange={() => onChange({ scope: s })}
                disabled={
                  (s === 'tags' && tags.length === 0) || (s === 'items' && items.length === 0)
                }
              />
              {SCOPE_WORDS[s]}
            </label>
          ))}
        </div>
        {row.scope === 'tags' ? (
          <div className="fw-picker" role="group" aria-label={`Tags for rule ${n}`}>
            {tags.map((t) => (
              <label key={t.id} className="fw-picker__item">
                <input
                  type="checkbox"
                  name={name('tag')}
                  value={t.id}
                  defaultChecked={row.tagIds.includes(t.id)}
                />
                {t.name}
              </label>
            ))}
          </div>
        ) : null}
        {row.scope === 'items' ? (
          <div className="fw-picker" role="group" aria-label={`Items for rule ${n}`}>
            {items.map((t) => (
              <label key={t.id} className="fw-picker__item">
                <input
                  type="checkbox"
                  name={name('item')}
                  value={t.id}
                  defaultChecked={row.itemIds.includes(t.id)}
                />
                {t.title}
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
      {only ? null : (
        <div className="fw-actions">
          <Button
            type="button"
            variant="ghost"
            icon="trash"
            onClick={onRemove}
            aria-label={`Remove rule ${n}`}
          >
            Remove
          </Button>
        </div>
      )}
    </fieldset>
  );
}
