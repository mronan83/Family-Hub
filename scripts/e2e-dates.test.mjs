// [NFR-12-e][D-110] The specs' calendar-date maths (scripts/e2e-dates.mjs) on any weekday, any week
// start, across DST, month and year ends, and in any zone the runner is in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekday, weekStartOf } from './e2e-dates.mjs';

// Run each check as a runner in UTC, at UTC−11 and at UTC+14: the answers never change.
const ZONES = ['UTC', 'Pacific/Pago_Pago', 'Pacific/Kiritimati'];
function inEveryZone(check) {
  const was = process.env.TZ;
  try {
    for (const zone of ZONES) {
      process.env.TZ = zone;
      check(zone);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

test('[NFR-12-e] each weekday of a week, and the week holding it for every week start', () => {
  inEveryZone(() => {
    // Sun 18 Oct 2026 to Sat 24 Oct 2026.
    const days = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays('2026-10-18', n));
    assert.deepEqual(days.map(weekday), [0, 1, 2, 3, 4, 5, 6]);
    for (const [i, date] of days.entries()) {
      for (let start = 0; start < 7; start++) {
        const first = weekStartOf(date, start);
        assert.equal(weekday(first), start, `${date}, weeks from ${start}`);
        const back = (i - start + 7) % 7;
        assert.equal(first, addDays(date, -back), `${date}, weeks from ${start}`);
        // The date is in its own week: 0 to 6 days after its first day.
        assert.ok(weekStartOf(addDays(first, 6), start) === first, `${date}, weeks from ${start}`);
      }
    }
  });
});

test('[NFR-12-e] across DST, month and year ends and a leap day, a day is one calendar day', () => {
  inEveryZone(() => {
    for (const [from, n, to] of [
      ['2026-03-07', 1, '2026-03-08'], // US clocks go forward on the 8th
      ['2026-03-08', 1, '2026-03-09'],
      ['2026-03-28', 2, '2026-03-30'], // Europe's on the 29th
      ['2026-10-31', 1, '2026-11-01'], // US clocks go back on 1 Nov
      ['2026-11-01', 1, '2026-11-02'],
      ['2026-10-25', -1, '2026-10-24'], // Europe's on 25 Oct
      ['2026-12-31', 1, '2027-01-01'],
      ['2027-01-01', -1, '2026-12-31'],
      ['2028-02-28', 1, '2028-02-29'],
      ['2028-02-29', 1, '2028-03-01'],
      ['2026-10-21', 42, '2026-12-02'],
      ['2026-10-21', -365, '2025-10-21'],
    ]) {
      assert.equal(addDays(from, n), to, `${from} + ${n}`);
    }
    // A week across the US change is still seven days, Sunday to Sunday.
    assert.equal(weekStartOf('2026-11-07', 0), '2026-11-01');
    assert.equal(weekStartOf('2026-11-08', 0), '2026-11-08');
    assert.equal(weekStartOf('2027-01-01', 1), '2026-12-28');
  });
});
