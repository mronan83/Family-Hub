import { themeBootScript } from '@familywise/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// The board: kiosk manifest (fullscreen, landscape), board type scale, and a fixed scale (no pinch
// zoom on a touch panel). The boot script paints Day or Evening by the device clock; once the
// snapshot arrives the board follows the household's timezone and its own theme setting (board.tsx).
export const metadata: Metadata = {
  title: { absolute: 'FamilyWise Board' },
  manifest: '/board.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function BoardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="board">
      <script dangerouslySetInnerHTML={{ __html: themeBootScript('board') }} />
      {children}
    </div>
  );
}
