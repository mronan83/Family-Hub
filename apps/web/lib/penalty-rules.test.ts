import { describe, expect, it } from 'vitest';
import { penaltyHistory, type PenaltyReason, withOwed } from './penalties';
import {
  missedDays,
  monthDay,
  owedLine,
  type PenaltyRule,
  parseRule,
  perMiss,
  ruleArgs,
  ruleLine,
  ruleMessage,
  ruleOwing,
  ruleStatus,
  stoppedWords,
} from './penalty-rules';
import { ledgerLine } from './points';
import { entryWords, type RegisterEntry } from './points-register';

const MAYA = '0de00000-0000-4000-8000-0000000000c1';
const LEO = '0de00000-0000-4000-8000-0000000000c2';
const CHORE = '0de00000-0000-4000-8000-0000000000d1';
const TAG = '0de00000-0000-4000-8000-0000000000a1';
const FOLDER: PenaltyReason = {
  id: '0de00000-0000-4000-8000-0000000000e1',
  name: 'Homework folder not home',
  unit: 'money',
  amount: 100,
};
const BED: PenaltyReason = {
  id: '0de00000-0000-4000-8000-0000000000e2',
  name: 'Up after bedtime',
  unit: 'points',
  amount: 5,
};
const names: Record<string, string> = { [MAYA]: 'Maya', [LEO]: 'Leo' };
const name = (id: string) => names[id] ?? 'Someone';

const folderHome: PenaltyRule = {
  id: '0de00000-0000-4000-8000-0000000000b1',
  name: 'Folder home',
  reasonId: FOLDER.id,
  unit: 'money',
  amount: 100,
  max: 1000,
  scope: 'items',
  tagId: null,
  tagName: null,
  chores: [{ id: CHORE, title: 'Homework folder home', schoolDays: true, assignees: [MAYA] }],
  memberIds: [MAYA],
  startDate: '2026-11-16',
  endDate: '2027-01-31',
  held: { [MAYA]: 200 },
};
const bedBy8: PenaltyRule = {
  ...folderHome,
  id: '0de00000-0000-4000-8000-0000000000b2',
  name: 'Bed by 8',
  reasonId: BED.id,
  unit: 'points',
  amount: 5,
  max: 25,
  scope: 'tag',
  tagId: TAG,
  tagName: 'Bedtime',
  chores: [],
  memberIds: [LEO],
  startDate: '2026-11-01',
  endDate: '2026-12-31',
  held: {},
};

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  }
  return f;
}
const TODAY = '2026-11-19';
const good = {
  name: ' Folder home ',
  reasonId: FOLDER.id,
  memberId: MAYA,
  scope: 'items',
  choreId: CHORE,
  startDate: '2026-11-19',
  endDate: '2027-01-31',
  amount: '1',
  max: '10',
};

