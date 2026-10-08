import { describe, expect, it } from 'vitest';
import { OCCURRENCE_STATUSES, isDone, statusWeight } from './index';

describe('[CHR-07] occurrence status weights', () => {
  it('[CHR-07] counts only completed and approved as done', () => {
    expect(OCCURRENCE_STATUSES.filter(isDone)).toEqual(['completed', 'approved']);
  });

  it('[CHR-07] treats skipped as neutral and missed as bad', () => {
    expect(statusWeight('skipped')).toBe('neutral');
    expect(statusWeight('missed')).toBe('bad');
  });

  it('[CHR-07] does not count open, pending or rejected occurrences', () => {
    for (const s of ['scheduled', 'pending_approval', 'rejected'] as const) {
      expect(statusWeight(s)).toBe('not_counted');
    }
  });
});
