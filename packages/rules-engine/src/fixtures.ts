// Test facts: one member's routine or task on a day, in a given state. Test-only (not exported).
import type { MemberStatus, OccurrenceFact } from './types';

let next = 0;

type Extra = Partial<Omit<OccurrenceFact, 'due_date' | 'status'>>;

export function fact(due_date: string, status: MemberStatus, extra: Extra = {}): OccurrenceFact {
  const credited =
    extra.credited ??
    (status === 'completed' || status === 'approved' || status === 'pending_approval');
  const doneNow = status === 'completed' || status === 'approved';
  return {
    id: `o${(next += 1)}`,
    chore_id: 'make-bed',
    member_id: 'maya',
    kind: 'chore',
    tag_ids: [],
    credit_date: doneNow && credited ? due_date : null,
    points: 5,
    ...extra,
    due_date,
    status,
    credited,
  };
}

export const done = (d: string, x: Extra = {}) => fact(d, 'completed', x);
export const missed = (d: string, x: Extra = {}) => fact(d, 'missed', x);
export const skipped = (d: string, x: Extra = {}) => fact(d, 'skipped', x);
export const covered = (d: string, x: Extra = {}) => fact(d, 'covered', x);
export const open = (d: string, x: Extra = {}) => fact(d, 'scheduled', x);
export const pending = (d: string, x: Extra = {}) => fact(d, 'pending_approval', x);
/** A task done on `creditDate` (due `due`, which may be earlier). */
export const taskDone = (due: string, creditDate: string, x: Extra = {}) =>
  fact(due, 'completed', { kind: 'task', credit_date: creditDate, ...x });
