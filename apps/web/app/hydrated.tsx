'use client';

import { useEffect } from 'react';

/**
 * [NFR-14][D-105] Marks the page once React has hydrated it (`<html data-hydrated="true">`). Until
 * then a form's submit is the browser's own, which reloads the page and saves nothing, so e2e waits
 * for this mark after every page load before it touches the page (e2e/support/test.ts).
 */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
  }, []);
  return null;
}
