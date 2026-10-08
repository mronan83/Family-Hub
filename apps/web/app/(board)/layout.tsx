import { BoardThemeController, themeBootScript } from '@familywise/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The board: kiosk manifest (fullscreen, landscape), board type scale, Day or Evening by the
// clock. WP-06 passes the household timezone and the manual override to the controller.
export const metadata: Metadata = {
  title: { absolute: 'FamilyWise Board' },
  manifest: '/board.webmanifest',
};

export default function BoardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="board">
      <script dangerouslySetInnerHTML={{ __html: themeBootScript('board') }} />
      <BoardThemeController />
      {children}
    </div>
  );
}
