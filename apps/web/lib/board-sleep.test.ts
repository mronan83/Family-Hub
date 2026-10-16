import { describe, expect, it } from 'vitest';
import {
  addDays,
  awakeMinutesBetween,
  boardAsleep,
  boardMissed,
  type BoardSleep,
  clockTime,
  drift,
  hhmm,
  idleLabel,
  isSchoolDay,
  localInstant,
  minutesOf,
  nextNight,
  readBoardSleep,
  readSchoolDays,
  scheduledNight,
  type SchoolDays,
  sleepFromForm,
  sleepStatus,
  sleepSummary,
  sleepToConfig,
} from './board-sleep';

// Kitchen in the mockup (D-116): school nights 9:30 pm to 6:30 am, weekends and days off 10:30 pm to
// 7:30 am, 15 minutes untouched. October 2030 in New York: Monday the 14th is a day off from school.
const TZ = 'America/New_York';
const KITCHEN: BoardSleep = readBoardSleep({
  missed: 'awake',
  schedule: {
    school: { sleep: '21:30', wake: '06:30' },
    weekend: { sleep: '22:30', wake: '07:30' },
  },
  idle_minutes: 15,
});
const OCTOBER: SchoolDays = {
  from: '2030-10-01',
  to: '2030-11-30',
  // School days: weekdays, but not Monday 14 October.
  days: new Set(
    Array.from({ length: 61 }, (_, i) => addDays('2030-10-01', i)).filter(
      (d) => d !== '2030-10-14' && isSchoolDay(d, null),
    ),
  ),
};
/** A moment on the household's clock. */
const at = (date: string, time: string) => localInstant(TZ, date, minutesOf(time)!);
/** Asleep at a moment, touched last at `lastTouch` (null: not since it opened, just now). */
const asleepAt = (date: string, time: string, lastTouch: number | null = null, s = KITCHEN) =>
  boardAsleep(s, { now: at(date, time), lastTouch, since: at(date, time) }, TZ, OCTOBER);

describe('[DEV-07][US-207] WP-34: reading a board’s sleep settings', () => {
  it('reads what Boards saves, and back', () => {
    expect(KITCHEN).toEqual({
      missed: 'awake',
      schedule: { school: { sleep: 1290, wake: 390 }, weekend: { sleep: 1350, wake: 450 } },
      idleMinutes: 15,
    });
    expect(readBoardSleep(sleepToConfig(KITCHEN))).toEqual(KITCHEN);
    expect(hhmm(390)).toBe('06:30');
  });

  it('is Always, no set times and never idle until set, or for anything it doesn’t know', () => {
    const none = { missed: 'always', schedule: null, idleMinutes: null };
    expect(readBoardSleep(undefined)).toEqual(none);
    expect(readBoardSleep({ missed: 'sometimes', idle_minutes: 7 })).toEqual(none);
    expect(
      readBoardSleep({ schedule: { school: { sleep: '21:30', wake: '06:30' } } }).schedule,
    ).toBeNull();
    expect(sleepToConfig(readBoardSleep(null))).toEqual({ missed: 'always' });
  });

  it('reads the snapshot’s school days', () => {
    const s = readSchoolDays({ from: '2030-10-11', to: '2030-10-15', days: ['2030-10-11'] });
    expect(s?.days.has('2030-10-11')).toBe(true);
    expect(readSchoolDays({ from: '2030-10-11' })).toBeNull();
  });
});

