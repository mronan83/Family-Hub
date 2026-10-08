'use client';
// Registers /sw.js, which precaches the self-hosted fonts so the board renders offline (06 §5).
import { useEffect } from 'react';

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the app works without it, only offline fonts depend on it.
    });
  }, []);
  return null;
}
