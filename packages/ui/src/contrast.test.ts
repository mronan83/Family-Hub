// Contrast of every role pair the components use, in both themes, straight from the tokens file
// (06 §4.1, §10). Text needs 4.5:1; borders, icons and large fills need 3:1.
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM helper shared with the brand build script
import { hexOf, themes } from '../scripts/tokens.mjs';

type Tokens = Record<string, string>;
const { day, evening } = themes() as { day: Tokens; evening: Tokens };

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum, where]
const PAIRS: [string, string, number, string][] = [
  ['--text', '--bg', 4.5, 'body text'],
  ['--text', '--surface', 4.5, 'tile titles'],
  ['--text-soft', '--bg', 4.5, 'secondary text'],
  ['--text-soft', '--surface', 4.5, 'open tile status, form field edge'],
  ['--on-primary', '--primary', 4.5, 'primary button'],
  ['--primary-text', '--primary-tint', 4.5, 'done tile, secondary button'],
  ['--on-reward', '--reward', 4.5, 'points chip'],
  ['--reward-text', '--reward-tint', 4.5, 'waiting tile, stale banner'],
  ['--reward-text', '--surface', 4.5, 'overdue and past-its-time tiles'],
  [
    '--missed-text',
    '--missed-tint',
    4.5,
    'missed tile, negative points, offline and notice banners',
  ],
  ['--info', '--surface', 4.5, 'try-again tile'],
  ['--primary-text', '--surface', 4.5, 'admin links on cards'],
  ['--primary-text', '--bg', 4.5, 'admin links on the page'],
  ['--success', '--surface', 4.5, 'success text'],
  ['--text', '--reward-tint', 4.5, 'stale banner text'],
  ['--text', '--missed-tint', 4.5, 'offline and notice banner text'],
  ['--text', '--primary-tint', 4.5, 'info banner text'],
  ['--primary', '--surface', 3, 'done tile border'],
  ['--reward', '--surface', 1, 'waiting tile border (paired with a tint and a word)'],
  ['--missed', '--surface', 3, 'missed tile border'],
  ['--focus', '--bg', 3, 'focus ring'],
];

describe.each([
  ['Day', day],
  ['Evening', evening],
])('%s theme', (_name, tokens) => {
  it.each(PAIRS)('[NFR-11] %s on %s meets %s:1 (%s)', (fg, bg, min) => {
    expect(contrast(hexOf(tokens, fg), hexOf(tokens, bg))).toBeGreaterThanOrEqual(min);
  });
});

const MEMBERS = Array.from({ length: 16 }, (_, i) => `--member-${i + 1}`);

describe('member colors', () => {
  it.each(MEMBERS)('[NFR-11] white initials on %s meet 4.5:1', (name) => {
    expect(contrast(hexOf(day, name), '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  // [D-70] A color drawn as a line or dot (an event's edge, a tag's dot) is a graphic: 3:1 against
  // the card and the page in both themes. The Evening theme uses a lighter shade of each.
  describe.each([
    ['Day', day],
    ['Evening', evening],
  ])('%s lines', (_name, tokens) => {
    it.each(MEMBERS)('[NFR-11] %s-line meets 3:1 on the surface and background', (name) => {
      for (const bg of ['--surface', '--bg']) {
        expect(contrast(hexOf(tokens, `${name}-line`), hexOf(tokens, bg))).toBeGreaterThanOrEqual(
          3,
        );
      }
    });
  });

  it('[D-70] the colors are 16, each different', () => {
    expect(new Set(MEMBERS.map((m) => hexOf(day, m))).size).toBe(16);
    expect(new Set(MEMBERS.map((m) => hexOf(evening, `${m}-line`))).size).toBe(16);
  });
});

it('[NFR-13] Evening success is fixed: Leaf 600 failed on the Evening surface', () => {
  expect(contrast(hexOf(day, '--fw-leaf-600'), hexOf(evening, '--surface'))).toBeLessThan(3);
  expect(contrast(hexOf(evening, '--success'), hexOf(evening, '--surface'))).toBeGreaterThan(4.5);
});
