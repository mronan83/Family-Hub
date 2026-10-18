'use client';

import type { Repeat, RuleType } from '@familywise/rules-engine';
import {
  Avatar,
  type AvatarKey,
  Banner,
  Button,
  DatePick,
  dateWords,
  FileField,
  Icon,
  IconPicker,
  type IconName,
  type MemberColor,
} from '@familywise/ui';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormAction } from '@/lib/forms';
import { periodWord, REPEAT_WORDS } from '@/lib/goal-periods';
import { type LowerStep, type StepKind, stepKind } from '@/lib/goal-steps';
import {
  type GoalSummaries,
  partsText,
  ruleProblem,
  ruleSummaryParts,
  scopeParts,
  type SummaryNames,
  type SummaryPart,
} from '@/lib/goal-summaries';
import {
  EACH_CHILD_FIELD,
  type GoalPayout,
  REPEATS,
  RULE_TYPES,
  RULE_WORDS,
  type ScopeChoice,
} from '@/lib/goals';
import { LIVE_PATH, liveFrom } from '@/lib/goal-live';
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
  /** [RWD-19] Weeks won: the repeating goal it counts, and in a row (else in total). */
  source?: string | null;
  inARow?: boolean;
}

/** [RWD-19] A repeating goal a rule may count: its person (null, the family's) and how it repeats. */
export interface CountableGoal {
  id: string;
  title: string;
  memberId: string | null;
  repeat: Exclude<Repeat, 'none'>;
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
  /** [RWD-20] A family goal every child meets. */
  eachChild?: boolean;
  rules: GoalFormRule[];
  payout: GoalPayout;
}

