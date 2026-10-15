import { describe, expect, it } from 'vitest';
import {
  copyWords,
  daySet,
  daySetWords,
  entryName,
  type MealRow,
  mealRefusal,
  mealsFor,
  parseEntryForm,
  parseMealForm,
  peopleWords,
  type PlanEntry,
  planByDay,
  weekDays,
  weekFrom,
  weekLabel,
} from './meals';

const ID = 'f2e10000-0000-4000-8000-000000000001';
const TACOS = 'f2d00000-0000-4000-8000-000000000001';
const MAYA = 'f2000000-0000-4000-8000-000000000001';
const LEO = 'f2000000-0000-4000-8000-000000000002';
const SAM = 'f2000000-0000-4000-8000-000000000003';

function form(entries: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const meal = (
  id: string,
  name: string,
  mealTypes: MealRow['mealTypes'],
  archivedAt: string | null = null,
) =>
  ({
    id,
    name,
    description: null,
    icon: 'utensils',
    mealTypes,
    recipeUrl: null,
    archivedAt,
  }) satisfies MealRow;

describe('the week', () => {
  it('[MEAL-01] is the household week holding the day asked for, or today', () => {
    // Wednesday 14 Oct 2026; weeks from Sunday (0) or Monday (1).
    expect(weekFrom(undefined, '2026-10-14', 0)).toBe('2026-10-11');
    expect(weekFrom(undefined, '2026-10-14', 1)).toBe('2026-10-12');
    expect(weekFrom('2026-10-20', '2026-10-14', 0)).toBe('2026-10-18');
    expect(weekFrom('2026-02-30', '2026-10-14', 0)).toBe('2026-10-11');
    expect(weekFrom('<script>', '2026-10-14', 0)).toBe('2026-10-11');
    expect(weekDays('2026-10-11')).toEqual([
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
    ]);
    expect(weekLabel('2026-10-11')).toBe('Week of Sun, Oct 11');
  });

  it('[MEAL-01][MEAL-08] lays out the entries by day and slot, each slot in order', () => {
    const e = (
      id: string,
      planDate: string,
      slot: PlanEntry['slot'],
      sortOrder: number,
    ): PlanEntry => ({
      id,
      planDate,
      slot,
      sortOrder,
      memberIds: [],
      mealId: null,
      freeText: id,
      notes: null,
    });
    const plan = planByDay(
      [
        e('crackers', '2026-10-14', 'snack', 2),
        e('apple', '2026-10-14', 'snack', 1),
        e('tacos', '2026-10-12', 'dinner', 1),
        e('elsewhere', '2026-10-30', 'dinner', 1),
      ],
      weekDays('2026-10-11'),
    );
    expect(plan.get('2026-10-14')!.snack.map((x) => x.id)).toEqual(['apple', 'crackers']);
    expect(plan.get('2026-10-12')!.dinner.map((x) => x.id)).toEqual(['tacos']);
    expect(plan.get('2026-10-11')!.breakfast).toEqual([]);
    expect(plan.has('2026-10-30')).toBe(false);
  });

  it('[MEAL-02] names an entry by its meal (a removed meal keeps its name) or its words', () => {
    const meals = new Map([[TACOS, meal(TACOS, 'Tacos', ['dinner'], '2026-09-01')]]);
    const base: PlanEntry = {
      id: ID,
      planDate: '2026-10-12',
      slot: 'dinner',
      sortOrder: 1,
      memberIds: [],
      mealId: TACOS,
      freeText: null,
      notes: null,
    };
    expect(entryName(base, meals)).toBe('Tacos');
    expect(entryName({ ...base, mealId: null, freeText: 'Leftovers' }, meals)).toBe('Leftovers');
  });

  it('[MEAL-01] offers the meals good for the slot first, then the rest; never archived ones', () => {
    const meals = [
      meal('1', 'Tacos', ['dinner']),
      meal('2', 'Apple slices', ['snack']),
      meal('3', 'Chicken soup', ['lunch', 'dinner']),
      meal('4', 'Anything goes', []),
      meal('5', 'Old casserole', ['dinner'], '2026-09-01'),
    ];
    expect(mealsFor('dinner', meals).map((m) => m.name)).toEqual([
      'Anything goes',
      'Chicken soup',
      'Tacos',
      'Apple slices',
    ]);
    expect(mealsFor('snack', meals).map((m) => m.name)[0]).toBe('Anything goes');
    expect(mealsFor('snack', meals).map((m) => m.name)[1]).toBe('Apple slices');
  });

  it('[MEAL-03] says what a copy did', () => {
    expect(copyWords({ copied: 0, skipped: 0, replaced: 0 })).toBe(
      'Last week has nothing planned to copy.',
    );
    expect(copyWords({ copied: 12, skipped: 1, replaced: 0 })).toBe(
      'Copied 12 things from last week. 1 meal was already planned and kept.',
    );
    expect(copyWords({ copied: 1, skipped: 0, replaced: 3 })).toBe(
      'Copied 1 thing from last week. 3 meals were replaced.',
    );
  });
});

describe('[MEAL-14] a folded day: X of Y set, or a check', () => {
  const at = (slot: PlanEntry['slot'], n: number): PlanEntry => ({
    id: `f2e10000-0000-4000-8000-00000000010${n}`,
    planDate: '2026-10-15',
    slot,
    sortOrder: n,
    memberIds: [],
    mealId: null,
    freeText: `Meal ${n}`,
    notes: null,
  });
  const day = (...entries: PlanEntry[]) => planByDay(entries, ['2026-10-15']).get('2026-10-15')!;

  it('[MEAL-14] an empty day is 0 of 4 set, not complete', () => {
    expect(daySet(day())).toEqual({ set: 0, of: 4, complete: false });
    expect(daySetWords(daySet(day()))).toBe('0 of 4 set');
  });

  it('[MEAL-14] counts meal types with a meal, not entries: two lunches are one set', () => {
    const d = day(at('breakfast', 1), at('lunch', 2), at('lunch', 3));
    expect(daySet(d)).toEqual({ set: 2, of: 4, complete: false });
    expect(daySetWords(daySet(d))).toBe('2 of 4 set');
  });

  it('[MEAL-14] every meal type set is complete: the check', () => {
    const d = day(at('breakfast', 1), at('snack', 2), at('lunch', 3), at('dinner', 4));
    expect(daySet(d)).toEqual({ set: 4, of: 4, complete: true });
  });

  it('[MEAL-14] Y is the meal types the day shows', () => {
    const d = day(at('lunch', 1), at('dinner', 2));
    expect(daySet(d, ['lunch', 'dinner'])).toEqual({ set: 2, of: 2, complete: true });
    expect(daySet(d, ['breakfast', 'dinner'])).toEqual({ set: 1, of: 2, complete: false });
    expect(daySet(d, [])).toEqual({ set: 0, of: 0, complete: false });
  });
});

describe('the forms', () => {
  const days = weekDays('2026-10-11');
  const ctx = { days, memberIds: [MAYA, LEO, SAM] };
  const entry = (extra: [string, string][]) =>
    parseEntryForm(
      form([['id', ID], ['planDate', '2026-10-14'], ['slot', 'snack'], ...extra]),
      ctx,
    );

  it('[MEAL-01][MEAL-02][MEAL-08] reads a meal from the library or words, for everyone or one person', () => {
    expect(
      entry([
        ['what', 'meal'],
        ['mealId', TACOS],
        ['member', 'everyone'],
      ]),
    ).toEqual({
      ok: true,
      value: {
        id: ID,
        planDate: '2026-10-14',
        slot: 'snack',
        memberIds: [],
        mealId: TACOS,
        freeText: null,
        notes: null,
      },
    });
    expect(
      entry([
        ['what', 'text'],
        ['freeText', ' Crackers '],
        ['member', MAYA],
        ['notes', ' After school '],
      ]),
    ).toMatchObject({
      ok: true,
      value: { mealId: null, freeText: 'Crackers', memberIds: [MAYA], notes: 'After school' },
    });
  });

  it('[MEAL-10][US-708] reads any mix of people; every one ticked, or none, is everyone', () => {
    const who = (ticked: string[]) => {
      const r = entry([
        ['what', 'text'],
        ['freeText', 'Fish fingers'],
        ...ticked.map((m): [string, string] => ['member', m]),
      ]);
      return r.ok ? r.value.memberIds : r.message;
    };
    // In the family's order, once each, whatever order they came in.
    expect(who([SAM, MAYA, SAM])).toEqual([MAYA, SAM]);
    expect(who([MAYA, LEO])).toEqual([MAYA, LEO]);
    expect(who([MAYA, LEO, SAM])).toEqual([]);
    expect(who([])).toEqual([]);
    expect(who(['everyone'])).toEqual([]);
    expect(who([MAYA, 'someone-else'])).toBe('Choose who it’s for.');
  });

  it('[MEAL-10] says who an entry is for in a line', () => {
    expect(peopleWords([])).toBeNull();
    expect(peopleWords(['Maya'])).toBe('Maya');
    expect(peopleWords(['Maya', 'Leo'])).toBe('Maya and Leo');
    expect(peopleWords(['Alex', 'Maya', 'Leo'])).toBe('Alex, Maya and Leo');
  });

  it('says what to fix', () => {
    expect(
      entry([
        ['what', 'text'],
        ['freeText', '  '],
      ]),
    ).toEqual({
      ok: false,
      message: 'Write what it is, up to 80 characters.',
    });
    expect(
      entry([
        ['what', 'meal'],
        ['mealId', ''],
      ]),
    ).toEqual({
      ok: false,
      message: 'Choose a meal from the library.',
    });
    expect(
      entry([
        ['what', 'meal'],
        ['mealId', TACOS],
        ['member', 'someone-else'],
      ]),
    ).toEqual({
      ok: false,
      message: 'Choose who it’s for.',
    });
    expect(
      parseEntryForm(
        form([
          ['id', ID],
          ['planDate', '2026-10-30'],
          ['slot', 'snack'],
        ]),
        ctx,
      ),
    ).toEqual({ ok: false, message: 'Choose a day of this week.' });
    expect(
      parseEntryForm(
        form([
          ['id', ID],
          ['planDate', '2026-10-14'],
          ['slot', 'supper'],
        ]),
        ctx,
      ),
    ).toEqual({ ok: false, message: 'Choose breakfast, snack, lunch or dinner.' });
    expect(parseEntryForm(form([['id', 'x']]), ctx)).toMatchObject({ ok: false });
  });

  it('[MEAL-02] reads the library form', () => {
    expect(
      parseMealForm(
        form([
          ['name', ' Tacos '],
          ['description', ''],
          ['mealTypes', 'dinner'],
          ['mealTypes', 'lunch'],
          ['mealTypes', 'supper'],
          ['recipeUrl', 'https://example.com/tacos'],
          ['icon', 'utensils'],
        ]),
        ['utensils', 'soup'],
      ),
    ).toEqual({
      ok: true,
      value: {
        name: 'Tacos',
        description: null,
        icon: 'utensils',
        mealTypes: ['lunch', 'dinner'],
        recipeUrl: 'https://example.com/tacos',
      },
    });
    expect(parseMealForm(form([['name', '']]), [])).toEqual({
      ok: false,
      message: 'Give the meal a name, up to 80 characters.',
    });
    expect(
      parseMealForm(
        form([
          ['name', 'Pie'],
          ['recipeUrl', 'javascript:alert(1)'],
        ]),
        [],
      ),
    ).toEqual({ ok: false, message: 'A recipe link starts with https:// (or leave it blank).' });
    expect(
      parseMealForm(
        form([
          ['name', 'Pie'],
          ['icon', 'nope'],
        ]),
        ['utensils'],
      ),
    ).toMatchObject({
      ok: true,
      value: { icon: 'utensils', mealTypes: [] },
    });
  });

  it('puts the database’s refusals in a parent’s words', () => {
    expect(mealRefusal({ code: '23505' })).toBe('The library already has a meal of that name.');
    expect(mealRefusal({ hint: 'meal_gone' })).toContain('isn’t in the library');
    expect(mealRefusal({ hint: 'same_week' })).toBe('That’s the same week.');
    expect(mealRefusal({})).toBe('That didn’t save. Try again in a moment.');
  });
});
