import type { Theme } from '@familywise/ui';
import type { Metadata } from 'next';
import { DevBoard } from './dev-board';

// The board's Today with a made-up family and no database (WP-11), for the UI suite: the screen,
// its taps and states, in Day or Evening (?theme=evening).
export const metadata: Metadata = { title: 'Board Today', robots: { index: false } };

export default async function DevBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string }>;
}) {
  const theme: Theme = (await searchParams).theme === 'evening' ? 'evening' : 'day';
  return (
    <div className="board">
      <DevBoard theme={theme} />
    </div>
  );
}
