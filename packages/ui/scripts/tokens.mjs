// Reads brand/familywise-tokens.css (the source of truth for colors, 06 §11). Shared by the brand
// build script and the contrast test.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOKENS_FILE = join(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../..'),
  'brand/familywise-tokens.css',
);

/** `--name: value` declarations of the rule whose selector list contains `selector`. */
export function tokenBlock(css, selector) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selectors, body] of plain.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (!selectors.split(',').some((s) => s.trim() === selector)) continue;
    return Object.fromEntries(
      [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
    );
  }
  throw new Error(`no rule for ${selector} in the tokens file`);
}

/** Day and Evening token maps; Evening inherits everything it does not override. */
export function themes(css = readFileSync(TOKENS_FILE, 'utf8')) {
  const day = tokenBlock(css, ':root');
  return { day, evening: { ...day, ...tokenBlock(css, ':root[data-theme="evening"]') } };
}

/** Resolves var() chains to a #RRGGBB value. */
export function hexOf(tokens, name) {
  let value = tokens[name];
  for (let i = 0; value?.startsWith('var('); i++) {
    if (i > 5) throw new Error(`${name} does not resolve`);
    value = tokens[value.slice(4, -1).trim()];
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(value ?? '')) throw new Error(`${name} is not a #RRGGBB color`);
  return value.toUpperCase();
}
