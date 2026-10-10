import { describe, expect, it } from 'vitest';
import { boardHealth, jobsBehind, laterSnapshot, updatedAgo } from './board-health';
import type { BoardSnapshot } from './snapshot';

const now = new Date('2026-10-10T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

describe('the board’s health lines', () => {
  it('[DEV-08][US-206] stale once its snapshot is over five minutes old', () => {
    expect(boardHealth({ fetchedAt: ago(5), now, offline: false, jobs: [] })).toEqual({
      offline: null,
      stale: null,
    });
    expect(boardHealth({ fetchedAt: ago(12), now, offline: false, jobs: [] }).stale).toBe(
      'Updated 12 minutes ago',
    );
  });

  it('[US-205] offline says the check-offs are saved, and how old the data is', () => {
    expect(boardHealth({ fetchedAt: ago(24 * 60), now, offline: true, jobs: [] })).toEqual({
      offline: 'Offline: your check-offs are saved',
      stale: 'Updated 1 day ago',
    });
  });

  it('[DEV-08] a job that keeps the list up to date and is behind makes fresh data stale', () => {
    const health = (state: string, job_type = 'occurrence_gen') =>
      boardHealth({ fetchedAt: ago(1), now, offline: false, jobs: [{ job_type, state }] }).stale;
    expect(health('failing')).toBe('Today’s list may be out of date');
    expect(health('stale', 'day_close')).toBe('Today’s list may be out of date');
    // Running, fine, or never run yet (a new household) is not behind; nor is another job.
    for (const state of ['ok', 'running', 'never']) expect(health(state)).toBeNull();
    expect(health('failing', 'status_check')).toBeNull();
    expect(jobsBehind([])).toBe(false);
  });

  it('says how long ago in the board’s words', () => {
    expect(updatedAgo(30_000)).toBe('Updated just now');
    expect(updatedAgo(60_000)).toBe('Updated 1 minute ago');
    expect(updatedAgo(59 * 60_000)).toBe('Updated 59 minutes ago');
    expect(updatedAgo(60 * 60_000)).toBe('Updated 1 hour ago');
    expect(updatedAgo(23 * 3_600_000)).toBe('Updated 23 hours ago');
    expect(updatedAgo(50 * 3_600_000)).toBe('Updated 2 days ago');
  });
});

describe('the snapshot a board starts with', () => {
  const snap = (fetchedAt: string, device = 'd1') =>
    ({
      v: 1,
      fetchedAt,
      device: { id: device },
      members: [],
      occurrences: [],
    }) as unknown as BoardSnapshot;

  it('[NFR-01] a later one the board saved wins over the page’s; an earlier one does not', () => {
    const page = snap(ago(60));
    expect(laterSnapshot(page, snap(ago(2)))).toEqual(snap(ago(2)));
    expect(laterSnapshot(page, snap(ago(90)))).toBe(page);
  });

  it('[NFR-01] ignores one from another board, or in a shape it does not read', () => {
    const page = snap(ago(60));
    expect(laterSnapshot(page, snap(ago(2), 'd2'))).toBe(page);
    expect(laterSnapshot(page, null)).toBe(page);
    expect(laterSnapshot(page, { ...snap(ago(2)), v: 2 })).toBe(page);
    expect(laterSnapshot(page, { ...snap(ago(2)), occurrences: undefined })).toBe(page);
  });
});
