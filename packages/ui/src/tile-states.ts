// How each occurrence status looks (06 §7.1): an icon, a word and a tone, never color alone.
// Display states (overdue, past its time, covered) are views of a status, not stored statuses
// (02 §4.2): they come from the due date and time, and from who did a shared item (D-30, D-31).
import type { OccurrenceStatus } from '@familywise/rules-engine';
import type { IconName } from './generated/icons';

export type TileTone =
  'open' | 'done' | 'waiting' | 'retry' | 'skipped' | 'missed' | 'late' | 'covered';

export interface TileState {
  icon: IconName;
  /** Board label: short, positive, for a child (06 §2). */
  label: string;
  /** Admin label: plain and neutral, for parents. */
  adminLabel: string;
  tone: TileTone;
}

export const TILE_STATES = {
  scheduled: { icon: 'circle', label: 'To do', adminLabel: 'Open', tone: 'open' },
  completed: { icon: 'check-circle', label: 'Done!', adminLabel: 'Done', tone: 'done' },
  pending_approval: {
    icon: 'clock',
    label: 'Waiting for a parent',
    adminLabel: 'Needs review',
    tone: 'waiting',
  },
  approved: { icon: 'shield-check', label: 'Approved', adminLabel: 'Approved', tone: 'done' },
  rejected: { icon: 'retry', label: 'Try again', adminLabel: 'Sent back', tone: 'retry' },
  skipped: { icon: 'moon', label: 'Skipped today', adminLabel: 'Skipped', tone: 'skipped' },
  missed: { icon: 'minus-circle', label: 'Missed', adminLabel: 'Missed', tone: 'missed' },
} as const satisfies Record<OccurrenceStatus, TileState>;

export type DisplayState = 'overdue' | 'past-time' | 'covered';

export const DISPLAY_STATES = {
  // A task still open after its due date (D-31): calm, never red.
  overdue: { icon: 'hourglass', label: 'Overdue', adminLabel: 'Overdue', tone: 'late' },
  // Today's item still open after its due time (US-313).
  'past-time': {
    icon: 'hourglass',
    label: 'Past its time',
    adminLabel: 'Past its time',
    tone: 'late',
  },
  // Done by another assignee of a shared item (D-30): neutral for this member.
  covered: { icon: 'check', label: 'Covered', adminLabel: 'Covered', tone: 'covered' },
} as const satisfies Record<DisplayState, TileState>;

export function tileState(status: OccurrenceStatus, display?: DisplayState): TileState {
  return display ? DISPLAY_STATES[display] : TILE_STATES[status];
}
