import { OCCURRENCE_STATUSES } from '@familywise/rules-engine';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES } from './generated/icons';
import { DISPLAY_STATES, TILE_STATES, tileState } from './tile-states';

describe('tile states', () => {
  it('[NFR-13] every OccurrenceStatus has a tile mapping with an icon, a word and a tone', () => {
    expect(Object.keys(TILE_STATES).sort()).toEqual([...OCCURRENCE_STATUSES].sort());
    for (const status of OCCURRENCE_STATUSES) {
      const state = TILE_STATES[status];
      expect(ICON_NAMES).toContain(state.icon);
      expect(state.label.length).toBeGreaterThan(0);
      expect(state.adminLabel.length).toBeGreaterThan(0);
      expect(state.tone).toBeTruthy();
    }
  });

  it('[NFR-13] each status reads differently, so color is never the only cue', () => {
    const labels = OCCURRENCE_STATUSES.map((s) => TILE_STATES[s].label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('[NFR-13] uses the icons and words of the brand guide (06 §7.1)', () => {
    expect(TILE_STATES.pending_approval).toMatchObject({
      icon: 'clock',
      label: 'Waiting for a parent',
    });
    expect(TILE_STATES.missed).toMatchObject({
      icon: 'minus-circle',
      label: 'Missed',
      tone: 'missed',
    });
    expect(TILE_STATES.rejected).toMatchObject({ icon: 'retry', label: 'Try again' });
  });

  it('[CHR-12][CHR-11][CHR-09] display states override the status: overdue, past its time, covered', () => {
    expect(tileState('scheduled', 'overdue')).toBe(DISPLAY_STATES.overdue);
    expect(tileState('scheduled', 'past-time').label).toBe('Past its time');
    expect(tileState('completed', 'covered').tone).toBe('covered');
    expect(tileState('completed')).toBe(TILE_STATES.completed);
    for (const d of Object.values(DISPLAY_STATES)) expect(ICON_NAMES).toContain(d.icon);
  });
});
