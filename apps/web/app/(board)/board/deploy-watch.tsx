'use client';

import { useEffect } from 'react';
import { DEPLOY_CHECK_MS, isNewDeploy, mayReload, RELOAD_CHECK_MS } from '@/lib/board-update';

const TOUCHES = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

/**
 * [DEV-05] Reloads the board when a new version is deployed (WP-78, D-99), once nobody is using it:
 * no dialog open and nobody has touched it for a while. `version` is the commit it runs.
 */
export function DeployWatch({ version }: { version: string }) {
  useEffect(() => {
    let lastTouch = Date.now();
    let found = false;
    const touched = () => {
      lastTouch = Date.now();
    };
    for (const t of TOUCHES) window.addEventListener(t, touched, { capture: true, passive: true });
    const check = setInterval(async () => {
      if (found) return;
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const body = (await res.json()) as { commit?: unknown };
        found = res.ok && isNewDeploy(version, body?.commit);
      } catch {
        // Offline or the server busy: asked again next time.
      }
    }, DEPLOY_CHECK_MS);
    const reload = setInterval(() => {
      if (found && mayReload(Date.now(), lastTouch, !!document.querySelector(DIALOG)))
        window.location.reload();
    }, RELOAD_CHECK_MS);
    return () => {
      clearInterval(check);
      clearInterval(reload);
      for (const t of TOUCHES) window.removeEventListener(t, touched, { capture: true });
    };
  }, [version]);
  return null;
}
