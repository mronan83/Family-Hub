import { TEXT_SIZES } from '@familywise/ui';
import { readLayout } from './board-layout';
import { boardMissed, readBoardSleep, type SchoolDays, sleepStatus } from './board-sleep';
import { type BoardThemeSetting, boardTextSize, boardThemeSetting } from './devices';
import { agoWords } from './format';
import { howLong } from './home-alerts';

// [DEV-09][D-118] What a board's folded header on Boards says about it (WP-91): its facts, and Home's
// not-seen warning when Home would list it.

/** [DEV-05] A board's theme in a few words, on its folded header (WP-91). */
export const THEME_WORDS: Record<BoardThemeSetting, string> = {
  auto: 'Automatic',
  day: 'Always Day',
  evening: 'Always Evening',
};

/**
 * [DEV-03] When a board was last seen, as its folded header says it (WP-91): "seen just now",
 * "seen 5 min ago", "seen 7 h ago", then the day and time; "not seen yet" for a new board.
 */
export function seenWords(lastSeenAt: string | null, now: number, timeZone: string): string {
  return lastSeenAt ? `seen ${agoWords(lastSeenAt, now, timeZone)}` : 'not seen yet';
}

/** What a board's folded header on Boards says about it (WP-91, D-118). */
export interface BoardFacts {
  /** "Awake · sleeps at 9:30 pm · seen 1 min ago · Automatic · Standard text · household layout" */
  meta: string;
  /** "Not seen for 2 days" when Home lists it as not seen, by its Tell me when choice; else null. */
  warning: string | null;
}

/**
 * [DEV-03][DEV-05][DEV-07][BRD-05][BRD-08][DEV-09][D-118] A board's facts on its folded header (WP-91):
 * awake or asleep and the next time (or no set times), when it was last seen, its theme and text
 * size, its own layout or the household's; and Home's not-seen warning, by its Tell me when choice.
 */
export function boardFacts(
  board: { lastSeenAt: string | null; config: unknown },
  now: number,
  timeZone: string,
  school: SchoolDays | null,
): BoardFacts {
  const config = board.config as { sleep?: unknown; layout?: unknown } | null;
  const sleep = readBoardSleep(config?.sleep);
  const size = boardTextSize(board.config);
  const sizeLabel = TEXT_SIZES.find((t) => t.value === size)?.label ?? 'Standard';
  const meta = [
    sleepStatus(sleep, now, timeZone, school)?.text ?? 'Awake · no set times',
    seenWords(board.lastSeenAt, now, timeZone),
    THEME_WORDS[boardThemeSetting(board.config)],
    `${sizeLabel} text`,
    readLayout(config?.layout) ? 'its own layout' : 'household layout',
  ].join(' · ');
  const missed = boardMissed(sleep, board.lastSeenAt, now, timeZone, school);
  return {
    meta,
    warning: missed
      ? `Not seen for ${howLong((now - new Date(board.lastSeenAt!).getTime()) / 60_000)}`
      : null,
  };
}