/** [NFR-16][D-128] An item a rule may count, with its picture. */
export interface GoalItem {
  id: string;
  title: string;
  icon?: IconName | null;
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

/**
 * A rule's key names its fields (`rule-<key>-<field>`). It is the same on the server and in the
 * browser, so the fields the server drew keep the names `rule-keys` lists once the page hydrates (a
 * counter shared by every render gave the server's fields other names, WP-101): the rules a form
 * starts with are r1, r2…, and each rule added takes the next number.
 */
const keyOf = (n: number) => `r${n}`;

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
  countable = [],
  livePath = LIVE_PATH,
  draft,
}: {
  id: string;
  initial?: GoalFormInitial;
  members: { id: string; displayName: string; avatarKey: AvatarKey | null; color: MemberColor }[];
  tags: { id: string; name: string }[];
  /** [NFR-16][D-128] Each item with its picture, shown beside its name (WP-101). */
  items: GoalItem[];
  prizes: GoalPrize[];
  today: string;
  lock?: GoalLock;
  hasPhoto?: boolean;
  /** A preview to show at first (the made-up /dev/goals page). */
  preview?: GoalPreviewView;
  /** [RWD-19] The repeating goals a rule may count (not this one, nor one that counts weeks). */
  countable?: CountableGoal[];
  /** A new goal's fields filled in already (the made-up /dev/goals page draws a mockup's frame). */
  draft?: GoalFormInitial;
  /**
   * [NFR-16][D-128] Where the live summaries are worked out from the form as it stands, as Preview
   * does (the /dev pages ask a stand-in on made-up facts).
   */
  livePath?: string;
}) {
  const [state, onSubmit, pending] = useFormAction<GoalFormState>(saveGoal, { preview });
  const seed = initial ?? draft;
  const [rows, setRows] = useState<Row[]>(() =>
    (seed?.rules.length ? seed.rules : [NEW_RULE]).map((r, i) => ({ ...r, key: keyOf(i + 1) })),
  );
  const added = useRef(rows.length);
  const change = (key: string, patch: Partial<GoalFormRule>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // [NFR-16][D-128] The rules open to their fields: a new goal's first rule, each one added, and each
  // one tapped, until its Done folds it; any number at once (the owner's choice). A rule with
  // something to fix stays open whatever.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(
    () => new Set(initial || !rows[0] ? [] : [rows[0].key]),
  );
  const setOpen = (key: string, on: boolean) =>
    setOpenKeys((ks) => {
      const next = new Set(ks);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const [start, setStart] = useState(seed?.startDate ?? today);
  const rulesLocked = lock === 'finished';
  const whoLocked = lock !== 'none';
  const [who, setWho] = useState(seed ? (seed.memberId ?? 'family') : (members[0]?.id ?? 'family'));
  // [RWD-15] How it repeats: chosen until it starts, then fixed (D-123).
  const [repeat, setRepeat] = useState<Repeat>(seed?.repeat ?? 'none');
  const chooseRepeat = (r: Repeat) => {
    setRepeat(r);
    // Every day it's due is for a goal that repeats.
    if (r === 'none') {
      setRows((rs) => rs.map((x) => (x.type === 'DAYS_DUE' ? { ...x, type: 'COUNT' } : x)));
    }
  };
  // [RWD-20] Every child meets it: a family goal's option, fixed once it starts (D-126).
  const [eachChild, setEachChild] = useState(seed?.eachChild ?? false);
  const family = who === 'family';
  const each = family && eachChild;
  // [RWD-19] The goals this person's (or the family's) rule may count.
  const canCount = countable.filter((c) => c.memberId === (family ? null : who) && c.id !== id);
  // A rule counting weeks counts this person's goals: with none to count, it becomes things done.
  const chooseWho = (next: string) => {
    setWho(next);
    const owner = next === 'family' ? null : next;
    if (!countable.some((c) => c.memberId === owner && c.id !== id)) {
      setRows((rs) => rs.map((x) => (x.type === 'PERIODS_WON' ? { ...x, type: 'COUNT' } : x)));
    }
  };
  const [pays, setPays] = useState<'custom' | 'points' | 'item'>(
    PAYOUT_CHOICE[seed?.payout.type ?? 'custom'],
  );
  // [RWD-18] Pay in steps (points only); with two or more rules, each rule's weight.
  const initialSteps = seed?.payout.type === 'points' ? (seed.payout.steps ?? []) : [];
  const [stepsOn, setStepsOn] = useState(initialSteps.length > 0);
  const kind = stepKind(rows);
  const inSteps = pays === 'points' && stepsOn && !each;
  const weighted = inSteps && rows.length > 1;
  const [lowest, setLowest] = useState<number>(
    initialSteps.at(-1)?.misses ?? (rows[0]?.misses || 1),
  );
  const label = initial ? `Edit ${initial.title}` : 'Set a goal';

  // [NFR-16][D-128] The live summaries, worked out as Preview works them out each time the form
  // changes (a short pause first, so typing sends one request); a late answer never replaces a newer.
  const formRef = useRef<HTMLFormElement>(null);
  const [summaries, setSummaries] = useState<GoalSummaries | null>(
    () => preview?.summaries ?? null,
  );
  const asked = useRef(0);
  // Whether the first summaries have come back: the form says so (data-live), for its screenshots.
  const [answered, setAnswered] = useState(rulesLocked);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // [WP-110] Asked for with fetch, not a server action, so the save never waits behind one; the
  // one still out when a newer is asked for is dropped.
  const live = useMemo(() => liveFrom(livePath), [livePath]);
  const out = useRef<AbortController | null>(null);
  const refresh = useCallback(() => {
    if (rulesLocked) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const form = formRef.current;
      if (!form) return;
      const n = (asked.current += 1);
      const data = new FormData(form);
      data.delete('photo');
      out.current?.abort();
      const request = new AbortController();
      out.current = request;
      live(data, request.signal).then(
        (out) => {
          if (n !== asked.current) return;
          setSummaries(out);
          setAnswered(true);
        },
        () => {
          if (n !== asked.current) return;
          setSummaries(null);
          setAnswered(true);
        },
      );
    }, 300);
  }, [live, rulesLocked]);
  useEffect(() => {
    refresh();
  }, [refresh, rows, who, repeat, eachChild, pays, stepsOn, lowest, start]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      out.current?.abort();
    },
    [],
  );
  const names: SummaryNames = { tags, items, goals: countable };
  const points = seed?.payout.type === 'points' ? seed.payout.amount : 10;
  const prize = seed?.payout.type === 'catalog_item' ? seed.payout.item_id : prizes[0]?.id;

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      onInput={refresh}
      data-live={answered ? 'ready' : 'waiting'}
      className="fw-form"
      aria-label={label}
      encType="multipart/form-data"
    >
      <input type="hidden" name="id" value={id} />
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="title"
          maxLength={80}
          required
          defaultValue={seed?.title ?? ''}
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
          defaultValue={seed?.description ?? ''}
          autoComplete="off"
        />
      </label>

      {whoLocked ? (
        <div className="fw-fgrid">
          {/* [NFR-16][D-127] Fixed once it starts: shown as the mockup draws them, not editable. */}
          <input type="hidden" name="member" value={who} />
          <ReadField label="Who it’s for">
            {family
              ? 'The whole family'
              : (members.find((m) => m.id === who)?.displayName ?? 'Someone')}
          </ReadField>
          <ReadField label="Repeats">{REPEAT_WORDS[repeat]}</ReadField>
        </div>
      ) : (
        <fieldset className="fw-field fw-fieldset">
          <legend className="fw-field__label">Who it’s for</legend>
          <div className="fw-choices">
            {members.map((m) => (
              <label key={m.id} className="fw-choice">
                <input
                  type="radio"
                  name="member"
                  value={m.id}
                  checked={who === m.id}
                  onChange={() => chooseWho(m.id)}
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
            <label className="fw-choice">
              <input
                type="radio"
                name="member"
                value="family"
                checked={who === 'family'}
                onChange={() => {
                  chooseWho('family');
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

      <input type="hidden" name={EACH_CHILD_FIELD} value="on" />
      {family && whoLocked ? (
        eachChild ? (
          <input type="hidden" name="eachChild" value="on" />
        ) : null
      ) : family ? (
        <fieldset className="fw-box" aria-label="For the whole family">
          <legend>For the whole family</legend>
          <label className="fw-choice">
            <input
              type="checkbox"
              name="eachChild"
              value="on"
              checked={eachChild}
              onChange={(e) => {
                setEachChild(e.target.checked);
                if (e.target.checked) {
                  setStepsOn(false);
                  setRows((rs) =>
                    rs.map((x) => (x.type === 'PERIODS_WON' ? { ...x, type: 'COUNT' } : x)),
                  );
                }
              }}
            />
            Every child meets it: each child who earns rewards does it on their own
          </label>
          <span className="fw-field__help">
            Each child needs it on their own. A child with nothing due doesn’t hold it back, and
            only the children with something due are paid. Fixed once the goal starts.
          </span>
        </fieldset>
      ) : null}

      {whoLocked ? (
        <input type="hidden" name="repeat" value={repeat} />
      ) : (
        <fieldset className="fw-box">
          <legend>Repeats</legend>
          <div className="fw-seg">
            {REPEATS.map((r) => (
              <label key={r} className="fw-seg__item">
                <input
                  type="radio"
                  className="fw-seg__input"
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

      <div className="fw-fgrid">
        {whoLocked ? (
          <>
            <input type="hidden" name="startDate" value={seed?.startDate ?? today} />
            <ReadField label="Starts">{dateWords(seed?.startDate ?? today)}</ReadField>
          </>
        ) : (
          <label className="fw-field">
            <span className="fw-field__label">Starts</span>
            <DatePick
              type="date"
              name="startDate"
              label="Starts"
              required
              initial={seed?.startDate ?? today}
              value={start}
              onValue={setStart}
            />
          </label>
        )}
        {rulesLocked ? (
          <input type="hidden" name="endDate" value={seed?.endDate ?? ''} />
        ) : (
          <EndDateField
            initial={seed?.endDate ?? null}
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
          countable={each ? [] : canCount}
          names={names}
          open={openKeys.has(r.key)}
          onOpen={(on) => setOpen(r.key, on)}
          summary={summaries?.rules[i] ?? null}
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
            onClick={() => {
              // A new rule opens to its fields; the others stay as they are.
              const key = keyOf((added.current += 1));
              setRows((rs) => [...rs, { ...NEW_RULE, key }]);
              setOpen(key, true);
            }}
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
          <input type="hidden" name="logic" value={seed?.logic ?? 'all'} />
        ) : (
          <fieldset className="fw-field fw-fieldset">
            <legend className="fw-field__label">It’s reached when</legend>
            <div className="fw-choices">
              <label className="fw-choice">
                <input
                  type="radio"
                  name="logic"
                  value="all"
                  defaultChecked={(seed?.logic ?? 'all') === 'all'}
                />
                Every rule is met
              </label>
              <label className="fw-choice">
                <input
                  type="radio"
                  name="logic"
                  value="any"
                  defaultChecked={seed?.logic === 'any'}
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
        noSteps={each}
      />

      <IconPicker
        legend="Icon, shown when there’s no photo"
        selected={seed?.icon ?? 'trophy'}
        start="rewards"
      />
      <FileField
        label={hasPhoto ? 'A new photo (optional)' : 'Photo (optional)'}
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        button="Choose a photo"
        empty="No photo chosen"
        help="JPEG, PNG or WebP, up to 2 MB."
      />

      {summaries?.steps ? (
        <p className="fw-callout" data-testid="steps-summary" aria-live="polite">
          {summaries.steps}
        </p>
      ) : null}
      {weighted && summaries?.weights ? (
        <p className="fw-callout" data-testid="weights-summary" aria-live="polite">
          {summaries.weights}
        </p>
      ) : null}
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      {state.preview && !state.message ? <PreviewPanel preview={state.preview} /> : null}
      <div className="fw-actions">
        <Button type="submit" icon="check" disabled={pending}>
          {initial ? 'Save changes' : 'Set the goal'}
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
        {initial ? null : (
          <Link className="fw-btn fw-btn--ghost" href="/admin/goals">
            Cancel
          </Link>
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
  noSteps = false,
}: {
  /** [RWD-20] Every child meets it: no steps (D-126). */
  noSteps?: boolean;
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
    <fieldset className="fw-box">
      <legend>
        {repeat === 'none' ? 'What reaching it pays' : `What each ${periodWord(repeat)} pays`}
      </legend>
      <div className="fw-choices">
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
        {pays === 'points' ? (
          <input
            className="fw-input fw-input--points"
            name="payoutPoints"
            type="number"
            inputMode="numeric"
            aria-label="Points paid"
            min={1}
            max={10000}
            required
            defaultValue={points}
          />
        ) : null}
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
        <label className="fw-choice">
          <input
            type="radio"
            name="payout"
            value="custom"
            checked={pays === 'custom'}
            onChange={() => onPays('custom')}
          />
          Something else
        </label>
      </div>
      {pays === 'points' && noSteps ? (
        <span className="fw-field__help">
          Pay in steps isn’t offered when every child meets it.
        </span>
      ) : pays === 'points' ? (
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
    <fieldset className="fw-box fw-goal-steps" aria-label="Pay in steps">
      <legend>Pay in steps</legend>
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

interface RuleRowProps {
  /** [RWD-19] The repeating goals it may count. */
  countable: CountableGoal[];
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
  items: GoalItem[];
  /** [NFR-16][D-128] Names and pictures for its summary line. */
  names: SummaryNames;
  /** [NFR-16][D-128] Open to its fields (on a goal with two or more rules), or its What counts open. */
  open: boolean;
  onOpen: (open: boolean) => void;
  /** [NFR-16][D-128] Its live summary: its days due this period, or the weeks it counts. */
  summary: string | null;
  onChange: (patch: Partial<GoalFormRule>) => void;
  onRemove: () => void;
}

/**
 * A rule of the goal. [NFR-16][D-128] On a goal with two or more rules each folds to one summary
 * line, "Rule 1 · weight" with its weight beside it (the WP-81 addendum), and opens to its fields on a
 * tap, and folds again with Done; any number may be open at once. A new rule and a rule with
 * something to fix are open. A folded rule sends
 * every field as it stands, so saving is the same folded or open.
 */
function RuleRow(props: RuleRowProps) {
  const { row, n, weight, only, locked, names, open, onOpen, onChange } = props;
  if (locked) {
    // A finished goal's rules stay as they are; they are sent back unchanged.
    return <RuleFields row={row} />;
  }
  const problem = ruleProblem({ ...row, weight }, weight !== null);
  if (!only && !open && !problem) {
    const parts = ruleSummaryParts(row, names);
    const name = (field: string) => `rule-${row.key}-${field}`;
    return (
      <fieldset className="fw-box fw-goal-rule" data-folded="true">
        <legend>{weight !== null ? `Rule ${n} · weight` : `Rule ${n}`}</legend>
        <RuleFields row={row} weight={weight === null} />
        <div className="fw-goal-rule__sum">
          <span className="fw-field">
            <span className="fw-field__label" id={name('counts')}>
              Counts
            </span>
            <button
              type="button"
              className="fw-input fw-goal-rule__line"
              aria-expanded="false"
              aria-labelledby={`${name('counts')} ${name('line')}`}
              onClick={() => onOpen(true)}
            >
              <SummaryLine id={name('line')} parts={parts} />
            </button>
          </span>
          {weight !== null ? (
            <WeightField name={name('weight')} n={n} weight={weight} onChange={onChange} />
          ) : null}
        </div>
      </fieldset>
    );
  }
  if (row.type === 'PERIODS_WON') return <CountedRule {...props} problem={problem} />;
  return <OpenRule {...props} problem={problem} />;
}

/** [NFR-16][D-128] A summary line's words, each item with its picture beside its name. */
function SummaryLine({ id, parts }: { id?: string; parts: readonly SummaryPart[] }) {
  return (
    <span id={id} className="fw-goal-rule__words" aria-label={partsText(parts)}>
      {parts.map((p, i) => {
        // A space between pieces, but none before a comma.
        const gap = i > 0 && !(typeof p === 'string' && p.startsWith(',')) ? ' ' : '';
        return typeof p === 'string' ? (
          <span key={i}>{`${gap}${p}`}</span>
        ) : (
          <span key={i}>
            {gap}
            <ItemName icon={p.icon} title={p.text} />
          </span>
        );
      })}
    </span>
  );
}

/** [NFR-16][D-128] An item's picture beside its name. */
function ItemName({ icon, title }: { icon?: string | null; title: string }) {
  return (
    <span className="fw-item-pic">
      {icon ? <Icon name={icon as IconName} size={20} /> : null}
      {title}
    </span>
  );
}

/** [RWD-18] A rule's weight, "Weight" with "60%" in its field (the WP-81 addendum). */
function WeightField({
  name,
  n,
  weight,
  onChange,
}: {
  name: string;
  n: number;
  weight: number;
  onChange: (patch: Partial<GoalFormRule>) => void;
}) {
  return (
    <label className="fw-field fw-goal-rule__weight">
      <span className="fw-field__label">Weight</span>
      <span className="fw-pct">
        <input
          className="fw-input"
          name={name}
          type="number"
          inputMode="numeric"
          aria-label={`Weight of rule ${n}, in %`}
          min={1}
          max={100}
          required
          value={weight}
          onChange={(e) => onChange({ weight: Number(e.target.value) })}
        />
      </span>
    </label>
  );
}

/**
 * Every field of a rule as hidden fields: a finished goal's rules sent back unchanged, or a folded
 * rule's as it stands (its weight, shown beside the line, is sent by that field unless `weight`).
 */
function RuleFields({ row, weight = true }: { row: Row; weight?: boolean }) {
  const name = (field: string) => `rule-${row.key}-${field}`;
  return (
    <>
      <input type="hidden" name={name('type')} value={row.type} />
      <input type="hidden" name={name('target')} value={row.type === 'DAYS_DUE' ? 1 : row.target} />
      <ScopeFields row={row} />
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
      {weight ? <input type="hidden" name={name('weight')} value={row.weight ?? ''} /> : null}
      <input type="hidden" name={name('source')} value={row.source ?? ''} />
      <input type="hidden" name={name('row')} value={row.inARow ? 'row' : 'total'} />
    </>
  );
}

/** What a rule counts, as hidden fields. */
function ScopeFields({ row }: { row: Row }) {
  const name = (field: string) => `rule-${row.key}-${field}`;
  return (
    <>
      <input type="hidden" name={name('scope')} value={row.scope} />
      {row.tagIds.map((t) => (
        <input key={t} type="hidden" name={name('tag')} value={t} />
      ))}
      {row.itemIds.map((t) => (
        <input key={t} type="hidden" name={name('item')} value={t} />
      ))}
    </>
  );
}

/** Folds a rule back to its summary line, on a goal with two or more rules. */
function FoldButton({ n, onOpen }: { n: number; onOpen: (open: boolean) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      icon="chevron-down"
      onClick={() => onOpen(false)}
      aria-label={`Done with rule ${n}`}
    >
      Done
    </Button>
  );
}

function OpenRule({
  row,
  n,
  weight,
  missesByStep,
  only,
  repeat,
  tags,
  items,
  names,
  open,
  onOpen,
  summary,
  onChange,
  onRemove,
  countable,
  problem,
}: RuleRowProps & { problem: string | null }) {
  const name = (field: string) => `rule-${row.key}-${field}`;
  const onChoice = !row.onTime ? 'any' : row.onTime === 'due_time' ? 'due_time' : 'by';
  const daysDue = row.type === 'DAYS_DUE';
  // [NFR-16][D-128] A single rule's What counts folds to one line ("Some items: Homework home") until
  // it is tapped, as the frames draw it; a new goal's, or one with nothing chosen, is open.
  const scopeOpen = !only || open || problem !== null;
  const toggle = (list: string[], id: string, on: boolean) =>
    on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
  return (
    <fieldset className="fw-box fw-goal-rule">
      <legend>{only ? 'Rule' : weight !== null ? `Rule ${n} · weight` : `Rule ${n}`}</legend>
      <div className="fw-fgrid">
        <label className="fw-field">
          <span className="fw-field__label">Counts</span>
          <select
            className="fw-input"
            name={name('type')}
            value={row.type}
            onChange={(e) => onChange({ type: e.target.value as RuleType })}
          >
            {RULE_TYPES.filter(
              (t) =>
                (t !== 'DAYS_DUE' || repeat !== 'none') &&
                (t !== 'PERIODS_WON' || countable.length > 0),
            ).map((t) => (
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
          <WeightField name={name('weight')} n={n} weight={weight} onChange={onChange} />
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
      {scopeOpen ? (
        <fieldset className="fw-fieldset">
          <legend className="fw-field__label">What counts</legend>
          <div className="fw-choices">
            {(['all', 'tags', 'items'] as const).map((sc) => (
              <label key={sc} className="fw-choice">
                <input
                  type="radio"
                  name={name('scope')}
                  value={sc}
                  checked={row.scope === sc}
                  onChange={() => onChange({ scope: sc })}
                  disabled={
                    (sc === 'tags' && tags.length === 0) || (sc === 'items' && items.length === 0)
                  }
                />
                {SCOPE_WORDS[sc]}
              </label>
            ))}
          </div>
          {row.scope === 'tags' ? (
            <div className="fw-choices" role="group" aria-label={`Tags for rule ${n}`}>
              {tags.map((t) => (
                <label key={t.id} className="fw-choice">
                  <input
                    type="checkbox"
                    name={name('tag')}
                    value={t.id}
                    checked={row.tagIds.includes(t.id)}
                    onChange={(e) =>
                      onChange({ tagIds: toggle(row.tagIds, t.id, e.target.checked) })
                    }
                  />
                  {t.name}
                </label>
              ))}
            </div>
          ) : null}
          {row.scope === 'items' ? (
            <div className="fw-choices" role="group" aria-label={`Items for rule ${n}`}>
              {items.map((t) => (
                <label key={t.id} className="fw-choice">
                  <input
                    type="checkbox"
                    name={name('item')}
                    value={t.id}
                    checked={row.itemIds.includes(t.id)}
                    onChange={(e) =>
                      onChange({ itemIds: toggle(row.itemIds, t.id, e.target.checked) })
                    }
                  />
                  <ItemName icon={t.icon} title={t.title} />
                </label>
              ))}
            </div>
          ) : null}
          {only && !problem && open ? (
            <div className="fw-actions">
              <FoldButton n={n} onOpen={onOpen} />
            </div>
          ) : null}
        </fieldset>
      ) : (
        <span className="fw-field">
          <span className="fw-field__label" id={name('what')}>
            What counts
          </span>
          <ScopeFields row={row} />
          <button
            type="button"
            className="fw-input fw-goal-rule__line"
            aria-expanded="false"
            aria-labelledby={`${name('what')} ${name('what-line')}`}
            onClick={() => onOpen(true)}
          >
            <SummaryLine id={name('what-line')} parts={scopeParts(row, names)} />
          </button>
        </span>
      )}
      {problem ? (
        <p className="fw-field__help fw-goal-rule__problem" role="status">
          {problem}
        </p>
      ) : null}
      {summary ? (
        <p className="fw-callout" data-testid={`rule-${n}-summary`} aria-live="polite">
          {summary}
        </p>
      ) : null}
      <fieldset className="fw-box fw-goal-ontime">
        <legend>Counts only when done</legend>
        <div className="fw-choices">
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
            By
          </label>
          {onChoice === 'by' ? (
            <DatePick
              type="time"
              className="fw-pick--clock"
              name={name('ontime-at')}
              label="Time"
              required
              initial={row.onTime ?? '18:00'}
              value={row.onTime ?? '18:00'}
              onValue={(t) => onChange({ onTime: t || '18:00' })}
            />
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
          {problem ? null : <FoldButton n={n} onOpen={onOpen} />}
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

/**
 * [RWD-19] Weeks won of a repeating goal (the approved mockup and addendum): the target, which goal
 * (this person's repeating goals, or the family's), and in total or in a row. It counts no items of
 * its own, and only the weeks that start on or after this goal's start date (D-126).
 */
function CountedRule({
  row,
  n,
  only,
  countable,
  onOpen,
  summary,
  onChange,
  onRemove,
}: RuleRowProps & { problem: string | null }) {
  const name = (field: string) => `rule-${row.key}-${field}`;
  const source = countable.find((c) => c.id === row.source) ?? countable[0];
  const unit = source ? periodWord(source.repeat, 2) : 'weeks';
  return (
    <fieldset className="fw-box fw-goal-rule">
      <legend>{only ? 'Rule' : `Rule ${n}`}</legend>
      <div className="fw-fgrid">
        <label className="fw-field">
          <span className="fw-field__label">Counts</span>
          <select
            className="fw-input"
            name={name('type')}
            value={row.type}
            onChange={(e) => onChange({ type: e.target.value as RuleType })}
          >
            {RULE_TYPES.filter((t) => t !== 'DAYS_DUE').map((t) => (
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
      </div>
      <label className="fw-field">
        <span className="fw-field__label">Which goal</span>
        <select
          className="fw-input"
          name={name('source')}
          value={source?.id ?? ''}
          required
          onChange={(e) => onChange({ source: e.target.value })}
        >
          {countable.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} ({REPEAT_WORDS[c.repeat].toLowerCase()})
            </option>
          ))}
        </select>
      </label>
      <fieldset className="fw-fieldset">
        <legend className="fw-field__label">How</legend>
        <div className="fw-choices">
          <label className="fw-choice">
            <input
              type="radio"
              name={name('row')}
              value="total"
              checked={!row.inARow}
              onChange={() => onChange({ inARow: false })}
            />
            In total
          </label>
          <label className="fw-choice">
            <input
              type="radio"
              name={name('row')}
              value="row"
              checked={!!row.inARow}
              onChange={() => onChange({ inARow: true })}
            />
            In a row
          </label>
        </div>
        <span className="fw-field__help">
          A {source ? periodWord(source.repeat) : 'week'} with nothing due neither counts nor breaks
          the run; a missed one breaks it. Only {unit} that start on or after this goal’s start date
          count.
        </span>
      </fieldset>
      {summary ? (
        <p className="fw-callout" data-testid={`rule-${n}-summary`} aria-live="polite">
          {summary}
        </p>
      ) : null}
      {only ? null : (
        <div className="fw-actions">
          <FoldButton n={n} onOpen={onOpen} />
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

/** [NFR-16][D-127] A field that can't change any more, shown as a field without its edge. */
function ReadField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="fw-field">
      <span className="fw-field__label">{label}</span>
      <span className="fw-input fw-input--read" aria-readonly="true">
        {children}
      </span>
    </span>
  );
}
