'use client';

import { BootSplash } from '@familywise/ui';
import { useEffect } from 'react';

const RETRY_MS = 30_000;

// [DEV-05] Nobody is at the board to press reload: when it cannot load, it says so on the boot
// surface and tries again every 30 seconds.
export default function BoardError() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), RETRY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <BootSplash message="Can’t reach FamilyWise">
      <p>Trying again in 30 seconds.</p>
    </BootSplash>
  );
}
