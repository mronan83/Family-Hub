import { describe, expect, it } from 'vitest';
import { penaltyHistory } from './penalties';
import {
  goalChoiceLabel,
  goalPaybackLine,
  goalPaybacks,
  owesPaybackLine,
  owesPaybacks,
  PAUSED,
  paybackChoices,
  paybackLead,
  type PaybackState,
} from './paybacks';
import { parseRule, type PenaltyRule, ruleArgs, ruleMessage, ruleStatus } from './penalty-rules';
import { ledgerLine } from './points';
import { entryWords, type RegisterEntry } from './points-register';
import { boardActivity } from './today';

const MAYA = '0de00000-0000-4000-8000-0000000000c1';
const LEO = '0de00000-0000-4000-8000-0000000000c2';
const GOAL = '0de00000-0000-4000-8000-0000000000f1';
const LEO_GOAL = '0de00000-0000-4000-8000-0000000000f2';
const FAMILY = '0de00000-0000-4000-8000-0000000000f3';
const GOALS = [
  { id: GOAL, title: 'Folder home every school day', memberId: MAYA, repeat: 'week' as const },
  { id: LEO_GOAL, title: 'Bed by 8 all week', memberId: LEO, repeat: 'week' as const },
  { id: FAMILY, title: 'Pizza night', memberId: null, repeat: 'none' as const },
];
const FOLDER = {
  id: '0de00000-0000-4000-8000-0000000000e1',
  name: 'Homework folder not home',
  unit: 'money' as const,
  amount: 100,
};
const name = (id: string) => (id === MAYA ? 'Maya' : 'Leo');

const folderHome: PenaltyRule = {
  id: '0de00000-0000-4000-8000-0000000000b1',
  name: 'Folder home',
  reasonId: FOLDER.id,
  unit: 'money',
  amount: 100,
  max: 1000,
  scope: 'all',
  tagId: null,
  tagName: null,
  chores: [],
  memberIds: [MAYA],
  startDate: '2026-11-16',
  endDate: '2027-01-31',
  held: { [MAYA]: 200 },
  payback: { goalId: GOAL, goal: 'Folder home every school day', repeat: 'week', amount: 100 },
};

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
const good = {
  name: 'Folder home',
  reasonId: FOLDER.id,
  memberId: MAYA,
  scope: 'all',
  startDate: '2026-11-22',
  endDate: '2027-01-31',
  amount: '1',
  max: '10',
};
const paying: PaybackState = {
  rule: 'Folder home',
  unit: 'money',
  amount: 100,
  owed: 200,
  goal: 'Folder home every school day',
  repeat: 'week',
};

