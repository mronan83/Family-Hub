'use client';

import type { Repeat, RuleType } from '@familywise/rules-engine';
import {
  Avatar,
  type AvatarKey,
  Banner,
  Button,
  Icon,
  IconPicker,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { periodWord, REPEAT_WORDS } from '@/lib/goal-periods';
import { type LowerStep, type StepKind, stepKind } from '@/lib/goal-steps';
import { type GoalPayout, REPEATS, RULE_TYPES, RULE_WORDS, type ScopeChoice } from '@/lib/goals';
import { type GoalFormState, type GoalPreviewView, saveGoal } from './actions';
import { EndDateField } from './end-date-field';

export interface GoalFormRule {
  type: RuleType;
  target: number;
  scope: ScopeChoice;
  tagIds: string[];
  itemIds: string[];
  grace: number;
  /** [RWD-16] Every day it's due: the days a period may miss, 0 to 3. */
  misses?: number;
  /** [RWD-17] When a tick counts: 'due_time', a time 'HH:MM', or null for any time that day. */
  onTime?: string | null;
  /** [RWD-18] Its weight, 1 to 100, on a goal with two or more rules that pays in steps. */
  weight?: number | null;
}

export interface GoalFormInitial {
  title: string;
  description: string | null;
  icon: IconName;
  memberId: string | null;
  startDate: string;
  endDate: string | null;
  logic: 'all' | 'any';
  /** [RWD-15] How it repeats; absent for a goal that doesn't. */
  repeat?: Repeat;
  rules: GoalFormRule[];
  payout: GoalPayout;
}

/** A reward in the shop a goal can pay: those not removed, and the goal's own even if it was. */
export interface GoalPrize {
  id: string;
  title: string;
  cost: number;
}

/**
 * What may still change: everything while a goal waits to start; once it has started, not who it's
 * for or its start date, and its end date is today or later; once it is reached, redeemed, ended or
 * cancelled, only its name, description and picture (D-56, D-115).
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

const PAYOUT_CHOICE = { custom: 'custom', points: 'points', catalog_item: 'item' } as const;

/**
 * [RWD-01][RWD-02][RWD-03][RWD-13] Set a goal for a child who earns rewards, or the whole family: a
 * name, its dates, up to 5 rules (things done, days with everything done, good days in a row, points
 * earned; counting everything, some tags or some items) combined with all or any, what reaching it
 * pays (the celebration, points, or a reward from the shop), and an icon or photo. Preview shows what
 * the goal would be from every check-off, and what saving would do, before anything is saved (RWD-10).
 */
export function GoalForm({
  id,
  initial,
  members,
  tags,
  items,
  prizes,
  today,
  lock = 'none',
  hasPhoto = false,
  preview,
}: {
  id: string;
  initial?: GoalFormInitial;
  members: { id: string; displayName: string; avatarKey: AvatarKey | null; color: MemberColor }[];
  tags: { id: string; name: string }[];
  items: { id: string; title: string }[];
  prizes: GoalPrize[];
  today: string;
  lock?: GoalLock;
  hasPhoto?: boolean;
  /** A preview to show at first (the made-up /dev/goals page). */
  preview?: GoalPreviewView;
}) {
  const [state, onSubmit, pending] = useFormAction<GoalFormState>(saveGoal, { preview });
  const [rows, setRows] = useState<Row[]>(() =>
    (initial?.rules.length ? initial.rules : [NEW_RULE]).map((r) => ({ ...r, key: nextKey() })),
  );
  const change = (key: string, patch: Partial<GoalFormRule>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const rulesLocked = lock === 'finished';
  const whoLocked = lock !== 'none';
  const [who, setWho] = useState(
    initial ? (initial.memberId ?? 'family') : (members[0]?.id ?? 'family'),
  );
  // [RWD-15] How it repeats: chosen until it starts, then fixed (D-123).
  const [repeat, setRepeat] = useState<Repeat>(initial?.repeat ?? 'none');
  const chooseRepeat = (r: Repeat) => {
    setRepeat(r);
    // Every day it's due is for a goal that repeats.
    if (r === 'none') {
      setRows((rs) => rs.map((x) => (x.type === 'DAYS_DUE' ? { ...x, type: 'COUNT' } : x)));
    }
  };
  const [pays, setPays] = useState<'custom' | 'points' | 'item'>(
    PAYOUT_CHOICE[initial?.payout.type ?? 'custom'],
  );
  // [RWD-18] Pay in steps (points only); with two or more rules, each rule's weight.
  const initialSteps = initial?.payout.type === 'points' ? (initial.payout.steps ?? []) : [];
  const [stepsOn, setStepsOn] = useState(initialSteps.length > 0);
  const kind = stepKind(rows);
  const inSteps = pays === 'points' && stepsOn;
  const weighted = inSteps && rows.length > 1;
  const [lowest, setLowest] = useState<number>(
    initialSteps.at(-1)?.misses ?? (rows[0]?.misses || 1),
  );
  const label = initial ? `Edit ${initial.title}` : 'Set a goal';
  const points = initial?.payout.type === 'points' ? initial.payout.amount : 10;
  const prize = initial?.payout.type === 'catalog_item' ? initial.payout.item_id : prizes[0]?.id;

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
                <input
                  type="radio"
                  name="member"
                  value={m.id}
                  checked={who === m.id}
                  onChange={() => setWho(m.id)}
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
            <label className="fw-picker__item">
              <input
                type="radio"
                name="member"
                value="family"
                checked={who === 'family'}
                onChange={() => {
                  setWho('family');
                  if (pays === 'item') setPays('custom');
                }}
              />
              <Icon name="family" size={24} />
              The whole family
            </label>
          </div>
          <span className="fw-field__help">
            Goals are for those who earn rewards, or everyone together.
          </span>
        </fieldset>
      )}

      {whoLocked ? (
        <input type="hidden" name="repeat" value={repeat} />
      ) : (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Repeats</legend>
          <div className="fw-picker">
            {REPEATS.map((r) => (
              <label key={r} className="fw-picker__item">
                <input
                  type="radio"
                  name="repeat"
                  value={r}
                  checked={repeat === r}
                  onChange={() => chooseRepeat(r)}
                />
                {REPEAT_WORDS[r]}
              </label>
            ))}
          </div>
          <span className="fw-field__help">
            {repeat === 'none'
              ? 'Reached once, between its dates.'
              : repeat === 'week'
                ? 'Each of the family’s weeks is worked out, won and paid on its own.'
                : repeat === 'month'
                  ? 'Each calendar month is worked out, won and paid on its own.'
                  : 'Each term of the school year (the child’s, or the family’s for a family goal) is worked out, won and paid on its own. Days between terms don’t count.'}
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
          <EndDateField
            initial={initial?.endDate ?? null}
            min={lock === 'started' ? today : undefined}
          />
        )}
      </div>

      <input type="hidden" name="rule-keys" value={rows.map((r) => r.key).join(',')} />
      {rows.map((r, i) => (
        <RuleRow
          key={r.key}
          row={r}
          n={i + 1}
          weight={weighted ? (r.weight ?? equalWeight(rows.length, i)) : null}
          missesByStep={inSteps && kind === 'misses' ? lowest : null}
          only={rows.length === 1}
          locked={rulesLocked}
          repeat={repeat}
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
      {weighted && !rulesLocked ? (
        <p className="fw-field__help" data-testid="weights-total">
          Weights total{' '}
          <b>{rows.reduce((sum, r, i) => sum + (r.weight ?? equalWeight(rows.length, i)), 0)}%</b>.
          With steps, the goal’s % is each rule’s % times its weight, and it is reached at 100%:
          every rule met.
        </p>
      ) : null}
      {weighted ? (
        <input type="hidden" name="logic" value="all" />
      ) : rows.length > 1 ? (
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

      <PayoutField
        locked={rulesLocked}
        family={who === 'family'}
        pays={pays}
        onPays={setPays}
        points={points}
        prize={prize}
        prizes={prizes}
        repeat={repeat}
        stepsOn={stepsOn}
        onStepsOn={setStepsOn}
        steps={initialSteps}
        kind={kind}
        target={rows[0]?.target ?? 1}
        oneOff={repeat === 'none'}
        onLowest={setLowest}
      />

      <IconPicker
        legend="Icon, shown when there’s no photo"
        selected={initial?.icon ?? 'trophy'}
        start="rewards"
      />
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
      {state.preview && !state.message ? <PreviewPanel preview={state.preview} /> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {initial ? 'Save changes' : 'Set goal'}
        </Button>
        {rulesLocked ? null : (
          <Button
            type="submit"
            name="intent"
            value="preview"
            variant="secondary"
            icon="search"
            disabled={pending}
          >
            Preview
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * [RWD-13] What reaching it pays: just the celebration (a parent gives the reward and marks it
 * redeemed), points (to each child, for a family goal), or a reward from the shop (a child's goal
 * only), approved at once and costing nothing. A finished goal's payout is sent back unchanged.
 */
function PayoutField({
  locked,
  family,
  pays,
  onPays,
  points,
  prize,
  prizes,
  repeat,
  stepsOn,
  onStepsOn,
  steps,
  kind,
  target,
  oneOff,
  onLowest,
}: {
  repeat: Repeat;
  stepsOn: boolean;
  onStepsOn: (on: boolean) => void;
  steps: LowerStep[];
  kind: StepKind;
  target: number;
  oneOff: boolean;
  onLowest: (misses: number) => void;
  locked: boolean;
  family: boolean;
  pays: 'custom' | 'points' | 'item';
  onPays: (p: 'custom' | 'points' | 'item') => void;
  points: number;
  prize: string | undefined;
  prizes: GoalPrize[];
}) {
  if (locked) {
    return (
      <>
        <input type="hidden" name="payout" value={pays} />
        <input type="hidden" name="payoutPoints" value={points} />
        <input type="hidden" name="payoutItem" value={prize ?? ''} />
        {stepsOn ? <input type="hidden" name="payoutSteps" value="on" /> : null}
        {steps.map((st, i) => (
          <span key={i}>
            <input type="hidden" name={`step-${i + 1}-at`} value={st.misses ?? st.at ?? ''} />
            <input type="hidden" name={`step-${i + 1}-amount`} value={st.amount} />
          </span>
        ))}
      </>
    );
  }
  const noItem = family || prizes.length === 0;
  return (
    <fieldset className="fw-field fw-fieldset">
      <legend className="fw-field__label">
        {repeat === 'none' ? 'What reaching it pays' : `What each ${periodWord(repeat)} pays`}
      </legend>
      <div className="fw-actions">
        <label className="fw-choice">
          <input
            type="radio"
            name="payout"
            value="custom"
            checked={pays === 'custom'}
            onChange={() => onPays('custom')}
          />
          Just the celebration
        </label>
        <label className="fw-choice">
          <input
            type="radio"
            name="payout"
            value="points"
            checked={pays === 'points'}
            onChange={() => onPays('points')}
          />
          Points
        </label>
        <label className="fw-choice">
          <input
            type="radio"
            name="payout"
            value="item"
            checked={pays === 'item'}
            disabled={noItem}
            onChange={() => onPays('item')}
          />
          A reward from the shop
        </label>
      </div>
      {pays === 'points' ? (
        <label className="fw-field">
          <span className="fw-field__label">Points paid</span>
          <input
            className="fw-input fw-input--short"
            name="payoutPoints"
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            required
            defaultValue={points}
          />
        </label>
      ) : null}
      {pays === 'points' ? (
        <StepsField
          on={stepsOn}
          onOn={onStepsOn}
          steps={steps}
          kind={kind}
          target={target}
          oneOff={oneOff}
          period={repeat === 'none' ? null : periodWord(repeat)}
          onLowest={onLowest}
        />
      ) : null}
      {pays === 'item' && !noItem ? (
        <label className="fw-field">
          <span className="fw-field__label">Reward</span>
          <select className="fw-input" name="payoutItem" defaultValue={prize}>
            {prizes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.cost.toLocaleString('en-US')} points in the shop)
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <span className="fw-field__help">
        {repeat !== 'none'
          ? `Each ${periodWord(repeat)} won pays once${pays === 'item' ? ': its reward goes to To give once for each one' : ''}. If a check-off it needed is undone, what that ${periodWord(repeat)} paid is taken back.`
          : pays === 'points'
            ? family
              ? 'Each child who earns rewards gets them when it’s reached. If a check-off it needed is undone, they’re taken back.'
              : 'Paid when it’s reached. If a check-off it needed is undone, they’re taken back; reached again, paid again.'
            : pays === 'item'
              ? 'Approved for them as soon as it’s reached, at no cost. Mark it given in Rewards as usual.'
              : family
                ? 'You give the reward and mark it redeemed. A family goal can pay points to each child; a reward from the shop is for one child’s goal.'
                : 'You give the reward and mark it redeemed.'}
      </span>
    </fieldset>
  );
}

/** An even split of 100 among `n` rules, the first taking what is left over. */
function equalWeight(n: number, i: number): number {
  const each = Math.floor(100 / n);
  return i === 0 ? 100 - each * (n - 1) : each;
}

/**
 * [RWD-18] Pay in steps (the approved mockups): the points above are the top step; up to 3 lower
 * steps, each days missed (one "every day it's due" rule: 1, 2 and 3 missed, a step left empty is
 * none), or where it's reached (a number under the target, or the goal's % with two or more rules).
 */
function StepsField({
  on,
  onOn,
  steps,
  kind,
  target,
  oneOff,
  period,
  onLowest,
}: {
  on: boolean;
  onOn: (on: boolean) => void;
  steps: LowerStep[];
  kind: StepKind;
  target: number;
  oneOff: boolean;
  period: string | null;
  onLowest: (misses: number) => void;
}) {
  const missesAmounts = [1, 2, 3].map((m) => steps.find((st) => st.misses === m)?.amount);
  const recount = (form: HTMLElement | null) => {
    if (!form) return;
    let last = 0;
    for (const m of [1, 2, 3]) {
      const el = form.querySelector<HTMLInputElement>(`[name="step-${m}-amount"]`);
      if (el && el.value.trim()) last = m;
    }
    if (last) onLowest(last);
  };
  return (
    <fieldset className="fw-fieldset fw-goal-steps" aria-label="Pay in steps">
      <legend className="fw-field__label">Pay in steps</legend>
      <label className="fw-choice">
        <input
          type="checkbox"
          name="payoutSteps"
          value="on"
          checked={on}
          onChange={(e) => onOn(e.target.checked)}
        />
        {kind === 'misses'
          ? `Pay less for a ${period ?? 'period'} with misses`
          : 'Pay less for less done'}
      </label>
      {on ? (
        <>
          {kind === 'misses' ? (
            <div className="fw-goal-steps__grid" onInput={(e) => recount(e.currentTarget)}>
              <span className="fw-field">
                <span className="fw-field__label">All days</span>
                <span className="fw-field__help">The points above</span>
              </span>
              {[1, 2, 3].map((m) => (
                <label key={m} className="fw-field">
                  <span className="fw-field__label">{m} missed</span>
                  <input type="hidden" name={`step-${m}-at`} value={m} />
                  <input
                    className="fw-input fw-input--short"
                    name={`step-${m}-amount`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={10000}
                    placeholder="–"
                    defaultValue={missesAmounts[m - 1] ?? ''}
                  />
                </label>
              ))}
            </div>
          ) : (
            <div className="fw-goal-steps__grid">
              <span className="fw-field">
                <span className="fw-field__label">
                  {kind === 'weighted' ? '100%' : `${target.toLocaleString('en-US')} (the target)`}
                </span>
                <span className="fw-field__help">The points above</span>
              </span>
              {[1, 2, 3].map((i) => (
                <span key={i} className="fw-goal-steps__step">
                  <label className="fw-field">
                    <span className="fw-field__label">{kind === 'weighted' ? 'At %' : 'At'}</span>
                    <input
                      className="fw-input fw-input--short"
                      name={`step-${i}-at`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={kind === 'weighted' ? 99 : Math.max(1, target - 1)}
                      defaultValue={steps[i - 1]?.at ?? ''}
                    />
                  </label>
                  <label className="fw-field">
                    <span className="fw-field__label">Pays</span>
                    <input
                      className="fw-input fw-input--short"
                      name={`step-${i}-amount`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={10000}
                      defaultValue={steps[i - 1]?.amount ?? ''}
                    />
                  </label>
                </span>
              ))}
            </div>
          )}
          <span className="fw-field__help">
            The highest step reached pays, not the sum. The top step pays as soon as it is reached;
            a lower step pays when the {period ?? 'goal'} {period ? 'closes' : 'ends'}, or as soon
            as nothing higher can be reached. Steps pay points only.
            {kind === 'misses' ? ' The lowest step sets the misses allowed.' : ''}
            {oneOff ? ' A goal in steps needs an end date.' : ''}
          </span>
        </>
      ) : null}
    </fieldset>
  );
}

/** [RWD-10][US-406] What the change would do, from every check-off; nothing is saved yet. */
function PreviewPanel({ preview }: { preview: GoalPreviewView }) {
  return (
    <section className="fw-goal-preview" aria-labelledby="goal-preview-heading" aria-live="polite">
      <h2 id="goal-preview-heading">Preview</h2>
      {preview.period ? <p className="fw-goal-preview__outcome">{preview.period}</p> : null}
      <p className="fw-goal-preview__outcome">{preview.outcome}</p>
      <div className="fw-goal-preview__table">
        <table>
          <thead>
            <tr>
              <th scope="col">Rule</th>
              {preview.before !== null ? <th scope="col">Now</th> : null}
              <th scope="col">{preview.before !== null ? 'After saving' : 'From what’s done'}</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r, i) => (
              <tr key={i}>
                <th scope="row">{r.text}</th>
                {preview.before !== null ? <td>{r.before ?? 'New or changed'}</td> : null}
                <td>{r.after}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">The goal</th>
              {preview.before !== null ? <td>{preview.before}</td> : null}
              <td>{preview.after}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="fw-muted">Nothing is saved until you save.</p>
    </section>
  );
}

function RuleRow({
  row,
  n,
  weight,
  missesByStep,
  only,
  locked,
  repeat,
  tags,
  items,
  onChange,
  onRemove,
}: {
  row: Row;
  n: number;
  /** [RWD-18] Its weight when the goal pays in steps with two or more rules; null otherwise. */
  weight: number | null;
  /** [RWD-18] The misses allowed set by the steps' lowest; null when the steps don't set it. */
  missesByStep: number | null;
  only: boolean;
  locked: boolean;
  repeat: Repeat;
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
        <input type="hidden" name={name('misses')} value={row.misses ?? 0} />
        <input
          type="hidden"
          name={name('ontime')}
          value={!row.onTime ? 'any' : row.onTime === 'due_time' ? 'due_time' : 'by'}
        />
        <input
          type="hidden"
          name={name('ontime-at')}
          value={row.onTime && row.onTime !== 'due_time' ? row.onTime : ''}
        />
        <input type="hidden" name={name('weight')} value={row.weight ?? ''} />
      </>
    );
  }
  const onChoice = !row.onTime ? 'any' : row.onTime === 'due_time' ? 'due_time' : 'by';
  const daysDue = row.type === 'DAYS_DUE';
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
            {RULE_TYPES.filter((t) => t !== 'DAYS_DUE' || repeat !== 'none').map((t) => (
              <option key={t} value={t}>
                {RULE_WORDS[t].label}
              </option>
            ))}
          </select>
        </label>
        {daysDue ? (
          <>
            {/* [RWD-16] Its target is each period's days due: the database stores 1. */}
            <input type="hidden" name={name('target')} value={1} />
            {missesByStep !== null ? (
              <span className="fw-field">
                <span className="fw-field__label">
                  Misses allowed each {repeat === 'none' ? 'period' : periodWord(repeat)}
                </span>
                <input type="hidden" name={name('misses')} value={missesByStep} />
                <span className="fw-input fw-input--short fw-input--read" aria-readonly="true">
                  {missesByStep}
                </span>
                <span className="fw-field__help">
                  Set by the steps: the lowest is {missesByStep} missed
                </span>
              </span>
            ) : (
              <label className="fw-field">
                <span className="fw-field__label">
                  Misses allowed each {repeat === 'none' ? 'period' : periodWord(repeat)}
                </span>
                <select
                  className="fw-input fw-input--short"
                  name={name('misses')}
                  value={row.misses ?? 0}
                  onChange={(e) => onChange({ misses: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
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
        )}
        {weight !== null ? (
          <label className="fw-field">
            <span className="fw-field__label">Weight (%)</span>
            <input
              className="fw-input fw-input--short"
              name={name('weight')}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              required
              value={weight}
              onChange={(e) => onChange({ weight: Number(e.target.value) })}
            />
          </label>
        ) : null}
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
      {daysDue ? (
        <span className="fw-field__help">
          A day counts when everything it counts that is due that day is done. Each{' '}
          {repeat === 'none' ? 'period' : periodWord(repeat)} needs every day it’s due, less the
          misses allowed: a short week needs only its days.
        </span>
      ) : null}
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
      <fieldset className="fw-fieldset fw-goal-ontime">
        <legend className="fw-field__label">Counts only when done</legend>
        <div className="fw-actions">
          <label className="fw-choice">
            <input
              type="radio"
              name={name('ontime')}
              value="any"
              checked={onChoice === 'any'}
              onChange={() => onChange({ onTime: null })}
            />
            Any time that day
          </label>
          <label className="fw-choice">
            <input
              type="radio"
              name={name('ontime')}
              value="due_time"
              checked={onChoice === 'due_time'}
              onChange={() => onChange({ onTime: 'due_time' })}
            />
            By each chore’s due time
          </label>
          <label className="fw-choice">
            <input
              type="radio"
              name={name('ontime')}
              value="by"
              checked={onChoice === 'by'}
              onChange={() => onChange({ onTime: '18:00' })}
            />
            By a time
          </label>
          {onChoice === 'by' ? (
            <label className="fw-field">
              <span className="fw-field__label">Time</span>
              <input
                className="fw-input fw-input--short"
                type="time"
                name={name('ontime-at')}
                required
                value={row.onTime ?? '18:00'}
                onChange={(e) => onChange({ onTime: e.target.value || '18:00' })}
              />
            </label>
          ) : null}
        </div>
        {onChoice !== 'any' ? (
          <span className="fw-field__help">
            A tick after {onChoice === 'due_time' ? 'its due time' : 'the time'} still completes the
            chore and earns its points; it doesn’t count here. A board offline keeps the tick’s own
            time; a parent’s tick after the time doesn’t count either.
            {onChoice === 'due_time' ? ' A chore without a due time counts any time that day.' : ''}
          </span>
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
