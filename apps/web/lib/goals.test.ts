import { ENGINE_VERSION, type OccurrenceFact } from '@familywise/rules-engine';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  describeRule,
  evaluateAfterCompletions,
  evaluateHouseholdGoals,
  evaluateRead,
  evaluateStoredGoal,
  eventWords,
  goalPayload,
  goalRefusal,
  ordinal,
  parseGoalForm,
  payoutWords,
  previewGoal,
  previewOutcome,
  streakLine,
} from './goals';

const GOAL = '0de00000-0000-4000-8000-000000060001';
const LEO = '0de00000-0000-4000-8000-0000000000b1';
const MORNING = '0de00000-0000-4000-8000-0000000a0001';
const KITCHEN = '0de00000-0000-4000-8000-0000000a0002';
const BED = '0de00000-0000-4000-8000-0000000c0001';
const ctx = { icons: ['trophy', 'ticket'], memberIds: [LEO] };

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const base: [string, string][] = [
  ['id', GOAL],
  ['title', ' Movie night '],
  ['description', ''],
  ['member', LEO],
  ['startDate', '2026-10-03'],
  ['endDate', '2026-10-17'],
  ['icon', 'ticket'],
];

describe('the goal form', () => {
  it('[RWD-01][RWD-02][RWD-03] reads a goal with two rules in the order given', () => {
    const parsed = parseGoalForm(
      form([
        ...base,
        ['logic', 'any'],
        ['rule-keys', 'r2,r1'],
        ['rule-r1-type', 'STREAK'],
        ['rule-r1-target', '5'],
        ['rule-r1-scope', 'all'],
        ['rule-r1-grace', '2'],
        ['rule-r2-type', 'COUNT'],
        ['rule-r2-target', '20'],
        ['rule-r2-scope', 'tags'],
        ['rule-r2-tag', KITCHEN],
        ['rule-r2-tag', MORNING],
        ['rule-r2-tag', MORNING],
      ]),
      ctx,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        id: GOAL,
        memberId: LEO,
        title: 'Movie night',
        description: null,
        icon: 'ticket',
        startDate: '2026-10-03',
        endDate: '2026-10-17',
        logic: 'any',
        rules: [
          { type: 'COUNT', target: 20, scope: { tag_ids: [MORNING, KITCHEN].sort() }, params: {} },
          { type: 'STREAK', target: 5, scope: { all: true }, params: { grace_per_week: 2 } },
        ],
        payout: { type: 'custom' },
      },
    });
  });

  it('[RWD-13] reads what reaching it pays: points, or a reward from the shop for a child', () => {
    const rule: [string, string][] = [
      ['rule-keys', 'a'],
      ['rule-a-type', 'COUNT'],
      ['rule-a-target', '3'],
    ];
    const pays = (extra: [string, string][], who = LEO) =>
      parseGoalForm(
        form([...base.filter(([k]) => k !== 'member'), ['member', who], ...rule, ...extra]),
        ctx,
      );
    expect(
      pays([
        ['payout', 'points'],
        ['payoutPoints', '50'],
      ]),
    ).toMatchObject({
      ok: true,
      value: { payout: { type: 'points', amount: 50 } },
    });
    expect(
      pays([
        ['payout', 'item'],
        ['payoutItem', BED],
      ]),
    ).toMatchObject({
      ok: true,
      value: { payout: { type: 'catalog_item', item_id: BED } },
    });
    expect(
      pays([
        ['payout', 'points'],
        ['payoutPoints', '0'],
      ]),
    ).toEqual({
      ok: false,
      message: 'Points paid: a whole number from 1 to 10,000.',
    });
    expect(
      pays([
        ['payout', 'points'],
        ['payoutPoints', '10001'],
      ]),
    ).toMatchObject({ ok: false });
    expect(
      pays([
        ['payout', 'points'],
        ['payoutPoints', '2.5'],
      ]),
    ).toMatchObject({ ok: false });
    expect(
      pays([
        ['payout', 'item'],
        ['payoutItem', ''],
      ]),
    ).toEqual({
      ok: false,
      message: 'Choose the reward from the shop.',
    });
    expect(
      pays(
        [
          ['payout', 'item'],
          ['payoutItem', BED],
        ],
        'family',
      ),
    ).toEqual({
      ok: false,
      message: 'A family goal pays points to each child, or just the celebration.',
    });
    const p = pays([
      ['payout', 'points'],
      ['payoutPoints', '50'],
    ]);
    if (!p.ok) throw new Error(p.message);
    expect(goalPayload(p.value, 'h1')).toHaveProperty('payout', { type: 'points', amount: 50 });
  });

  it('[RWD-01] a family goal, no end date, one rule counting some items', () => {
    const parsed = parseGoalForm(
      form([
        ...base.filter(([k]) => k !== 'member' && k !== 'endDate'),
        ['member', 'family'],
        ['endDate', ''],
        ['rule-keys', 'a'],
        ['rule-a-type', 'DAILY_ALL_DONE'],
        ['rule-a-target', '10'],
        ['rule-a-scope', 'items'],
        ['rule-a-item', BED],
      ]),
      ctx,
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      memberId: null,
      endDate: null,
      logic: 'all',
      rules: [{ type: 'DAILY_ALL_DONE', target: 10, scope: { chore_ids: [BED] } }],
    });
  });

  it('says what to fix', () => {
    const rule: [string, string][] = [
      ['rule-keys', 'a'],
      ['rule-a-type', 'COUNT'],
      ['rule-a-target', '3'],
    ];
    const message = (entries: [string, string][]) => {
      const p = parseGoalForm(form(entries), ctx);
      return p.ok ? 'ok' : p.message;
    };
    expect(message([...base, ...rule])).toBe('ok');
    expect(message([...base])).toBe('Add at least one rule.');
    expect(message([...base.filter(([k]) => k !== 'title'), ['title', ' '], ...rule])).toBe(
      'Give the goal a name, up to 80 characters.',
    );
    expect(message([...base.filter(([k]) => k !== 'member'), ['member', 'adult'], ...rule])).toBe(
      'Choose who the goal is for.',
    );
    expect(
      message([...base.filter(([k]) => k !== 'endDate'), ['endDate', '2026-10-01'], ...rule]),
    ).toBe('It can’t end before it starts.');
    expect(
      message([...base.filter(([k]) => k !== 'startDate'), ['startDate', '2026-02-30'], ...rule]),
    ).toBe('Choose the day it starts.');
    expect(
      message([
        ...base,
        ['rule-keys', 'a,b'],
        ['rule-a-type', 'COUNT'],
        ['rule-a-target', '3'],
        ['rule-b-type', 'COUNT'],
        ['rule-b-target', '0'],
      ]),
    ).toBe('Rule 2 needs a target from 1 to 100,000.');
    expect(message([...base, ...rule, ['rule-a-scope', 'tags']])).toBe('Choose a tag for rule.');
    expect(message([...base, ['rule-keys', 'a,b,c,d,e,f']])).toBe('A goal has up to 5 rules.');
    expect(message([...base.filter(([k]) => k !== 'id'), ['id', 'x'], ...rule])).toBe(
      'That goal isn’t there any more.',
    );
  });

  it('sends a photo only when it changes', () => {
    const p = parseGoalForm(
      form([...base, ['rule-keys', 'a'], ['rule-a-type', 'COUNT'], ['rule-a-target', '3']]),
      ctx,
    );
    if (!p.ok) throw new Error(p.message);
    expect(goalPayload(p.value, 'h1')).not.toHaveProperty('image_path');
    expect(goalPayload(p.value, 'h1', null)).toHaveProperty('image_path', null);
    expect(goalPayload(p.value, 'h1', 'h1/g/x.jpg')).toMatchObject({
      household_id: 'h1',
      member_id: LEO,
      start_date: '2026-10-03',
      rule_logic: 'all',
      image_path: 'h1/g/x.jpg',
    });
  });

  it('puts the database’s refusals in a parent’s words', () => {
    expect(goalRefusal({ hint: 'not_earning' })).toBe(
      'Goals are for someone who earns rewards, or the whole family.',
    );
    expect(goalRefusal({ hint: 'goal_started' })).toContain('has started');
    expect(goalRefusal({ hint: 'payout_item' })).toContain('isn’t in the shop');
    expect(goalRefusal({ hint: 'payout_family_item' })).toContain('each child');
    expect(goalRefusal({ code: '23514' })).toContain('isn’t right');
    expect(goalRefusal({})).toBe('That didn’t save. Try again in a moment.');
  });
});