describe('penalty rules in words (WP-121)', () => {
  it("[PTS-10-j] a rule's line, as the mockup writes it", () => {
    expect(ruleLine(folderHome, name)).toBe(
      'Maya · Homework folder home · $1 a missed school day · max $10 · Nov 16 to Jan 31',
    );
    expect(ruleLine(bedBy8, name)).toBe(
      'Leo · tag Bedtime · 5 points a miss · max 25 points · Nov 1 to Dec 31',
    );
    expect(perMiss({ ...folderHome, scope: 'all' })).toBe('$1 a miss');
    expect(monthDay('2027-01-05')).toBe('Jan 5');
  });

  it('[PTS-10-j] what a rule has on each person: owed in money, points taken, or nothing', () => {
    expect(ruleStatus(folderHome, name)).toBe('Maya owes $2');
    expect(ruleStatus({ ...bedBy8, held: { [LEO]: 10 } }, name)).toBe('Leo: 10 of 25 points taken');
    expect(ruleStatus(bedBy8, name)).toBe('Nothing owed');
  });

  it('[PTS-10-j] the days missed: a weekday this week, a date before it', () => {
    expect(missedDays(['2026-11-18', '2026-11-17'], TODAY)).toBe('Tue and Wed');
    expect(missedDays(['2026-11-16', '2026-11-17', '2026-11-18'], TODAY)).toBe('Mon, Tue and Wed');
    expect(missedDays(['2026-11-09', '2026-11-18', '2026-11-18'], TODAY)).toBe('Nov 9 and Wed');
    expect(missedDays([], TODAY)).toBe('');
  });

  it("[PTS-10-j] a rule's misses on a child's page: grouped by rule, oldest first, only what is owed", () => {
    const at = (d: string) => `${d}T23:05:00Z`;
    expect(
      ruleOwing([
        {
          ruleId: 'r1',
          reason: 'Folder home',
          owed: 100,
          missedOn: '2026-11-18',
          givenAt: at('2026-11-18'),
        },
        { ruleId: null, reason: 'Left bike', owed: 100, missedOn: null, givenAt: at('2026-11-16') },
        {
          ruleId: 'r1',
          reason: 'Folder home',
          owed: 100,
          missedOn: '2026-11-17',
          givenAt: at('2026-11-17'),
        },
        {
          ruleId: 'r1',
          reason: 'Folder home',
          owed: 0,
          missedOn: '2026-11-13',
          givenAt: at('2026-11-13'),
        },
      ]),
    ).toEqual([
      { ruleId: 'r1', name: 'Folder home', owed: 200, missed: ['2026-11-17', '2026-11-18'] },
    ]);
  });

  it('[PTS-10-j][PTS-10-n] the history: a rule\'s miss is "Folder home, missed", tagged Rule, given by nobody, with Take back until taken back', () => {
    const penalties = withOwed(
      [
        {
          id: 'p1',
          memberId: MAYA,
          reason: 'Folder home',
          unit: 'money',
          amount: 100,
          givenAt: '2026-11-18T05:05:00Z',
          givenBy: null,
          takenBackAt: null,
          takenBackBy: null,
          ruleId: 'r1',
          missedOn: '2026-11-17',
        },
        {
          id: 'p2',
          memberId: MAYA,
          reason: 'Folder home',
          unit: 'money',
          amount: 100,
          givenAt: '2026-11-17T05:05:00Z',
          givenBy: null,
          takenBackAt: '2026-11-18T14:00:00Z',
          takenBackBy: 'u-alex',
          takenBackOnTime: true,
          ruleId: 'r1',
          missedOn: '2026-11-16',
        },
      ],
      [],
    );
    expect(
      penaltyHistory(penalties, []).map((e) => [e.what, e.tag, e.by, e.day, e.amount, e.takeBack]),
    ).toEqual([
      ['Folder home, marked on time', 'Taken back', 'u-alex', '2026-11-16', '−$1 owed', null],
      ['Folder home, missed', 'Rule', null, '2026-11-17', '+$1 owed', 'p1'],
      ['Folder home, missed', 'Rule', null, '2026-11-16', '+$1 owed', null],
    ]);
    expect(penalties.map((p) => p.owed)).toEqual([100, 0]);
  });

  it("[PTS-10-h] the board's line for a rule's misses, and a one-time penalty as before", () => {
    expect(
      owedLine({ reason: 'Folder home', rule: true, missed: ['2026-11-17', '2026-11-18'] }, TODAY),
    ).toBe('Folder home: missed Tue and Wed');
    expect(owedLine({ reason: 'Left bike in the driveway' }, TODAY)).toBe(
      'Left bike in the driveway',
    );
  });

  it('[PTS-10-i] the register names the rule a miss came from', () => {
    const e: RegisterEntry = {
      id: 'l1',
      memberId: LEO,
      kind: 'penalty',
      amount: -5,
      at: '2026-11-15T08:05:00Z',
      reason: 'Bed by 8, missed Saturday',
      forItem: false,
      itemTitle: null,
      goalId: null,
      goalTitle: null,
      ruleId: null,
      byType: 'system',
      by: null,
      penaltyRule: 'Bed by 8',
    };
    expect(entryWords(e, () => 'Alex')).toEqual({
      what: 'Bed by 8, missed Saturday',
      by: 'rule Bed by 8',
    });
    expect(
      entryWords(
        {
          ...e,
          amount: 5,
          reason: 'Bed by 8, missed Saturday, marked on time',
          byType: 'admin',
          by: 'u1',
        },
        () => 'Alex',
      ),
    ).toEqual({ what: 'Bed by 8, missed Saturday, marked on time', by: 'rule Bed by 8 · by Alex' });
    expect(
      ledgerLine(
        { id: 'l1', type: 'penalty', amount: -5, at: e.at, label: e.reason, by: null },
        () => 'Alex',
      ),
    ).toBe('Penalty: Bed by 8, missed Saturday');
  });
});

