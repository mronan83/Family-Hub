'use client';

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BoardSleep, boardAsleep, drift, type SchoolDays } from '@/lib/board-sleep';
import { onPi, tellScreen } from '@/lib/kiosk-screen';

/** What wakes a board, and counts as it being touched: a touch, a click, the mouse moving. */
const TOUCHES = ['pointerdown', 'pointermove', 'touchstart', 'keydown', 'wheel'] as const;
/** How often a board looks again whether it should be asleep. */
const CHECK_MS = 15_000;
/** How often a board on a Pi tells its screen again, so the screen follows after a restart. */
const SCREEN_AGAIN_MS = 60_000;

/** What `useBoardSleep` says. */
export interface Sleeping {
  asleep: boolean;
  /** The touch or click that woke it is still going on: its click must not reach the board. */
  catching: boolean;
  /** That click has come (or the touch was called off). */
  caught: () => void;
}

/**
 * [DEV-07][US-207] Whether the board is asleep now (WP-34, D-116): at its set times, or untouched
 * for its idle time. Every touch, click or mouse movement counts as being touched; one while it is
 * asleep wakes it at once. A press that wakes it is caught until its click (SleepCover), decided
 * here in the same moment as waking, so the cover can't go before the press is over. When it
 * opened and when it was last touched outlive a new snapshot.
 */
export function useBoardSleep(
  sleep: BoardSleep,
  timeZone: string,
  school: SchoolDays | null,
): Sleeping {
  const [asleep, setAsleep] = useState(false);
  const [catching, setCatching] = useState(false);
  const since = useRef<number | null>(null);
  const lastTouch = useRef<number | null>(null);
  const isAsleep = useRef(false);
  // A new snapshot is a new object with the same settings: only a real change starts again.
  const key = JSON.stringify([
    sleep,
    timeZone,
    school?.from,
    school?.to,
    [...(school?.days ?? [])],
  ]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for all three
  const settings = useMemo(() => ({ sleep, timeZone, school }), [key]);

  useEffect(() => {
    if (since.current === null) since.current = Date.now();
    const check = () => {
      const next = boardAsleep(
        settings.sleep,
        { now: Date.now(), lastTouch: lastTouch.current, since: since.current ?? Date.now() },
        settings.timeZone,
        settings.school,
      );
      if (next !== isAsleep.current) {
        isAsleep.current = next;
        setAsleep(next);
      }
    };
    const touched = (e: Event) => {
      // A finger dragging is a touch already; only the mouse wakes it by moving.
      if (e.type === 'pointermove' && (e as PointerEvent).pointerType !== 'mouse') return;
      lastTouch.current = Date.now();
      if (!isAsleep.current) return;
      if (e.type === 'pointerdown' || e.type === 'touchstart') setCatching(true);
      check();
    };
    for (const t of TOUCHES) window.addEventListener(t, touched, { capture: true, passive: true });
    const first = setTimeout(check, 0);
    const timer = setInterval(check, CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      for (const t of TOUCHES) window.removeEventListener(t, touched, { capture: true });
    };
  }, [settings]);
  const caught = useCallback(() => setCatching(false), []);
  return { asleep, catching, caught };
}

/** [DEV-07] On a Pi, the screen's power follows the board: off asleep, on awake. */
export function useScreenPower(asleep: boolean) {
  const [pi, setPi] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void onPi().then((yes) => {
      if (!cancelled) setPi(yes);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!pi) return;
    void tellScreen(!asleep);
    const again = setInterval(() => void tellScreen(!asleep), SCREEN_AGAIN_MS);
    return () => clearInterval(again);
  }, [pi, asleep]);
}

/** [DEV-07] The board's picture moved a px or two, so nothing stays on the same pixels all day. */
export function driftStyle(now: Date): CSSProperties {
  const { x, y } = drift(now.getTime());
  return { left: `${x}px`, top: `${y}px` };
}

/**
 * [DEV-07][US-207] The sleeping board: a black screen over everything (WP-34, D-116). The touch
 * or click that wakes it lands here, so it only wakes it and never presses what is under it: the
 * cover stays, clear, until that touch's click has come and gone. The mouse moving wakes it too.
 */
export function SleepCover({ sleeping, name }: { sleeping: Sleeping; name: string }) {
  const { asleep, catching, caught } = sleeping;
  if (!asleep && !catching) return null;
  return (
    <div
      className="fw-sleep"
      data-state={asleep ? 'asleep' : 'waking'}
      role="button"
      tabIndex={-1}
      aria-label={asleep ? `${name} is asleep. Touch to wake it.` : `${name} is waking`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        caught();
      }}
      onPointerCancel={caught}
      onContextMenu={(e) => {
        e.preventDefault();
        caught();
      }}
      onKeyDown={(e) => e.preventDefault()}
    />
  );
}
