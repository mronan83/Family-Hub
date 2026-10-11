'use client';

import { type RefObject, useEffect } from 'react';

/**
 * [D-66] Keeps `--bar-h` on the board at its bar's height, so the people stay pinned just under the
 * bar while the dashboard scrolls.
 */
export function useBarHeight(bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = bar.current;
    const board = el?.parentElement;
    if (!el || !board || typeof ResizeObserver === 'undefined') return;
    // offsetHeight is in the board's own px; getBoundingClientRect is on screen, after the board's
    // zoom (BRD-08), which --bar-h would then get twice.
    const set = () => board.style.setProperty('--bar-h', `${el.offsetHeight}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => watch.disconnect();
  }, [bar]);
}
