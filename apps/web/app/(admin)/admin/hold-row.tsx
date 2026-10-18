'use client';

import { Icon } from '@familywise/ui';
import { type ReactNode, useEffect, useRef } from 'react';

/** How long a press is held before it opens the row's menu (Q5). */
export const HOLD_MS = 500;
/** A press that moves further than this is a scroll, not a hold. */
const SLOP_PX = 10;

/**
 * [CHR-21][NFR-18][D-132] A two-line row with its actions in a ⋯ menu (WP-96): Chores, the Meal
 * library and Tags. ⋯ is the browser's own <details>, so it opens before the page hydrates; pressing
 * and holding the row, by touch or mouse, opens the same menu (Q5). The row is drawn without
 * Safari's callout and text selection, and its context menu is the row's own, so holding it in
 * Safari on an iPhone opens the menu, never Safari's link preview. A tap outside the menu, or
 * Escape, closes it.
 */
export function HoldRow({
  menuLabel,
  menu,
  open,
  up = false,
  className,
  id,
  children,
  after,
}: {
  /** The ⋯ button's name: "More for Homework". */
  menuLabel: string;
  /** The menu's items. */
  menu: ReactNode;
  /** Open at first (the dev page's picture of an open menu). */
  open?: boolean;
  /** The menu opens above the row: near the bottom of the page. */
  up?: boolean;
  className?: string;
  id?: string;
  /** The row's icon and two lines. */
  children: ReactNode;
  /** Shown under the row, across it: an Edit form opened in place. */
  after?: ReactNode;
}) {
  const row = useRef<HTMLLIElement>(null);
  const more = useRef<HTMLDetailsElement>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const show = () => {
    if (more.current) more.current.open = true;
    more.current?.querySelector<HTMLElement>('.fw-row__mi')?.focus({ preventScroll: true });
  };
  const inMenu = (t: EventTarget | null) =>
    t instanceof Node && (more.current?.contains(t) ?? false);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (more.current?.open && !row.current?.contains(e.target as Node)) more.current.open = false;
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && more.current?.open) {
        more.current.open = false;
        more.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      stop();
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  return (
    <li
      ref={row}
      id={id}
      className={`fw-row${className ? ` ${className}` : ''}`}
      data-hold=""
      onPointerDown={(e) => {
        if (e.button !== 0 || inMenu(e.target)) return;
        held.current = false;
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = window.setTimeout(() => {
          held.current = true;
          stop();
          show();
        }, HOLD_MS);
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > SLOP_PX) stop();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // A hold ends in a click on the name's link: it only opened the menu.
      onClickCapture={(e) => {
        if (held.current && !inMenu(e.target)) {
          e.preventDefault();
          e.stopPropagation();
        }
        held.current = false;
      }}
      // A long press on Android, or a right click, opens the row's menu, not the browser's.
      onContextMenu={(e) => {
        if (inMenu(e.target)) return;
        e.preventDefault();
        stop();
        show();
      }}
    >
      {children}
      <details
        ref={more}
        className={`fw-row__more${up ? ' fw-row__more--up' : ''}`}
        open={open || undefined}
      >
        <summary className="fw-row__morebtn" aria-label={menuLabel}>
          <Icon name="more" />
        </summary>
        <div className="fw-row__menu">{menu}</div>
      </details>
      {after ? <div className="fw-row__after">{after}</div> : null}
    </li>
  );
}
