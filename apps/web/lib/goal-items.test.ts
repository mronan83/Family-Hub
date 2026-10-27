import { describe, expect, it } from 'vitest';
import { place } from './chore-sections';
import { type GoalItem, itemGroups, type ItemsFor, overFrom, shortDate } from './goal-items';
import { parseGoalForm } from './goals';

// A made-up family: Maya and Leo earn rewards, Sam is a parent. Today is Tuesday, Oct 27, 2026.
const MAYA = 'f3000000-0000-4000-8000-000000000001';
const LEO = 'f3000000-0000-4000-8000-000000000002';
const SAM = 'f3000000-0000-4000-8000-000000000003';
const KIDS = [
  { id: MAYA, displayName: 'Maya' },
  { id: LEO, displayName: 'Leo' },
];
const TODAY = '2026-10-27';

let n = 0;
const item = (title: string, o: Partial<GoalItem> = {}): GoalItem => ({
  id: `f3c00000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
  title,
  icon: null,
  kind: 'chore',
  assignees: [LEO],
  repeats: true,
  day: null,
  over: null,
  ...o,
});
const forLeo: ItemsFor = { memberId: LEO, members: KIDS, start: TODAY, end: null, today: TODAY };
const titles = (cs: { item: GoalItem }[]) => cs.map((c) => c.item.title);

const teeth = item('Brush teeth', { assignees: [LEO, MAYA] });
const dog = item('Feed the dog');
const table = item('Set the table', { assignees: [MAYA] });
const bins = item('Take out the bins', { assignees: [SAM] });
const pack = item('Pack for the school trip', { repeats: false, day: '2026-10-30' });
const library = item('Return library books', { kind: 'task', repeats: false, day: '2026-10-26' });
const car = item('Clean out the car', { repeats: false, day: '2026-10-20', over: 'done' });
const fence = item('Paint the fence', { repeats: false, day: '2026-10-19', over: 'missed' });
const plants = item('Water the plants', { over: 'archived' });
const ALL = [teeth, dog, table, bins, pack, library, car, fence, plants];

describe('[RWD-21] the goal form’s Some items', () => {
  it('[RWD-21-a] leaves out an item only for another child', () => {
    const g = itemGroups(ALL, forLeo, []);
    expect(titles(g.repeats)).toEqual(['Brush teeth', 'Feed the dog']);
    expect(titles([...g.repeats, ...g.once, ...g.kept])).not.toContain('Set the table');
    expect(titles(itemGroups(ALL, { ...forLeo, memberId: MAYA }, []).repeats)).toEqual([
      'Brush teeth',
      'Set the table',
    ]);
  });

  it('[RWD-21-b] leaves out a one-time item done, skipped or missed, and an archived item', () => {
    const skipped = item('Rake the leaves', { repeats: false, day: '2026-10-21', over: 'skipped' });
    const g = itemGroups([...ALL, skipped], forLeo, []);
    const shown = titles([...g.repeats, ...g.once, ...g.kept]);
    for (const t of [
      'Clean out the car',
      'Paint the fence',
      'Rake the leaves',
      'Water the plants',
    ]) {
      expect(shown).not.toContain(t);
    }
  });

  it('[RWD-21-b] reads WP-96’s sections: Completed and Archived are over, Scheduled and Recurring not', () => {
    const base = {
      id: 'x',
      title: 'X',
      kind: 'chore' as const,
      archivedAt: null,
      assignees: [LEO],
    };
    const once = {
      ...base,
      schedule: { freq: 'once', on_date: '2026-10-20' },
      assignment: 'shared',
    };
    const placed = place(
      [once as never],
      [{ choreId: 'x', dueDate: '2026-10-20', memberId: null, status: 'missed', changedAt: null }],
      TODAY,
      1,
      'UTC',
    )[0]!;
    expect(overFrom(placed.section, placed.outcome)).toBe('missed');
    expect(overFrom('archived')).toBe('archived');
    expect(overFrom('scheduled')).toBeNull();
    expect(overFrom('recurring')).toBeNull();
  });

  it('[RWD-21-c] lists a one-time item still to do, Overdue included, with its day', () => {
    const g = itemGroups(ALL, forLeo, []);
    expect(g.once.map((c) => [c.item.title, c.when])).toEqual([
      ['Return library books', 'Overdue 10/26/2026'],
      ['Pack for the school trip', '10/30/2026'],
    ]);
    expect(shortDate('2027-01-05')).toBe('01/05/2027');
  });

  it('[RWD-21-d] lists an item that repeats under Repeats, with no day, before the one-time items', () => {
    const g = itemGroups(ALL, forLeo, []);
    expect(g.repeats.map((c) => [c.item.title, c.when])).toEqual([
      ['Brush teeth', undefined],
      ['Feed the dog', undefined],
    ]);
  });

  it('[RWD-21-e] a family goal lists every child’s items, not a parent’s alone', () => {
    const g = itemGroups(ALL, { ...forLeo, memberId: null }, [bins.id]);
    expect(titles(g.repeats)).toEqual(['Brush teeth', 'Feed the dog', 'Set the table']);
    expect(g.kept.map((c) => [c.item.title, c.flags])).toEqual([
      ['Take out the bins', ['not for a child']],
    ]);
  });

  it('[RWD-21-f] keeps an item the goal counts that is done or archived, flagged', () => {
    const g = itemGroups(ALL, forLeo, [dog.id, car.id, plants.id]);
    expect(titles(g.repeats)).toContain('Feed the dog');
    expect(g.kept.map((c) => [c.item.title, c.flags])).toEqual([
      ['Clean out the car', ['done']],
      ['Water the plants', ['archived']],
    ]);
    expect(g.kept.map((c) => c.when)).toEqual([undefined, undefined]);
  });

  it('[RWD-21-g] changing who it’s for flags an item no longer theirs, still kept', () => {
    const kept = [dog.id, teeth.id];
    const g = itemGroups(ALL, { ...forLeo, memberId: MAYA }, kept);
    expect(titles(g.repeats)).toEqual(['Brush teeth', 'Set the table']);
    expect(g.kept.map((c) => [c.item.title, c.flags])).toEqual([
      ['Feed the dog', ['not for Maya']],
    ]);
  });

  it('[RWD-21-j] a one-time chore only within the goal’s dates; a task whatever its day', () => {
    const pumpkin = item('Carve the pumpkin', { repeats: false, day: '2026-10-31' });
    const cards = item('Write thank-you cards', {
      kind: 'task',
      repeats: false,
      day: '2026-11-05',
    });
    const early = item('Return the permission slip', { repeats: false, day: '2026-10-26' });
    const goal = { ...forLeo, start: '2026-10-27', end: '2026-10-29' };
    const g = itemGroups([pumpkin, cards, early, pack, library], goal, [pumpkin.id, early.id]);
    expect(titles(g.once)).toEqual(['Return library books', 'Write thank-you cards']);
    expect(g.kept.map((c) => [c.item.title, c.flags])).toEqual([
      ['Carve the pumpkin', ['after the goal ends']],
      ['Return the permission slip', ['before it starts']],
    ]);
    expect(titles([...g.once, ...g.kept])).not.toContain('Pack for the school trip');
  });

  it('[RWD-21-h] the server accepts an item id a goal already counts, archived or done', () => {
    const f = new FormData();
    for (const [k, v] of [
      ['id', 'f3900000-0000-4000-8000-000000000001'],
      ['title', 'Car week'],
      ['member', LEO],
      ['startDate', '2026-10-03'],
      ['icon', 'trophy'],
      ['rule-keys', 'a'],
      ['rule-a-type', 'COUNT'],
      ['rule-a-target', '3'],
      ['rule-a-scope', 'items'],
      ['rule-a-item', car.id],
      ['rule-a-item', plants.id],
    ]) {
      f.append(k!, v!);
    }
    const parsed = parseGoalForm(f, { icons: ['trophy'], memberIds: [LEO] });
    expect(parsed.ok && parsed.value.rules[0]?.scope).toEqual({
      chore_ids: [car.id, plants.id].sort(),
    });
  });
});
