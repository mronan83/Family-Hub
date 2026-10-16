import { describe, expect, it } from 'vitest';
import { boardFacts, seenWords } from './board-facts';
import { localInstant } from './board-sleep';

// [DEV-03][DEV-05][DEV-07][BRD-05][BRD-08][DEV-09][D-118] A board's folded header on Boards (WP-91): its
// facts and Home's not-seen warning. Kitchen as in the mockup (D-116): school nights 9:30 pm to
// 6:30 am, weekends 10:30 pm to 7:30 am. October 2030 in New York, no school year (every weekday a
// school day): Thursday the 17th.
const TZ = 'America/New_York';
const at = (date: string, h: number, m = 0) => localInstant(TZ, date, h * 60 + m);
const iso = (ms: number) => new Date(ms).toISOString();
const KITCHEN_SLEEP = {
  missed: 'awake',
  schedule: {
    school: { sleep: '21:30', wake: '06:30' },
    weekend: { sleep: '22:30', wake: '07:30' },
  },
  idle_minutes: 15,
};

describe('a board’s folded facts', () => {
  it('[DEV-07][DEV-09][D-118] awake, with its next sleep, seen a minute ago, and the household’s layout', () => {
    const now = at('2030-10-17', 7, 42);
    expect(
      boardFacts(
        { lastSeenAt: iso(now - 60_000), config: { sleep: KITCHEN_SLEEP } },
        now,
        TZ,
        null,
      ),
    ).toEqual({
      meta: 'Awake · sleeps at 9:30 pm · seen 1 min ago · Automatic · Standard text · household layout',
      warning: null,
    });
  });

  it('[DEV-07][BRD-08][DEV-05][BRD-05] asleep, with its wake time; its theme, text size and own layout', () => {
    const now = at('2030-10-17', 23, 5);
    const facts = boardFacts(
      {
        lastSeenAt: iso(now - 7 * 3_600_000),
        config: {
          sleep: KITCHEN_SLEEP,
          theme: 'day',
          text_size: 'larger',
          layout: { calendar: '7', cards: [] },
        },
      },
      now,
      TZ,
      null,
    );
    // Thursday night is a school night (Friday is a school day): it wakes at 6:30.
    expect(facts.meta).toBe(
      'Asleep · wakes at 6:30 am · seen 7 h ago · Always Day · Larger text · its own layout',
    );
    expect(facts.warning).toBeNull();
  });

  it('[DEV-07] no set times; never seen; Always Evening and Largest text', () => {
    const now = at('2030-10-17', 12);
    expect(
      boardFacts(
        { lastSeenAt: null, config: { theme: 'evening', text_size: 'largest' } },
        now,
        TZ,
        null,
      ),
    ).toEqual({
      meta: 'Awake · no set times · not seen yet · Always Evening · Largest text · household layout',
      warning: null,
    });
  });

  it('[DEV-07][US-207] the not-seen warning follows its Tell me when choice', () => {
    const now = at('2030-10-17', 16, 12);
    const twoDays = iso(now - 2 * 86_400_000);
    // Always: after a day unseen.
    expect(boardFacts({ lastSeenAt: twoDays, config: null }, now, TZ, null).warning).toBe(
      'Not seen for 2 days',
    );
    expect(
      boardFacts({ lastSeenAt: iso(now - 23 * 3_600_000), config: null }, now, TZ, null).warning,
    ).toBeNull();
    // Never: never warned.
    expect(
      boardFacts({ lastSeenAt: twoDays, config: { sleep: { missed: 'never' } } }, now, TZ, null)
        .warning,
    ).toBeNull();
    // Only while awake: never while it is asleep, even after two days dark.
    const night = at('2030-10-17', 23);
    expect(
      boardFacts(
        { lastSeenAt: iso(night - 2 * 86_400_000), config: { sleep: KITCHEN_SLEEP } },
        night,
        TZ,
        null,
      ).warning,
    ).toBeNull();
    // ...and in the afternoon, after more than a day of its hours awake.
    expect(
      boardFacts({ lastSeenAt: twoDays, config: { sleep: KITCHEN_SLEEP } }, now, TZ, null).warning,
    ).toBe('Not seen for 2 days');
  });
});

describe('when a board was last seen', () => {
  const now = at('2030-10-17', 16, 12);
  it('[DEV-03] in minutes, then hours, then the day and time', () => {
    expect(seenWords(null, now, TZ)).toBe('not seen yet');
    expect(seenWords(iso(now - 20_000), now, TZ)).toBe('seen just now');
    expect(seenWords(iso(now - 59 * 60_000), now, TZ)).toBe('seen 59 min ago');
    expect(seenWords(iso(now - 60 * 60_000), now, TZ)).toBe('seen 1 h ago');
    expect(seenWords(iso(now - (24 * 60 - 1) * 60_000), now, TZ)).toBe('seen 23 h ago');
    expect(seenWords(iso(now - 24 * 3_600_000), now, TZ)).toBe('seen Wed, Oct 16 at 4:12 pm');
  });

  it('[DEV-03] across midnight UTC and the end of daylight saving, in the household’s zone', () => {
    // 8:30 pm in New York is 00:30 UTC the next day: the day is New York's.
    const evening = at('2030-10-16', 20, 30);
    expect(seenWords(iso(evening), evening + 25 * 3_600_000, TZ)).toBe(
      'seen Wed, Oct 16 at 8:30 pm',
    );
    // Clocks go back at 2 am on Sunday 3 November 2030: 1:30 am to 3:30 am is three hours.
    expect(seenWords(iso(at('2030-11-03', 0, 30)), at('2030-11-03', 2, 30), TZ)).toBe(
      'seen 3 h ago',
    );
  });
});
