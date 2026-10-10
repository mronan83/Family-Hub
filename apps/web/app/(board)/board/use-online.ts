'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (changed: () => void) => {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
};

/** [DEV-08] Whether the browser has a network (on the server, assumed so). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

const never = () => () => undefined;

/**
 * False while the page hydrates, true after: what depends on the time or the network is drawn after
 * hydration, so a page the service worker kept (drawn hours ago) hydrates as it was drawn.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}