describe('[DEV-07][US-207] WP-34: school nights and weekend nights (D-117)', () => {
  it('a school day by the school year, else Monday to Friday', () => {
    expect(isSchoolDay('2030-10-11', OCTOBER)).toBe(true); // Friday
    expect(isSchoolDay('2030-10-12', OCTOBER)).toBe(false); // Saturday
    expect(isSchoolDay('2030-10-14', OCTOBER)).toBe(false); // the day off
    expect(isSchoolDay('2030-12-02', OCTOBER)).toBe(true); // past the days read: a Monday
    expect(isSchoolDay('2030-12-07', OCTOBER)).toBe(false); // and a Saturday
  });

  it('a night takes its times from the day after it', () => {
    // Thursday night, school on Friday: 9:30 pm to 6:30 am.
    expect(asleepAt('2030-10-10', '21:29')).toBe(false);
    expect(asleepAt('2030-10-10', '21:30')).toBe(true);
    expect(asleepAt('2030-10-11', '06:29')).toBe(true);
    expect(asleepAt('2030-10-11', '06:30')).toBe(false);
    // Friday night, a weekend night: still awake at 10 pm, asleep at 10:30.
    expect(asleepAt('2030-10-11', '22:00')).toBe(false);
    expect(asleepAt('2030-10-11', '22:30')).toBe(true);
    // Saturday and Sunday mornings wake at 7:30.
    expect(asleepAt('2030-10-12', '07:00')).toBe(true);
    expect(asleepAt('2030-10-13', '07:30')).toBe(false);
  });

  it('the night before a day off is a weekend night, and the day off wakes late', () => {
    // Sunday night before Monday's day off: awake at 10 pm, asleep 10:30 pm to 7:30 am.
    expect(asleepAt('2030-10-13', '22:00')).toBe(false);
    expect(asleepAt('2030-10-13', '22:30')).toBe(true);
    expect(asleepAt('2030-10-14', '07:00')).toBe(true);
    expect(asleepAt('2030-10-14', '07:30')).toBe(false);
    // Monday night, before Tuesday's school: a school night again.
    expect(asleepAt('2030-10-14', '21:30')).toBe(true);
    expect(asleepAt('2030-10-15', '06:30')).toBe(false);
  });

  it('across midnight, and a sleep time after midnight', () => {
    expect(asleepAt('2030-10-10', '23:59')).toBe(true);
    expect(asleepAt('2030-10-11', '00:00')).toBe(true);
    const late = readBoardSleep({
      schedule: {
        school: { sleep: '00:30', wake: '06:00' },
        weekend: { sleep: '01:00', wake: '08:00' },
      },
    });
    expect(asleepAt('2030-10-10', '23:59', null, late)).toBe(false);
    expect(asleepAt('2030-10-11', '00:30', null, late)).toBe(true); // Friday: school
    expect(asleepAt('2030-10-12', '00:45', null, late)).toBe(false); // Saturday: weekend, 1 am
    expect(asleepAt('2030-10-12', '07:59', null, late)).toBe(true);
  });

  it('says when it next sleeps, and when it wakes', () => {
    const n = nextNight(KITCHEN, at('2030-10-11', '12:00'), TZ, OCTOBER)!;
    expect([n.from, n.to, n.school]).toEqual([
      at('2030-10-11', '22:30'),
      at('2030-10-12', '07:30'),
      false,
    ]);
    const now = scheduledNight(KITCHEN, at('2030-10-11', '03:00'), TZ, OCTOBER)!;
    expect([now.from, now.to, now.school]).toEqual([
      at('2030-10-10', '21:30'),
      at('2030-10-11', '06:30'),
      true,
    ]);
    expect(scheduledNight(KITCHEN, at('2030-10-11', '12:00'), TZ, OCTOBER)).toBeNull();
  });
});

describe('[DEV-07][US-207] WP-34: idle sleep and a touch in the night', () => {
  it('sleeps once untouched for its idle time, and a touch wakes it', () => {
    const noon = at('2030-10-11', '12:00');
    expect(asleepAt('2030-10-11', '12:14', noon)).toBe(false);
    expect(asleepAt('2030-10-11', '12:15', noon)).toBe(true);
    // Untouched since it opened: idle counts from then.
    const opened = { now: noon + 15 * 60_000, lastTouch: null, since: noon };
    expect(boardAsleep(KITCHEN, opened, TZ, OCTOBER)).toBe(true);
    expect(boardAsleep(KITCHEN, { ...opened, now: noon + 14 * 60_000 }, TZ, OCTOBER)).toBe(false);
  });

  it('never sleeps untouched without an idle time, nor at all with no settings', () => {
    const noIdle = { ...KITCHEN, idleMinutes: null };
    expect(asleepAt('2030-10-11', '18:00', at('2030-10-10', '18:00'), noIdle)).toBe(false);
    expect(asleepAt('2030-10-11', '03:00', null, readBoardSleep(null))).toBe(false);
  });

  it('a touch in the night wakes it for its idle time, then it sleeps again', () => {
    const touch = at('2030-10-16', '02:10');
    expect(asleepAt('2030-10-16', '02:10', touch)).toBe(false);
    expect(asleepAt('2030-10-16', '02:24', touch)).toBe(false);
    expect(asleepAt('2030-10-16', '02:25', touch)).toBe(true);
  });

  it('for 5 minutes when it has no idle time (D-117)', () => {
    const noIdle = { ...KITCHEN, idleMinutes: null };
    const touch = at('2030-10-16', '02:10');
    expect(asleepAt('2030-10-16', '02:14', touch, noIdle)).toBe(false);
    expect(asleepAt('2030-10-16', '02:15', touch, noIdle)).toBe(true);
  });

  it('wakes at its time for its idle time at least, untouched all night', () => {
    const lastNight = at('2030-10-15', '20:00');
    expect(asleepAt('2030-10-16', '06:30', lastNight)).toBe(false);
    expect(asleepAt('2030-10-16', '06:44', lastNight)).toBe(false);
    expect(asleepAt('2030-10-16', '06:45', lastNight)).toBe(true);
    // Touched in the morning, the idle time counts from the touch.
    expect(asleepAt('2030-10-16', '06:50', at('2030-10-16', '06:40'))).toBe(false);
  });

  it('sleeps at its time even if touched just before; opened in the night, it sleeps', () => {
    expect(asleepAt('2030-10-15', '21:30', at('2030-10-15', '21:29'))).toBe(true);
    expect(asleepAt('2030-10-16', '01:00', null)).toBe(true);
  });
});