describe('the rule form (WP-121)', () => {
  const reasons = [FOLDER, BED];

  it("[PTS-10-j] a rule as save_penalty_rule() reads it, in the reason's unit", () => {
    const r = parseRule(form(good), reasons, TODAY);
    expect(r.ok && ruleArgs(r.value)).toEqual({
      name: 'Folder home',
      reason_id: FOLDER.id,
      member_ids: [MAYA],
      scope: 'items',
      chore_ids: [CHORE],
      start_date: '2026-11-19',
      end_date: '2027-01-31',
      amount: 100,
      max_amount: 1000,
    });
    const tag = parseRule(
      form({ ...good, reasonId: BED.id, scope: 'tag', tagId: TAG, amount: '5', max: '25' }),
      reasons,
      TODAY,
    );
    expect(tag.ok && ruleArgs(tag.value)).toMatchObject({
      scope: 'tag',
      tag_id: TAG,
      chore_ids: [],
      amount: 5,
    });
  });

  it('[PTS-10-j] refuses what the database would, in plain words', () => {
    const no = (f: Record<string, string | string[]>, keep: string | null = null) => {
      const r = parseRule(form({ ...good, ...f }), reasons, TODAY, keep);
      return r.ok ? 'ok' : r.message;
    };
    expect(no({ name: ' ' })).toBe('Name the rule, in up to 80 characters.');
    expect(no({ reasonId: 'x' })).toBe('Choose a reason from the list.');
    expect(no({ memberId: [] })).toBe('Choose who the rule is for.');
    expect(no({ scope: 'x' })).toBe('Choose what counts as a miss.');
    expect(no({ choreId: [] })).toBe('Choose at least one item.');
    expect(no({ scope: 'tag' })).toBe('Choose a tag.');
    expect(no({ endDate: '2026-11-18' })).toBe('The end date can’t be before the start.');
    expect(no({ startDate: '2026-11-18', endDate: '2026-12-01' })).toBe(
      'A rule starts today or later.',
    );
    expect(no({ startDate: '2026-11-16' }, '2026-11-16')).toBe('ok');
    expect(no({ startDate: '2026-02-30' })).toBe('Choose a start and an end date.');
    expect(no({ amount: '0' })).toBe('Enter an amount per miss from $0.01 to $1,000.');
    expect(no({ max: '0.5' })).toBe('Enter a max owed no less than each miss adds.');
    expect(ruleMessage({ hint: 'start_past' })).toBe('A rule starts today or later.');
    expect(ruleMessage({ hint: 'unit_changed' })).toMatch(/keeps points or money/);
    expect(ruleMessage({ code: '42501' })).toBe('Only a parent of this household can do that.');
    expect(ruleMessage({ hint: 'rule_stopped' })).toMatch(/was stopped/);
    expect(ruleMessage({ hint: 'rule_used' })).toMatch(/Stop it instead/);
    expect(ruleMessage({})).toBe('Nothing was changed. Try again in a moment.');
  });
});

describe('a stopped rule (WP-121)', () => {
  it("[PTS-10-o] says when it was stopped, on the household's own day", () => {
    expect(stoppedWords('2026-11-21T03:30:00Z', 'America/Chicago')).toBe('Stopped Nov 20');
    expect(stoppedWords('2026-11-21T15:00:00Z', 'America/Chicago')).toBe('Stopped Nov 21');
  });
});
