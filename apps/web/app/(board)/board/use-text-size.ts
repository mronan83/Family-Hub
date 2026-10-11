'use client';

import { applyBoardTextSize, type TextSize } from '@familywise/ui';
import { useEffect } from 'react';

/**
 * [BRD-08] Puts the board at its text size from the snapshot (D-73), and remembers it so the next
 * start paints at that size before the first read. The board's fit script does the zooming.
 */
export function useBoardTextSize(size: TextSize) {
  useEffect(() => {
    applyBoardTextSize(size);
  }, [size]);
}