describe('the Goals page’s words', () => {
  const names = {
    tags: new Map([
      [MORNING, 'Morning'],
      [KITCHEN, 'Kitchen'],
    ]),
    items: new Map([[BED, 'Make bed']]),
  };
  it('[RWD-02] says what a rule counts', () => {
    expect(
      describeRule(
        { type: 'COUNT', target: 20, scope: { tag_ids: [MORNING, KITCHEN] }, params: {} },
        names,
      ),
    ).toBe('20 things done, tagged Morning or Kitchen');
    expect(
      describeRule(
        { type: 'STREAK', target: 5, scope: { all: true }, params: { grace_per_week: 1 } },
        names,
      ),
    ).toBe('5 good days in a row (1 miss a week forgiven)');
    expect(
      describeRule(
        { type: 'STREAK', target: 1, scope: { all: true }, params: { grace_per_week: 0 } },
        names,
      ),
    ).toBe('1 good day in a row (no misses forgiven)');
    expect(
      describeRule(
        { type: 'POINTS', target: 1500, scope: { chore_ids: [BED, 'gone'] }, params: {} },
        names,
      ),
    ).toBe('1,500 points earned, from Make bed or a removed item');
  });

  it('[RWD-07] says where a streak stands now and at best', () => {
    expect(streakLine({ current: 2, best: 4, met: false })).toBe('2 in a row now, best 4');
    expect(streakLine({ current: 3, best: 3, met: false })).toBe('3 in a row now');
    expect(streakLine({ current: 5, best: 6, met: true })).toBe('Reached. 5 in a row now.');
    expect(streakLine({ current: 0, best: 6, met: true })).toBe('Reached.');
  });

  it('[RWD-09] tells a goal’s history', () => {
    expect(eventWords({ type: 'achieved', payload: { n: 1 } })).toBe('Achieved');
    expect(eventWords({ type: 'achieved', payload: { n: 2 } })).toBe('Achieved again (2nd time)');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '103rd',
    ]);
    expect(eventWords({ type: 'unachieved', payload: {} })).toContain('undone');
    expect(eventWords({ type: 'recomputed', payload: { from_pct: 100, to_pct: 50 } })).toBe(
      'Progress worked out again: 100% to 50%',
    );
  });

  it('[RWD-13][US-409] tells what a goal paid, took back and put back', () => {
    expect(
      eventWords({
        type: 'achieved',
        payload: { n: 2, paid: { type: 'points', amount: 10, children: 1 } },
      }),
    ).toBe('Achieved again (2nd time): paid 10 points');
    expect(
      eventWords({
        type: 'achieved',
        payload: { n: 1, paid: { type: 'points', amount: 5, children: 2 } },
      }),
    ).toBe('Achieved: paid 5 points each');
    expect(
      eventWords({ type: 'achieved', payload: { n: 1, paid: { type: 'catalog_item' } } }),
    ).toBe('Achieved: its reward from the shop is approved');
    expect(eventWords({ type: 'payout_reversed', payload: { n: 1, points: 10, item: null } })).toBe(
      'Payout undone: 10 points taken back',
    );
    expect(
      eventWords({ type: 'payout_reversed', payload: { n: 1, points: 0, item: 'called_off' } }),
    ).toBe('Payout undone: its reward from the shop called off');
    expect(eventWords({ type: 'payout_restored', payload: { n: 1, points: 1 } })).toBe(
      'Met again: 1 point put back',
    );
    expect(eventWords({ type: 'needs_review', payload: { why: 'reward_given' } })).toContain(
      'after its reward was given',
    );
    expect(eventWords({ type: 'edited', payload: { payout: {} } })).toBe('What it pays changed');
  });

  it('[RWD-13] says what a goal pays', () => {
    const item = (id: string) => (id === BED ? 'Ice cream' : undefined);
    expect(payoutWords({ type: 'points', amount: 1 }, false, item)).toBe('1 point');
    expect(payoutWords({ type: 'points', amount: 1500 }, true, item)).toBe('1,500 points each');
    expect(payoutWords({ type: 'catalog_item', item_id: BED }, false, item)).toBe(
      'Ice cream from the shop',
    );
    expect(payoutWords({ type: 'catalog_item', item_id: 'gone' }, false, item)).toBe(
      'a reward from the shop',
    );
    expect(payoutWords({ type: 'custom' }, false, item)).toBeNull();
  });
});

