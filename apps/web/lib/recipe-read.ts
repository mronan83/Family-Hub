// [MEAL-25] Reading a recipe's ingredients (WP-105, D-138 (6), Q21): from a web page's published
// recipe data (schema.org Recipe in JSON-LD, as most recipe sites publish it), or from the text of a
// PDF or a photo; then each line as a row to check: the amount to buy kept ("1 lb", "8", "2 cans"),
// a recipe's measure left off ("2 tbsp", "1 cup"), and the name cleaned. Pure: no I/O.

import type { Ingredient } from './meals';
import { amountOf, amountWords, numberOf } from './grocery-merge';

export interface RecipeData {
  name: string | null;
  ingredients: string[];
  steps: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  deg: '°',
};

/** Text with its HTML entities and tags taken out, and its spaces made single. */
export function plain(s: string): string {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

const isRecipe = (x: unknown): x is Record<string, unknown> => {
  if (typeof x !== 'object' || x === null) return false;
  const t = (x as { '@type'?: unknown })['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

/** The first Recipe in a JSON-LD value: on its own, in a list, or in a @graph. */
function findRecipe(x: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 4 || x === null || typeof x !== 'object') return null;
  if (isRecipe(x)) return x;
  const list = Array.isArray(x) ? x : (x as { '@graph'?: unknown })['@graph'];
  if (Array.isArray(list)) {
    for (const y of list) {
      const r = findRecipe(y, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** recipeInstructions as steps: a string, a list of strings, HowToSteps, or HowToSections of them. */
function stepsOf(x: unknown, depth = 0): string[] {
  if (depth > 6 || x == null) return [];
  if (typeof x === 'string') {
    const text = plain(x);
    return text
      ? text
          .split(/(?<=\.)\s+(?=[A-Z])|\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  }
  if (Array.isArray(x)) return x.flatMap((y) => stepsOf(y, depth + 1));
  if (typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if (o.itemListElement) return stepsOf(o.itemListElement, depth + 1);
    if (typeof o.text === 'string') return stepsOf(o.text, depth + 1);
    if (typeof o.name === 'string') return stepsOf(o.name, depth + 1);
  }
  return [];
}

/**
 * [MEAL-25] A page's published recipe data: its name, ingredient lines and steps; null when the
 * page publishes none.
 */
export function recipeFromHtml(html: string): RecipeData | null {
  const blocks = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const [, body] of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(body!.trim());
    } catch {
      continue;
    }
    const r = findRecipe(data);
    if (!r) continue;
    const raw = r.recipeIngredient ?? r.ingredients;
    const ingredients = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
      .filter((s): s is string => typeof s === 'string')
      .map(plain)
      .filter(Boolean)
      .slice(0, 60);
    return {
      name: typeof r.name === 'string' ? plain(r.name) || null : null,
      ingredients,
      steps: stepsOf(r.recipeInstructions)
        .slice(0, 60)
        .map((s) => s.slice(0, 500)),
    };
  }
  return null;
}

// Units a recipe measures in, not what a shop sells: the amount is left off.
const MEASURES = new Set([
  'tsp',
  'tsps',
  'teaspoon',
  'teaspoons',
  'tbsp',
  'tbsps',
  'tbs',
  'tablespoon',
  'tablespoons',
  'cup',
  'cups',
  'c',
  'pinch',
  'pinches',
  'dash',
  'dashes',
  'clove',
  'cloves',
  'slice',
  'slices',
  'handful',
  'handfuls',
  'sprig',
  'sprigs',
  'ml',
  'g',
  'grams',
  'stick',
  'sticks',
  'drop',
  'drops',
]);
const SIZES = /^(?:large|small|medium|big|fresh|extra[- ]large|whole|ripe)\s+/i;
const NUMBER = String.raw`\d+\s+\d+\s*/\s*\d+|\d+\s*/\s*\d+|\d+(?:\.\d+)?|½|¼|¾|⅓|⅔`;

/**
 * [MEAL-25] A recipe's line as a row to check: "1 lb ground beef" → 1 lb of Ground beef; "8 small
 * corn tortillas" → 8 Corn tortillas; "1 (15 oz) can black beans" → 1 can of Black beans; "2 tbsp
 * chili powder" → Chili powder, no amount (a measure, not what to buy); null for a line with no name.
 */
export function ingredientRow(line: string): Ingredient | null {
  let t = plain(line)
    .replace(/^[-–•*▢☐]\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/\b(?:to taste|as needed|optional|for serving|divided)\b/gi, '')
    // A photo read by text recognition often takes "lb" for "Ib" or "1b".
    .replace(/\b(\d+(?:\.\d+)?|½|¼|¾)\s*[Il1]bs?\b/g, '$1 lb')
    .replace(/\s+/g, ' ')
    .trim();
  let amount: string | null = null;
  const lead = new RegExp(
    `^(${NUMBER})(?:\\s*(?:-|to)\\s*(?:${NUMBER}))?\\s*([a-z]+\\.?)?\\s+(.*)$`,
    'i',
  ).exec(t);
  if (lead) {
    const qty = lead[1]!.replace('⅓', '1/3').replace('⅔', '2/3');
    const word = (lead[2] ?? '').replace(/\.$/, '').toLowerCase();
    const rest = lead[3]!;
    const unit = word ? amountOf(`${numberOf(qty) ?? 1} ${word}`) : null;
    if (word && MEASURES.has(word)) {
      t = rest;
    } else if (unit && unit.unit) {
      amount = amountWords({ ...unit, qty: numberOf(qty) ?? unit.qty });
      t = rest;
    } else {
      // A count: "2 onions", "8 small corn tortillas".
      const n = numberOf(qty);
      amount = n !== null ? String(n) : null;
      t = word ? `${lead[2]} ${rest}` : rest;
    }
  }
  t = t
    .replace(/^of\s+/i, '')
    .replace(SIZES, '')
    .replace(SIZES, '')
    .trim();
  if (!/[a-z]/i.test(t)) return null;
  const name = (t.charAt(0).toUpperCase() + t.slice(1)).slice(0, 80);
  return { name, amount, have: false };
}

/** [MEAL-25] Rows from a recipe's lines, each read, the empty ones left out. */
export function ingredientRows(lines: readonly string[]): Ingredient[] {
  return lines
    .map(ingredientRow)
    .filter((r): r is Ingredient => r !== null)
    .slice(0, 60);
}

/**
 * [MEAL-25] The ingredient lines in a PDF's or a photo's text: the lines under an "Ingredients"
 * heading up to the method; with no such heading, the lines that start with an amount.
 */
export function ingredientLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const start = lines.findIndex((l) => /^ingredients\b:?$/i.test(l) || /^ingredients:/i.test(l));
  if (start >= 0) {
    const out: string[] = [];
    const first = lines[start]!.replace(/^ingredients:?/i, '').trim();
    if (first) out.push(first);
    for (const l of lines.slice(start + 1)) {
      if (/^(?:method|directions|instructions|steps|preparation|to make)\b/i.test(l)) break;
      out.push(l);
    }
    return out.slice(0, 60);
  }
  return lines.filter((l) => new RegExp(`^(?:[-•*]\\s*)?(?:${NUMBER})\\s`).test(l)).slice(0, 60);
}
