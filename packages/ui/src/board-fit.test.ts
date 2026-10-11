import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { boardFitScript, boardZoom, TEXT_SIZES, textSizeOf, type TextSize } from './board-fit';

// [BRD-08] The board fits the screen it is on (WP-47, D-73).

describe('the board fits its screen', () => {
  it('[BRD-08] is zoomed to the 1920×1080 canvas: 4K twice, 1080p once, a laptop smaller', () => {
    expect(boardZoom(1920, 1080)).toBe(1);
    // A 32" 4K panel at device scale 1, and the same panel at scale 2 (D-16).
    expect(boardZoom(3840, 2160)).toBe(2);
    // A 13" MacBook Air's browser window.
    expect(boardZoom(1470, 830)).toBe(0.766);
    expect(boardZoom(1280, 720)).toBe(0.667);
    // A wider or taller screen than 16:9 fits by its shorter side; the rest is more room.
    expect(boardZoom(2560, 1080)).toBe(1);
    expect(boardZoom(1920, 1200)).toBe(1);
    // Never below half size, nor above four times.
    expect(boardZoom(390, 844)).toBe(0.5);
    expect(boardZoom(15360, 8640)).toBe(4);
  });

  it('[BRD-08] each text size scales the board: larger text fits less on the screen', () => {
    expect(TEXT_SIZES.map((t) => boardZoom(1920, 1080, t.value))).toEqual([0.85, 1, 1.15, 1.3]);
    expect(boardZoom(3840, 2160, 'largest')).toBe(2.6);
    expect(textSizeOf('larger')).toBe('larger');
    expect(textSizeOf('huge')).toBe('standard');
    expect(textSizeOf(undefined)).toBe('standard');
  });

  it('[BRD-08] the first-paint script zooms exactly as boardZoom does, and remembers the size', () => {
    const run = (width: number, height: number, stored: string | null) => {
      const style = new Map<string, string>();
      const board = {
        style: { setProperty: (k: string, v: string) => style.set(k, v) },
        dataset: {} as Record<string, string>,
      };
      const storage = new Map<string, string>(stored ? [['fw-text-size', stored]] : []);
      const listeners: (() => void)[] = [];
      const window = {
        innerWidth: width,
        innerHeight: height,
        document: { documentElement: board },
        localStorage: {
          getItem: (k: string) => storage.get(k) ?? null,
          setItem: (k: string, v: string) => storage.set(k, v),
        },
        addEventListener: (_: string, f: () => void) => listeners.push(f),
      } as Record<string, unknown>;
      window.window = window;
      runInNewContext(boardFitScript(), window);
      return { zoom: () => Number(style.get('--fw-zoom')), window, board, storage, listeners };
    };
    for (const [w, h] of [
      [1920, 1080],
      [3840, 2160],
      [1470, 830],
      [390, 844],
      [2560, 1080],
    ]) {
      for (const t of TEXT_SIZES) {
        expect(run(w!, h!, t.value).zoom(), `${w}×${h} ${t.value}`).toBe(
          boardZoom(w!, h!, t.value),
        );
      }
    }
    // Nothing stored, or something odd: Standard.
    expect(run(3840, 2160, null).zoom()).toBe(2);
    expect(run(3840, 2160, 'huge').zoom()).toBe(2);
    // A new size from the snapshot applies at once and is kept for the next start.
    const board = run(1920, 1080, null);
    (board.window.__fwFit as (s: TextSize) => void)('larger');
    expect(board.zoom()).toBe(1.15);
    expect(board.board.dataset.textSize).toBe('larger');
    expect(board.storage.get('fw-text-size')).toBe('larger');
    // The window changing size fits it again.
    board.window.innerWidth = 3840;
    board.window.innerHeight = 2160;
    board.listeners.forEach((f) => f());
    expect(board.zoom()).toBe(2.3);
  });
});