// Leo's week: 18 things done by yesterday; today's bed decides a goal of 19.
const day = (k: number) => `2026-10-${String(k).padStart(2, '0')}`;
const fact = (k: number, status: OccurrenceFact['status'], id = `bed-${k}`): OccurrenceFact => ({
  id,
  chore_id: BED,
  member_id: LEO,
  kind: 'chore',
  tag_ids: [MORNING],
  due_date: day(k),
  credit_date: day(k),
  status,
  credited: status === 'completed' || status === 'approved',
  points: 5,
});
const WEEK: OccurrenceFact[] = [];
for (let k = 3; k <= 9; k++) {
  WEEK.push(
    fact(k, 'completed', `a-${k}`),
    fact(k, 'completed', `b-${k}`),
    fact(k, k === 9 ? 'missed' : 'completed', `c-${k}`),
  );
}
const read = (facts: OccurrenceFact[], status = 'active') => ({
  read_at: '2026-10-10T12:00:00Z',
  as_of: day(10),
  week_start: 0,
  rules_version: 1,
  goal: {
    id: GOAL,
    member_id: LEO,
    start_date: day(3),
    end_date: day(17),
    rule_logic: 'all' as const,
    status: status as 'active',
  },
  rules: [{ id: 'r1', type: 'COUNT' as const, target: 21, scope: { all: true }, params: {} }],
  facts,
});