describe('[DEV-07] WP-34: across a change of clocks', () => {
  // 2030: clocks go forward on Sunday 10 March and back on Sunday 3 November in New York.
  it('wakes at 6:30 on the household’s clock either side of a change', () => {
    expect(new Date(at('2030-03-08', '06:30')).toISOString()).toBe('2030-03-08T11:30:00.000Z');
    expect(new Date(at('2030-03-11', '06:30')).toISOString()).toBe('2030-03-11T10:30:00.000Z');
    expect(asleepAt('2030-03-11', '06:29')).toBe(true);
    expect(asleepAt('2030-03-11', '06:30')).toBe(false);
    expect(asleepAt('2030-11-04', '06:29')).toBe(true);
    expect(asleepAt('2030-11-04', '06:30')).toBe(false);
  });

  it('the night clocks change is an hour shorter or longer, at the same times', () => {
    // Saturday night into Sunday, weekend times: 10:30 pm to 7:30 am.
    const spring = scheduledNight(KITCHEN, at('2030-03-10', '04:00'), TZ, null)!;
    expect((spring.to - spring.from) / 3_600_000).toBe(8);
    const fall = scheduledNight(KITCHEN, at('2030-11-03', '04:00'), TZ, null)!;
    expect((fall.to - fall.from) / 3_600_000).toBe(10);
  });

  it('a time the clocks skip falls into the new hour; one they repeat is the first', () => {
    expect(new Date(localInstant(TZ, '2030-03-10', 150)).toISOString()).toBe(
      '2030-03-10T07:30:00.000Z',
    );
    expect(new Date(localInstant(TZ, '2030-11-03', 90)).toISOString()).toBe(
      '2030-11-03T05:30:00.000Z',
    );
  });

  it('holds in a time zone ahead of UTC too, across midnight UTC', () => {
    const tokyo = (d: string, t: string) => localInstant('Asia/Tokyo', d, minutesOf(t)!);
    const n = scheduledNight(KITCHEN, tokyo('2030-10-11', '03:00'), 'Asia/Tokyo', null)!;
    expect(new Date(n.from).toISOString()).toBe('2030-10-10T12:30:00.000Z');
  });
});

describe('[DEV-07][US-207] WP-34: when Home lists a board as not seen', () => {
  const seen = (date: string, time: string) => new Date(at(date, time)).toISOString();
  const missed = (s: BoardSleep, last: string | null, date: string, time: string) =>
    boardMissed(s, last, at(date, time), TZ, OCTOBER);
  const always = { ...KITCHEN, missed: 'always' as const };
  const never = { ...KITCHEN, missed: 'never' as const };

  it('Always: after a day unseen, at any hour', () => {
    expect(missed(always, seen('2030-10-15', '13:00'), '2030-10-16', '12:59')).toBe(false);
    expect(missed(always, seen('2030-10-15', '13:00'), '2030-10-16', '13:00')).toBe(true);
    expect(missed(always, seen('2030-10-15', '13:00'), '2030-10-16', '23:00')).toBe(true);
  });

  it('Only while awake: its hours asleep don’t count, and never while asleep', () => {
    // Unseen 26 hours at 3 pm: about 17 of them awake, not yet.
    expect(missed(KITCHEN, seen('2030-10-15', '13:00'), '2030-10-16', '15:00')).toBe(false);
    // Unseen 26 hours at 11 pm: asleep, so not listed.
    expect(missed(KITCHEN, seen('2030-10-15', '21:00'), '2030-10-16', '23:00')).toBe(false);
    // Two weeks unseen: listed while awake, not while asleep.
    expect(missed(KITCHEN, seen('2030-10-01', '12:00'), '2030-10-15', '15:00')).toBe(true);
    expect(missed(KITCHEN, seen('2030-10-01', '12:00'), '2030-10-15', '23:00')).toBe(false);
  });

  it('counts the hours awake exactly', () => {
    // Tuesday 1 pm to Wednesday 3 pm, with Tuesday night asleep 9:30 pm to 6:30 am: 26 h less 9.
    const m = awakeMinutesBetween(
      KITCHEN,
      at('2030-10-15', '13:00'),
      at('2030-10-16', '15:00'),
      TZ,
      OCTOBER,
    );
    expect(m / 60).toBe(17);
    expect(missed(KITCHEN, seen('2030-10-15', '13:00'), '2030-10-17', '07:00')).toBe(true);
  });

  it('Only while awake without set times is Always', () => {
    const noTimes = { ...KITCHEN, schedule: null };
    expect(missed(noTimes, seen('2030-10-15', '13:00'), '2030-10-16', '23:00')).toBe(true);
  });

  it('Never: never listed; and a board never seen isn’t listed', () => {
    expect(missed(never, seen('2030-10-01', '12:00'), '2030-10-15', '15:00')).toBe(false);
    expect(missed(always, null, '2030-10-15', '15:00')).toBe(false);
  });
});

