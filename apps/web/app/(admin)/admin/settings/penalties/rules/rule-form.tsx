'use client';

import { Avatar, Banner, Button, DatePick } from '@familywise/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import { amountInput, type PenaltyReason } from '@/lib/penalties';
import {
  MAX_RULE_NAME,
  type PenaltyRule,
  type RuleChore,
  type RuleScope,
} from '@/lib/penalty-rules';
import { saveRule } from '../../../penalties/actions';
import type { PenaltyPerson } from '../../../penalties/give-form';

export type RulePerson = PenaltyPerson;

const SCOPES: { scope: RuleScope; label: string }[] = [
  { scope: 'items', label: 'Chosen items' },
  { scope: 'tag', label: 'A tag' },
  { scope: 'all', label: 'All their items' },
];

/**
 * [PTS-10][US-1112] The penalty rule form (WP-121, the approved mockup): its name, a reason from the
 * household's list (which sets points or money), who it is for, what counts as a miss (chosen items, a
 * tag, or all their items), its start and end dates, what each miss adds and the most it can have on a
 * person. A new rule starts today or later.
 */
export function RuleForm({
  rule,
  reasons,
  people,
  chores,
  tags,
  today,
  on,
}: {
  rule: PenaltyRule | null;
  reasons: PenaltyReason[];
  people: RulePerson[];
  chores: RuleChore[];
  tags: { id: string; name: string }[];
  today: string;
  on: boolean;
}) {
  const [state, onSubmit, pending] = useFormAction(saveRule, {} as FormState);
  const [reasonId, setReasonId] = useState(rule?.reasonId ?? reasons[0]?.id ?? '');
  const reason = reasons.find((r) => r.id === reasonId) ?? null;
  const unit = reason?.unit ?? rule?.unit ?? 'money';
  const [name, setName] = useState(rule?.name ?? '');
  const [named, setNamed] = useState(Boolean(rule));
  const [who, setWho] = useState<string[]>(rule?.memberIds ?? []);
  const [scope, setScope] = useState<RuleScope>(rule?.scope ?? 'items');
  const [picked, setPicked] = useState<string[]>(rule?.chores.map((c) => c.id) ?? []);
  const [start, setStart] = useState(rule?.startDate ?? today);
  const [end, setEnd] = useState(rule?.endDate ?? '');
  const [amount, setAmount] = useState(
    rule
      ? amountInput(rule.unit, rule.amount)
      : reason
        ? amountInput(reason.unit, reason.amount)
        : '',
  );
  const [max, setMax] = useState(rule ? amountInput(rule.unit, rule.max) : '');
  // The items listed: those of the people chosen (or every chore while nobody is), and any linked.
  const listed = chores.filter(
    (c) => picked.includes(c.id) || who.length === 0 || c.assignees.some((a) => who.includes(a)),
  );
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  const chooseReason = (id: string) => {
    setReasonId(id);
    const r = reasons.find((x) => x.id === id);
    if (!r) return;
    if (!named) setName(r.name);
    setAmount(amountInput(r.unit, r.amount));
  };
  const each = Number.isFinite(Number(amount)) && amount ? amount : '1';
  const money = unit === 'money';

  return (
    <form onSubmit={onSubmit} className="fw-form fw-rule" aria-label="Penalty rule">
      {rule ? <input type="hidden" name="ruleId" value={rule.id} /> : null}
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          value={name}
          maxLength={MAX_RULE_NAME}
          placeholder="Like “Folder home”"
          onChange={(e) => {
            setName(e.target.value);
            setNamed(true);
          }}
          required
          autoComplete="off"
        />
        <span className="fw-field__help">What the board and a child’s page call it.</span>
      </label>

      <div className="fw-field">
        <label className="fw-field__label" htmlFor="rule-reason">
          Reason
        </label>
        <select
          id="rule-reason"
          className="fw-input"
          name="reasonId"
          value={reasonId}
          onChange={(e) => chooseReason(e.target.value)}
          required
        >
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">For</legend>
        <div className="fw-choices">
          {people.map((p) => (
            <label key={p.id} className="fw-choice">
              <input
                type="checkbox"
                name="memberId"
                value={p.id}
                checked={who.includes(p.id)}
                onChange={() => setWho((w) => toggle(w, p.id))}
              />
              <Avatar
                name={p.displayName}
                avatarKey={p.avatarKey}
                color={p.color}
                size={32}
                decorative
              />
              {p.displayName}
            </label>
          ))}
        </div>
        {people.length === 0 ? (
          <span className="fw-field__help">
            Nobody earns rewards yet, so nobody can have a rule.
          </span>
        ) : null}
      </fieldset>

      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Counts a miss of</legend>
        <div className="fw-choices">
          {SCOPES.map((s) => (
            <label key={s.scope} className="fw-choice">
              <input
                type="radio"
                name="scope"
                value={s.scope}
                checked={scope === s.scope}
                onChange={() => setScope(s.scope)}
              />
              {s.label}
            </label>
          ))}
        </div>
        {scope === 'items' ? (
          <div className="fw-rule__items" role="group" aria-label="Items">
            {listed.length === 0 ? (
              <span className="fw-field__help">No chores for them yet.</span>
            ) : (
              listed.map((c) => (
                <label key={c.id} className="fw-check">
                  <input
                    type="checkbox"
                    name="choreId"
                    value={c.id}
                    checked={picked.includes(c.id)}
                    onChange={() => setPicked((x) => toggle(x, c.id))}
                  />
                  <span>
                    {c.title}
                    {c.schoolDays ? <span className="fw-muted"> · school days</span> : null}
                  </span>
                </label>
              ))
            )}
          </div>
        ) : scope === 'tag' ? (
          <div className="fw-field">
            <label className="fw-field__label" htmlFor="rule-tag">
              Tag
            </label>
            <select
              id="rule-tag"
              className="fw-input"
              name="tagId"
              defaultValue={rule?.tagId ?? ''}
              required
            >
              <option value="" disabled>
                Choose a tag
              </option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <span className="fw-field__help">
            Every chore of theirs counts. A task is never missed.
          </span>
        )}
      </fieldset>

      <div className="fw-fgrid">
        <label className="fw-field">
          <span className="fw-field__label">Starts</span>
          <DatePick
            type="date"
            name="startDate"
            label="Starts"
            required
            min={rule && rule.startDate < today ? rule.startDate : today}
            initial={rule?.startDate ?? today}
            value={start}
            onValue={setStart}
          />
        </label>
        <label className="fw-field">
          <span className="fw-field__label">Ends</span>
          <DatePick
            type="date"
            name="endDate"
            label="Ends"
            required
            min={start}
            initial={rule?.endDate ?? ''}
            value={end}
            onValue={setEnd}
          />
        </label>
      </div>

      <div className="fw-field">
        <label className="fw-field__label" htmlFor="rule-amount">
          Each miss adds
        </label>
        <span className="fw-penalty__amount">
          {money ? <span aria-hidden>$</span> : null}
          <input
            id="rule-amount"
            className="fw-input"
            name="amount"
            inputMode={money ? 'decimal' : 'numeric'}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoComplete="off"
          />
          <span className="fw-seg" aria-label="Points or money">
            {(['points', 'money'] as const).map((u) => (
              <span key={u} className="fw-seg__item" data-on={unit === u}>
                {u === 'points' ? 'Points' : 'Money'}
              </span>
            ))}
          </span>
        </span>
        <span className="fw-field__help">Points or money comes from the reason.</span>
      </div>

      <label className="fw-field">
        <span className="fw-field__label">Max owed</span>
        <span className="fw-penalty__amount">
          {money ? <span aria-hidden>$</span> : null}
          <input
            className="fw-input"
            name="max"
            inputMode={money ? 'decimal' : 'numeric'}
            value={max}
            onChange={(e) => setMax(e.target.value)}
            required
            autoComplete="off"
          />
        </span>
      </label>

      <ul className="fw-rule__never">
        <li>A skipped or covered day, a day off or a no-school day adds nothing.</li>
        <li>
          Mark done on time on a missed day takes its{' '}
          {money ? `$${each}` : `${each} ${each === '1' ? 'point' : 'points'}`} back.
        </li>
        <li>After the end date nothing is added; what’s owed stays until it’s paid.</li>
      </ul>

      {!on ? <Banner kind="notice">Penalties are off. Turn them on to save a rule.</Banner> : null}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" disabled={pending || !on} icon="check">
          Save the rule
        </Button>
        <Link href="/admin/settings/penalties#rules">Cancel</Link>
      </div>
    </form>
  );
}
