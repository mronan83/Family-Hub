// [BRD-08] The board fits the screen it is on (WP-47, D-73). It is laid out on the 1920×1080
// logical canvas of D-16 and zoomed to the screen: the smaller of width ÷ 1920 and height ÷ 1080,
// times the board's text size. A 32" 4K panel showing 3840×2160 CSS px gets 2 (everything twice as
// many pixels, so sharper, never smaller); a 24" 1080p screen 1; a 13" laptop's browser about 0.77.
// The zoom is CSS `zoom` on `.board` (ui.css), so type, spacing, touch targets and pictures scale
// together, and a board on a panel at device scale 2 (1920×1080 CSS px) is unchanged at 1.

export type TextSize = 'smaller' | 'standard' | 'larger' | 'largest';

/** The board's text sizes, as Boards offers them. Larger text fits less on the screen. */
export const TEXT_SIZES: readonly { value: TextSize; label: string; scale: number }[] = [
  { value: 'smaller', label: 'Smaller', scale: 0.85 },
  { value: 'standard', label: 'Standard', scale: 1 },
  { value: 'larger', label: 'Larger', scale: 1.15 },
  { value: 'largest', label: 'Largest', scale: 1.3 },
];

/** The logical canvas the board is designed on (D-16). */
export const BOARD_CANVAS = { width: 1920, height: 1080 } as const;
/** Below half size the words are too small to read across a room; the board scrolls instead. */
export const BOARD_ZOOM_MIN = 0.5;
export const BOARD_ZOOM_MAX = 4;
/** Where a board remembers its text size, so it starts at the right size before its first read. */
export const TEXT_SIZE_KEY = 'fw-text-size';

export function textSizeOf(value: unknown): TextSize {
  return TEXT_SIZES.find((t) => t.value === value)?.value ?? 'standard';
}

/** [BRD-08] The board's zoom on a screen of `width` × `height` CSS px, to three decimals. */
export function boardZoom(width: number, height: number, size: TextSize = 'standard'): number {
  const scale = TEXT_SIZES.find((t) => t.value === size)?.scale ?? 1;
  const fit = Math.min(width / BOARD_CANVAS.width, height / BOARD_CANVAS.height) * scale;
  return Math.round(Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, fit)) * 1000) / 1000;
}

/**
 * A tiny script placed first inside `.board`, so the first paint is already at the screen's size:
 * it sets `--fw-zoom` (and `data-text-size`) on <html>, which `.board` inherits, from the window's
 * size and the text size the board last had, again whenever the window changes size, and gives the
 * page `__fwFit(size)` for a new text size. On <html> rather than `.board`, because React replaces
 * `.board` when it has to draw the page afresh; it keeps <html>, and the board's effect fits again.
 * It is `boardZoom` written out, from the same numbers (board-fit.test.ts checks they agree).
 */
export function boardFitScript(): string {
  const scales = Object.fromEntries(TEXT_SIZES.map((t) => [t.value, t.scale]));
  const { width, height } = BOARD_CANVAS;
  return (
    `(function(){var r=document.documentElement;` +
    `var S=${JSON.stringify(scales)},size='standard';` +
    `try{var s=localStorage.getItem(${JSON.stringify(TEXT_SIZE_KEY)});if(S[s])size=s}catch(e){}` +
    `function fit(){var z=Math.min(innerWidth/${width},innerHeight/${height})*S[size];` +
    `z=Math.round(Math.min(${BOARD_ZOOM_MAX},Math.max(${BOARD_ZOOM_MIN},z))*1000)/1000;` +
    `r.style.setProperty('--fw-zoom',String(z));r.dataset.textSize=size}` +
    `window.__fwFit=function(s){if(!S[s])return;size=s;` +
    `try{localStorage.setItem(${JSON.stringify(TEXT_SIZE_KEY)},s)}catch(e){}fit()};` +
    `fit();addEventListener('resize',fit)})()`
  );
}

/** [BRD-08] Puts the board at a text size (from its snapshot) and remembers it for the next start. */
export function applyBoardTextSize(size: TextSize): void {
  const w = window as Window & { __fwFit?: (s: TextSize) => void };
  if (!w.__fwFit) {
    // A page reached without the first-paint script (a visit within the app): fit from here on.
    const root = document.documentElement;
    let current = size;
    const fit = () => {
      root.style.setProperty('--fw-zoom', String(boardZoom(innerWidth, innerHeight, current)));
      root.dataset.textSize = current;
    };
    w.__fwFit = (s) => {
      current = s;
      try {
        localStorage.setItem(TEXT_SIZE_KEY, s);
      } catch {
        // Private windows: the size still applies, it just isn't remembered.
      }
      fit();
    };
    addEventListener('resize', fit);
  }
  w.__fwFit(size);
}

/**
 * The board's zoom where `el` is, for turning what the browser measures on screen (pointer
 * positions, `getBoundingClientRect`) back into the board's logical px.
 */
export function zoomAt(el: Element): number {
  const z = Number.parseFloat(getComputedStyle(el).getPropertyValue('--fw-zoom'));
  return Number.isFinite(z) && z > 0 ? z : 1;
}