describe('[DEV-07] WP-34: burn-in drift', () => {
  it('moves at most 1 px every 5 minutes, within a 4 px square, and covers it', () => {
    const seenAt = new Set<string>();
    let last = drift(0);
    for (let k = 1; k < 64; k++) {
      const d = drift(k * 5 * 60_000);
      expect(Math.abs(d.x - last.x) + Math.abs(d.y - last.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(d.x - last.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(d.y - last.y)).toBeLessThanOrEqual(1);
      expect(Math.max(Math.abs(d.x), Math.abs(d.y))).toBeLessThanOrEqual(2);
      seenAt.add(`${d.x},${d.y}`);
      last = d;
    }
    expect(drift(4 * 60_000)).toEqual(drift(0));
    expect(seenAt.size).toBe(25);
  });
});

describe('[DEV-07][US-207] WP-34: Boards’ sleep and wake form', () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const kitchen = {
    missed: 'awake',
    scheduled: 'on',
    school_sleep: '21:30',
    school_wake: '06:30',
    weekend_sleep: '22:30',
    weekend_wake: '07:30',
    idle: '15',
  };

  it('reads the form as Kitchen’s settings', () => {
    expect(sleepFromForm(form(kitchen))).toEqual(KITCHEN);
  });

  it('keeps the times only with the box ticked, and refuses a bad time or idle', () => {
    expect(sleepFromForm(form({ ...kitchen, scheduled: '' }))?.schedule).toBeNull();
    expect(sleepFromForm(form({ ...kitchen, school_wake: '' }))).toBeNull();
    expect(sleepFromForm(form({ ...kitchen, weekend_wake: '22:30' }))).toBeNull();
    expect(sleepFromForm(form({ ...kitchen, idle: '7' }))).toBeNull();
    expect(sleepFromForm(form({ ...kitchen, idle: 'never' }))?.idleMinutes).toBeNull();
    expect(sleepFromForm(form({ missed: 'never' }))).toEqual({
      missed: 'never',
      schedule: null,
      idleMinutes: null,
    });
  });

  it('sums a board up, as the mockup did', () => {
    expect(sleepSummary(KITCHEN)).toBe(
      'school nights 9:30 pm to 6:30 am, weekends 10:30 pm to 7:30 am; sleeps after 15 minutes untouched; missed only while awake',
    );
    expect(sleepSummary(readBoardSleep({ missed: 'never', idle_minutes: 10 }))).toBe(
      'sleeps after 10 minutes untouched; never missed',
    );
    expect(sleepSummary(readBoardSleep(null))).toBe('always awake');
    expect([clockTime(0), clockTime(12 * 60), clockTime(23 * 60 + 5)]).toEqual([
      '12:00 am',
      '12:00 pm',
      '11:05 pm',
    ]);
    expect([idleLabel(5), idleLabel(60), idleLabel(120)]).toEqual([
      '5 minutes',
      '1 hour',
      '2 hours',
    ]);
  });

  it('says whether it is asleep now, and when that changes', () => {
    expect(sleepStatus(KITCHEN, at('2030-10-15', '12:00'), TZ, OCTOBER)).toEqual({
      asleep: false,
      text: 'Awake · sleeps at 9:30 pm',
    });
    expect(sleepStatus(KITCHEN, at('2030-10-12', '03:00'), TZ, OCTOBER)).toEqual({
      asleep: true,
      text: 'Asleep · wakes at 7:30 am',
    });
    expect(sleepStatus(readBoardSleep(null), at('2030-10-12', '03:00'), TZ, OCTOBER)).toBeNull();
  });
});