describe('penalties paid back through a goal (WP-122)', () => {
  it('[PTS-11-j] "Paid back by" is checked the way the database checks it', () => {
    const ok = parseRule(
      form({ ...good, paybackGoalId: GOAL, paybackAmount: '1' }),
      [FOLDER],
      '2026-11-22',
      null,
      GOALS,
    );
    expect(ok).toMatchObject({ ok: true, value: { paybackGoalId: GOAL, paybackAmount: 100 } });
    expect(ok.ok && ruleArgs(ok.value)).toMatchObject({
      payback_goal_id: GOAL,
      payback_amount: 100,
    });
    const none = parseRule(form(good), [FOLDER], '2026-11-22', null, GOALS);
    expect(none.ok && none.value.paybackGoalId).toBeNull();
    expect(none.ok && 'payback_goal_id' in ruleArgs(none.value)).toBe(false);
    expect(
      parseRule(
        form({ ...good, paybackGoalId: LEO_GOAL, paybackAmount: '1' }),
        [FOLDER],
        '2026-11-22',
        null,
        GOALS,
      ),
    ).toEqual({ ok: false, message: 'Choose a goal of the people the rule is for, or a family goal.' });
    expect(
      parseRule(
        form({ ...good, paybackGoalId: FAMILY, paybackAmount: '0' }),
        [FOLDER],
        '2026-11-22',
        null,
        GOALS,
      ),
    ).toEqual({ ok: false, message: 'Enter what each win pays back, from $0.01 to $1,000.' });
    expect(paybackChoices(GOALS, [MAYA]).map((g) => g.id)).toEqual([GOAL, FAMILY]);
    expect(goalChoiceLabel(GOALS[0]!)).toBe('Folder home every school day · each week');
    expect(goalChoiceLabel(GOALS[2]!)).toBe('Pizza night');
  });

  it('[PTS-11-j] what the database refused, in plain words', () => {
    expect(ruleMessage({ hint: 'bad_payback_goal' })).toBe(
      'Choose a goal of the people the rule is for, or a family goal, still to be won.',
    );
    expect(ruleMessage({ hint: 'bad_payback_amount' })).toBe('Enter what each win pays back, from 1.');
  });

  it("[PTS-11-j] Settings' rule line: paying back, or paused", () => {
    expect(ruleStatus(folderHome, name)).toBe('Maya owes $2 · paid back $1 a week won');
    expect(ruleStatus({ ...folderHome, held: {} }, name)).toBe(PAUSED);
    expect(PAUSED).toBe('Nothing owed · payback paused');
    expect(
      ruleStatus(
        {
          ...folderHome,
          unit: 'points',
          max: 25,
          held: { [MAYA]: 10 },
          payback: { goalId: FAMILY, goal: 'Pizza night', repeat: 'none', amount: 5 },
        },
        name,
      ),
    ).toBe('Maya: 10 of 25 points taken · paid back 5 points when Pizza night is reached');
  });

  it("[PTS-11-j] a child's page: the payback line and the history's Payback rows", () => {
    expect(paybackLead('money', folderHome.payback!)).toBe('Paid back $1 for each week won of');
    const history = penaltyHistory(
      [],
      [
        {
          id: 'x1',
          penaltyId: 'p1',
          amount: 100,
          recordedAt: '2026-11-21T05:00:00Z',
          recordedBy: null,
          paybackId: 'b1',
        },
      ],
      [
        {
          id: 'b1',
          ruleId: folderHome.id,
          rule: 'Folder home',
          goal: 'Folder home every school day',
          repeat: 'week',
          unit: 'money',
          amount: 100,
          paidAt: '2026-11-21T05:00:00Z',
          takenBackAt: '2026-11-22T05:00:00Z',
        },
      ],
    );
    expect(history.map((e) => [e.what, e.tag, e.amount])).toEqual([
      ['Folder home every school day, week won, undone', 'Taken back', '+$1 owed'],
      ['Folder home every school day, week won', 'Payback', '−$1 owed'],
    ]);
  });

  it('[PTS-11-j] the goal card and the Owes card, as the mockup writes them', () => {
    expect(goalPaybackLine(paying, 'Maya')).toBe(
      'A won week pays back $1 of the $2 Maya owes for Folder home',
    );
    expect(goalPaybackLine({ ...paying, owed: 100 }, 'Maya')).toBe(
      'A won week pays back the $1 Maya owes for Folder home',
    );
    expect(goalPaybackLine({ ...paying, unit: 'points', amount: 5, owed: 10 }, 'Leo')).toBe(
      'A won week pays back 5 of the 10 points Leo owes for Folder home',
    );
    expect(goalPaybackLine({ ...paying, owed: 0 }, 'Maya')).toBe('Nothing owed · payback paused');
    expect(owesPaybackLine(paying)).toBe('Win a Folder home week: pays back $1');
    expect(owesPaybackLine({ ...paying, repeat: 'none', goal: 'Pizza night' })).toBe(
      'Reach Pizza night: pays back $1',
    );
    const board = [
      { ...paying, ruleId: 'r1', memberId: MAYA, goalId: GOAL },
      { ...paying, ruleId: 'r2', memberId: MAYA, goalId: GOAL, owed: 0 },
      { ...paying, ruleId: 'r3', memberId: LEO, goalId: LEO_GOAL, unit: 'points' as const },
    ];
    expect(goalPaybacks(board, { id: MAYA, displayName: 'Maya' })).toEqual({
      [GOAL]: [
        {
          key: 'r1',
          text: 'A won week pays back $1 of the $2 Maya owes for Folder home',
          paused: false,
        },
        { key: 'r2', text: 'Nothing owed · payback paused', paused: true },
      ],
    });
    expect(owesPaybacks(board, MAYA).map((p) => p.ruleId)).toEqual(['r1']);
    expect(owesPaybacks(board, LEO)).toEqual([]);
  });

  it('[PTS-11-i] the register, the ledger and the board name a payback', () => {
    const e: RegisterEntry = {
      id: 'l1',
      memberId: LEO,
      kind: 'penalty_payback',
      amount: 5,
      at: '2026-11-22T05:00:00Z',
      reason: 'Week won: Bed by 8 all week',
      forItem: false,
      itemTitle: null,
      goalId: LEO_GOAL,
      goalTitle: 'Bed by 8 all week',
      ruleId: null,
      byType: 'system',
      by: null,
      penaltyRule: 'Bed by 8',
    };
    expect(entryWords(e, () => 'Alex')).toEqual({
      what: 'Week won: Bed by 8 all week',
      by: 'goal Bed by 8 all week',
    });
    const entry = {
      id: 'l1',
      type: 'penalty_payback' as const,
      amount: 5,
      at: '2026-11-22T05:00:00Z',
      label: 'Week won: Bed by 8 all week',
      by: null,
    };
    expect(ledgerLine(entry, () => 'Alex')).toBe('Penalty payback: Week won: Bed by 8 all week');
    expect(ledgerLine({ ...entry, amount: -5 }, () => 'Alex')).toBe(
      'Penalty payback undone: Week won: Bed by 8 all week',
    );
    expect(boardActivity(entry)).toBe('Week won: Bed by 8 all week');
  });
});