describe('evaluating a stored goal', () => {
  it('[RWD-04] the engine reads what goal_facts gives it: one more check-off achieves it', () => {
    expect(evaluateRead(read(WEEK))).toMatchObject({
      pct: 95.24,
      is_achieved: false,
      transitions: [],
    });
    const done = evaluateRead(read([...WEEK, fact(10, 'completed')]));
    expect(done).toMatchObject({ pct: 100, is_achieved: true });
    expect(done.transitions).toEqual([{ type: 'achieved', from: 'active', to: 'achieved' }]);
    // [RWD-04] Unchecked again: the achieved goal goes back to going.
    expect(evaluateRead(read(WEEK, 'achieved')).transitions).toEqual([
      { type: 'unachieved', from: 'achieved', to: 'active' },
    ]);
  });

  it('[RWD-04][US-407] reads, evaluates and saves; a save refused because the goal changed reads it again', async () => {
    const saves: Record<string, unknown>[] = [];
    let reads = 0;
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'goal_facts') {
        reads += 1;
        // The first read is stale: by the save, another evaluation achieved it.
        return {
          data: read([...WEEK, fact(10, 'completed')], reads === 1 ? 'active' : 'achieved'),
          error: null,
        };
      }
      saves.push(args);
      return saves.length === 1
        ? { data: { saved: false, reason: 'changed', status: 'achieved' }, error: null }
        : { data: { saved: true, status: 'achieved', transitions: [] }, error: null };
    });
    const db = { rpc } as unknown as SupabaseClient;
    expect(await evaluateStoredGoal(db, GOAL)).toEqual({
      saved: true,
      status: 'achieved',
      transitions: [],
    });
    expect(saves).toHaveLength(2);
    expect(saves[0]).toMatchObject({
      p_goal: GOAL,
      p_status: 'active',
      p_rules_version: 1,
      p_engine_version: ENGINE_VERSION,
      p_read_at: '2026-10-10T12:00:00Z',
    });
    expect((saves[0]!.p_evaluation as { transitions: unknown[] }).transitions).toHaveLength(1);
    // The second read saw it achieved already: nothing more to apply.
    expect(saves[1]).toMatchObject({ p_status: 'achieved' });
    expect((saves[1]!.p_evaluation as { transitions: unknown[] }).transitions).toEqual([]);
  });

  it('[RWD-04] a household’s goals: one failing doesn’t stop the others, and is reported', async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === 'goals_to_evaluate') {
        expect(args).toEqual({ p_household: 'h1', p_engine_version: ENGINE_VERSION });
        return { data: ['bad', GOAL], error: null };
      }
      if (name === 'goal_facts') {
        return args.p_goal === 'bad'
          ? { data: null, error: { message: 'boom' } }
          : { data: read([...WEEK, fact(10, 'completed')]), error: null };
      }
      return { data: { saved: true, status: 'achieved', transitions: ['achieved'] }, error: null };
    });
    const failed: string[] = [];
    const stats = await evaluateHouseholdGoals({ rpc } as unknown as SupabaseClient, 'h1', (g) =>
      failed.push(g),
    );
    expect(stats).toEqual({
      goals: 2,
      achieved: 1,
      unachieved: 0,
      started: 0,
      expired: 0,
      failed: 1,
    });
    expect(failed).toEqual(['bad']);
  });

  it('[RWD-04] after check-offs: the households they touched, once each; nothing without the job’s key', async () => {
    const onError = vi.fn();
    await evaluateAfterCompletions(null, ['o1'], onError);
    const evaluated: string[] = [];
    const db = {
      from: () => ({
        select: () => ({
          in: async (_c: string, ids: string[]) => {
            expect(ids).toEqual(['o1', 'o2']);
            return { data: [{ household_id: 'h1' }, { household_id: 'h1' }], error: null };
          },
        }),
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'goals_to_evaluate') evaluated.push(args.p_household as string);
        return { data: [], error: null };
      },
    } as unknown as SupabaseClient;
    await evaluateAfterCompletions(db, ['o1', 'o2', 'o1'], onError);
    expect(evaluated).toEqual(['h1']);
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('the preview of a change', () => {
  const v = (target: number, endDate: string | null = day(17)) => ({
    id: GOAL,
    memberId: LEO,
    title: 'Movie night',
    description: null,
    icon: 'ticket',
    startDate: day(3),
    endDate,
    logic: 'all' as const,
    rules: [{ type: 'COUNT' as const, target, scope: { all: true as const }, params: {} }],
    payout: { type: 'points' as const, amount: 10 },
  });
  const facts = (f: OccurrenceFact[], status = 'active', saved = true) => ({
    as_of: day(10),
    week_start: 0,
    status: status as 'active',
    saved,
    facts: f,
  });

  it('[RWD-10][US-406] old and new progress from every check-off, and what saving would do', () => {
    // Leo has 20 things done; the goal asks 21. Lowering it to 20 reaches it.
    const p = previewGoal(v(20), facts(WEEK), read(WEEK));
    expect(p.before).toMatchObject({
      pct: 95.24,
      achieved: false,
      rules: [{ value: 20, target: 21 }],
    });
    expect(p.after).toMatchObject({ pct: 100, achieved: true, rules: [{ value: 20, met: true }] });
    expect(p.transitions).toEqual(['achieved']);
    expect(previewOutcome(p, { saved: true, pays: '10 points', paid: null, paidItem: false })).toBe(
      'Saving reaches it now, and it pays 10 points.',
    );
  });

  it('[RWD-10][RWD-04] raising the target of a reached goal takes it back, and what it paid', () => {
    const done = [...WEEK, fact(10, 'completed')];
    const p = previewGoal(v(30), facts(done, 'achieved'), read(done, 'achieved'));
    expect(p.transitions).toEqual(['unachieved']);
    expect(
      previewOutcome(p, { saved: true, pays: '10 points', paid: '10 points', paidItem: false }),
    ).toBe('Saving takes it back to going: 70% there, and what it paid (10 points) is taken back.');
    expect(
      previewOutcome(p, {
        saved: true,
        pays: null,
        paid: 'Ice cream from the shop',
        paidItem: true,
      }),
    ).toBe(
      'Saving takes it back to going: 70% there, and Ice cream from the shop is called off (if it was already given, the goal is flagged for a look).',
    );
  });

  it('[RWD-10] a new goal starts from what is already done; an end date already past ends it', () => {
    const fresh = previewGoal(v(40), facts(WEEK, 'scheduled', false), null);
    expect(fresh.before).toBeNull();
    expect(previewOutcome(fresh, { saved: false, pays: null, paid: null, paidItem: false })).toBe(
      'It starts 50% of the way there, from what’s already done.',
    );
    const reached = previewGoal(v(5), facts(WEEK, 'scheduled', false), null);
    expect(previewOutcome(reached, { saved: false, pays: null, paid: null, paidItem: false })).toBe(
      'Setting it reaches it at once.',
    );
    const ended = previewGoal(v(40, day(8)), facts(WEEK), read(WEEK));
    expect(ended.transitions).toEqual(['expired']);
    expect(previewOutcome(ended, { saved: true, pays: null, paid: null, paidItem: false })).toBe(
      'Saving ends it: its end date has passed at 45%.',
    );
    const same = previewGoal(v(21), facts(WEEK), read(WEEK));
    expect(previewOutcome(same, { saved: true, pays: null, paid: null, paidItem: false })).toBe(
      'Its progress stays at 95%.',
    );
    const lower = previewGoal(v(25), facts(WEEK), read(WEEK));
    expect(previewOutcome(lower, { saved: true, pays: null, paid: null, paidItem: false })).toBe(
      'Its progress goes from 95% to 80%.',
    );
  });
});
