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
    const set = () => board.style.setProperty('--bar-h', `${el.getBoundingClientRect().height}px`);
    set();
    const watch = new ResizeObserver(set);
    watch.observe(el);
    return () => watch.disconnect();
  }, [bar]);
}
