import { describe, expect, it } from 'vitest';
import { IDLE_MS, isNewDeploy, mayReload } from './board-update';

// [DEV-05] A board picks up a new deploy by itself (WP-78, D-99).
describe('[DEV-05] a board and a new deploy (WP-78)', () => {
  it('sees a new deploy when the deployed commit is not the one it runs', () => {
    expect(isNewDeploy('abc1234', 'def5678aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    // The board knows the first 7 characters; health says all 40.
    expect(isNewDeploy('abc1234', 'abc1234ffffffffffffffffffffffffffffffff')).toBe(false);
    expect(isNewDeploy('ABC1234', 'abc1234')).toBe(false);
  });

  it('never for a local or dev build, or an answer that is not a commit', () => {
    expect(isNewDeploy('dev', 'abc1234')).toBe(false);
    expect(isNewDeploy('abc1234', 'local')).toBe(false);
    expect(isNewDeploy('abc1234', undefined)).toBe(false);
    expect(isNewDeploy('abc1234', 42)).toBe(false);
    expect(isNewDeploy('abc1234', '')).toBe(false);
  });

  it('reloads only with no dialog open and nobody touching it for a while', () => {
    const now = 10 * IDLE_MS;
    expect(mayReload(now, now - IDLE_MS, false)).toBe(true);
    expect(mayReload(now, now - IDLE_MS + 1, false)).toBe(false);
    expect(mayReload(now, now - 5 * IDLE_MS, true)).toBe(false);
    expect(mayReload(now, now, false)).toBe(false);
  });
});
