'use server';

import type { OccurrenceFact } from '@familywise/rules-engine';
import { ICON_NAMES } from '@familywise/ui';
import { previewView } from '@/lib/goal-preview';
import type { GoalSummaries } from '@/lib/goal-summaries';
import { parseGoalForm, type PreviewRead } from '@/lib/goals';
import { DEV } from './facts';

/**
 * [NFR-16][D-128] The /dev goal forms' live summaries (WP-101): the form worked out as Preview works
 * it out (previewView, the same code as the real form's), on the made-up family's facts, with no
 * database. Today is Thursday, Oct 15, 2026; Friday, Oct 16 is a teacher planning day.
 */
export async function devLiveGoal(form: FormData): Promise<GoalSummaries | null> {
  if (!String(form.get('title') ?? '').trim()) form.set('title', 'Goal');
  const parsed = parseGoalForm(form, { icons: ICON_NAMES, memberIds: [DEV.maya, DEV.leo] });
  if (!parsed.ok) return null;
  const v = parsed.value;
  const read: PreviewRead = {
    as_of: DEV.today,
    week_start: 1,
    terms: [],
    status: 'scheduled',
    saved: false,
    members: [DEV.maya, DEV.leo],
    facts: facts().filter((f) => v.memberId === null || f.member_id === v.memberId),
    sources: { [DEV.homeworkGoal]: DEV.homeworkWeeks },
    closures: [DEV.maya, DEV.leo, null].map((member_id) => ({
      date: '2026-10-16',
      member_id,
      name: 'Teacher planning day',
      kind: 'teacher_day' as const,
    })),
  };
  return (
    previewView(v, {
      facts: read,
      stored: null,
      storedPayout: null,
      tags: new Map(DEV.tags.map((t) => [t.id, t.name])),
      items: new Map(DEV.items.map((i) => [i.id, i.title])),
      goals: new Map([
        [DEV.homeworkGoal, { title: 'Homework home every school day', repeat: 'week' }],
      ]),
      prizes: new Map(),
      people: new Map([
        [DEV.maya, 'Maya'],
        [DEV.leo, 'Leo'],
      ]),
    }).summaries ?? null
  );
}

/**
 * This week's made-up check-offs, Monday to Thursday (Friday is a day off, so nothing is due): Maya's
 * homework home Monday to Wednesday before 6 pm and her reading on each of the four days; Leo's
 * homework Monday and Wednesday, missed Tuesday. Thursday's homework is still to do.
 */
function facts(): OccurrenceFact[] {
  const out: OccurrenceFact[] = [];
  const days = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
  const add = (member: string, chore: string, day: string, status: OccurrenceFact['status']) =>
    out.push({
      id: `${member.slice(-2)}-${chore.slice(-2)}-${day}`,
      chore_id: chore,
      member_id: member,
      kind: 'chore',
      tag_ids: [],
      due_date: day,
      credit_date: status === 'completed' ? day : null,
      status,
      credited: status === 'completed',
      points: 5,
      due_time: null,
      done_at: status === 'completed' ? `${day}T16:30` : null,
    });
  days.forEach((day, i) => {
    add(DEV.maya, DEV.homework, day, i < 3 ? 'completed' : 'scheduled');
    add(DEV.maya, DEV.reading, day, 'completed');
    add(DEV.leo, DEV.homework, day, i === 1 ? 'missed' : i < 3 ? 'completed' : 'scheduled');
  });
  return out;
}
