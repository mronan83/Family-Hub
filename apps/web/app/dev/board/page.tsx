import { boardFitScript, textSizeOf, type Theme } from '@familywise/ui';
import type { Metadata } from 'next';
import { CARD_IDS, readLayout } from '@/lib/board-layout';
import { readBoardSleep } from '@/lib/board-sleep';
import { DevBoard } from './dev-board';
import { KITCHEN_SLEEP } from './fixture';

// The board's Today with a made-up family and no database (WP-11), for the UI suite: the screen,
// its taps and states, in Day or Evening (?theme=evening); old data (?stale=1) or a job behind
// (?jobs=1) for the board's health lines (WP-13); a goal just reached (?celebrate=1, WP-20); a busy
// month (?busy=1), more all-day events today (?allday=1, WP-52) or a calendar that can't sync
// (?calbehind=1) on the calendar (WP-23); the home
// screen's layout (WP-35): the calendar's span (?span=3|5|7|month) and the cards shown, in order
// (?cards=goals,coming; the others hidden); the weather beside the clock (WP-45: ?weather=rain|snow|
// night|celsius|yesterday|none, or ?weather=off for a layout that turns it off); the board fitted to
// the window at a text size (WP-47: ?text=smaller|larger|largest); no meals planned (WP-28: ?meals=none);
// Leo's item that opens Lunches (WP-49: ?lunches=1); a board watching for a new deploy, running the
// commit given (WP-78: ?deploy=<commit>); asleep and woken (WP-34: ?sleep=kitchen, Kitchen's set times
// from the mockup, school nights 9:30 pm to 6:30 am and weekends 10:30 pm to 7:30 am, 15 minutes
// untouched; ?sleep=idle, 5 minutes untouched and no set times; the school days are Monday to Friday);
// repeating goals (WP-80: ?repeating=going|missed|won, Maya's homework this week, Leo's reading missed).
export const metadata: Metadata = { title: 'Board Today', robots: { index: false } };

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<{
    theme?: string;
    stale?: string;
    jobs?: string;
    celebrate?: string;
    busy?: string;
    allday?: string;
    calbehind?: string;
    span?: string;
    cards?: string;
    weather?: string;
    text?: string;
    meals?: string;
    lunches?: string;
    deploy?: string;
    sleep?: string;
    repeating?: string;
  }>;
}) {
  const params = await searchParams;
  const theme: Theme = params.theme === 'evening' ? 'evening' : 'day';
  const shown = params.cards?.split(',') ?? [];
  const layout =
    params.span || params.cards || params.weather === 'off'
      ? (readLayout({
          ...(params.weather === 'off' ? { weather: false } : {}),
          ...(params.span ? { calendar: params.span } : {}),
          ...(params.cards
            ? {
                cards: [
                  ...shown.map((id) => ({ id, show: true })),
                  ...CARD_IDS.filter((id) => !shown.includes(id)).map((id) => ({
                    id,
                    show: false,
                  })),
                ],
              }
            : {}),
        }) ?? undefined)
      : undefined;
  // When the server drew this page: the same after a reload means it came from the service worker.
  const rendered = new Date().toISOString();
  return (
    <div className="board" data-rendered={rendered}>
      <script dangerouslySetInnerHTML={{ __html: boardFitScript() }} />
      <DevBoard
        theme={theme}
        stale={params.stale === '1'}
        jobs={params.jobs === '1'}
        celebrate={params.celebrate === '1'}
        busy={params.busy === '1'}
        full={params.allday === '1'}
        calBehind={params.calbehind === '1'}
        layout={layout}
        weather={params.weather}
        meals={params.meals}
        textSize={textSizeOf(params.text)}
        lunchItem={params.lunches === '1'}
        deploy={params.deploy}
        sleep={
          params.sleep === 'kitchen'
            ? KITCHEN_SLEEP
            : params.sleep === 'idle'
              ? readBoardSleep({ idle_minutes: 5 })
              : undefined
        }
        repeating={
          params.repeating === 'going' ||
          params.repeating === 'missed' ||
          params.repeating === 'won'
            ? params.repeating
            : undefined
        }
      />
    </div>
  );
}
