import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { fetchRecipePage, isPrivateAddress, LIMITS, type FetchDeps } from './recipe-fetch';
import { type Ocr, pdfText, photoText, type PdfJs } from './recipe-files';
import { ingredientLines, ingredientRow, ingredientRows, recipeFromHtml } from './recipe-read';

const fixture = (name: string) => join(__dirname, '__fixtures__', name);
const page = (ld: unknown) =>
  `<html><head><title>Tacos</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>…</body></html>`;

describe('a recipe link’s published recipe data', () => {
  it('[MEAL-25-a] reads a Recipe on its own, with its ingredients and steps', () => {
    const r = recipeFromHtml(
      page({
        '@context': 'https://schema.org',
        '@type': 'Recipe',
        name: 'Tasty &amp; quick tacos',
        recipeIngredient: ['1 lb ground beef', '8 small corn tortillas', '1 onion, diced'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Brown the beef with the onion, 8 minutes.' },
          { '@type': 'HowToStep', text: 'Warm the tortillas.' },
        ],
      }),
    );
    expect(r).toEqual({
      name: 'Tasty & quick tacos',
      ingredients: ['1 lb ground beef', '8 small corn tortillas', '1 onion, diced'],
      steps: ['Brown the beef with the onion, 8 minutes.', 'Warm the tortillas.'],
    });
  });

  it('[MEAL-25-a] finds it in a list or a @graph, with steps in sections or one string', () => {
    const inGraph = recipeFromHtml(
      `<script type="application/ld+json">{"@type":"WebSite"}</script>` +
        page({
          '@graph': [
            { '@type': 'WebPage' },
            {
              '@type': ['Recipe', 'Thing'],
              name: 'Chili',
              recipeIngredient: ['2 cans kidney beans', '1&nbsp;lb ground beef'],
              recipeInstructions: [
                {
                  '@type': 'HowToSection',
                  name: 'Cook',
                  itemListElement: [{ '@type': 'HowToStep', text: 'Simmer.' }],
                },
              ],
            },
          ],
        }),
    );
    expect(inGraph?.ingredients).toEqual(['2 cans kidney beans', '1 lb ground beef']);
    expect(inGraph?.steps).toEqual(['Simmer.']);
    const inList = recipeFromHtml(
      page([
        { '@type': 'Recipe', recipeIngredient: ['Salt'], recipeInstructions: 'Mix it. Bake it.' },
      ]),
    );
    expect(inList?.steps).toEqual(['Mix it.', 'Bake it.']);
  });

  it('[MEAL-25-a] says when a page publishes none', () => {
    expect(recipeFromHtml('<html><body><h1>Tacos</h1></body></html>')).toBeNull();
    expect(recipeFromHtml('<script type="application/ld+json">{ not json</script>')).toBeNull();
    expect(recipeFromHtml(page({ '@type': 'Article' }))).toBeNull();
  });
});

describe('a recipe’s lines as rows to check', () => {
  it('[MEAL-25-b] keeps an amount to buy, leaves a recipe’s measure off, cleans the name', () => {
    expect(ingredientRow('1 lb ground beef')).toEqual({
      name: 'Ground beef',
      amount: '1 lb',
      have: false,
    });
    expect(ingredientRow('8 small corn tortillas')).toEqual({
      name: 'Corn tortillas',
      amount: '8',
      have: false,
    });
    expect(ingredientRow('1 onion, diced')).toEqual({ name: 'Onion', amount: '1', have: false });
    expect(ingredientRow('2 cans kidney beans')).toEqual({
      name: 'Kidney beans',
      amount: '2 cans',
      have: false,
    });
    expect(ingredientRow('1 (15 oz) can black beans, drained')).toEqual({
      name: 'Black beans',
      amount: '1 can',
      have: false,
    });
    expect(ingredientRow('2 tbsp chili powder')).toEqual({
      name: 'Chili powder',
      amount: null,
      have: false,
    });
    expect(ingredientRow('1 cup shredded cheddar')).toEqual({
      name: 'Shredded cheddar',
      amount: null,
      have: false,
    });
    expect(ingredientRow('3 cloves garlic, minced')).toEqual({
      name: 'Garlic',
      amount: null,
      have: false,
    });
    expect(ingredientRow('Salt and pepper to taste')).toEqual({
      name: 'Salt and pepper',
      amount: null,
      have: false,
    });
    expect(ingredientRow('▢ ½ lb ham')).toEqual({ name: 'Ham', amount: '0.5 lb', have: false });
    expect(ingredientRow('2')).toBeNull();
    expect(ingredientRows(['1 lb ground beef', '', '—'])).toHaveLength(1);
  });

  it('[MEAL-25-b] takes the lines under Ingredients, up to the method', () => {
    expect(
      ingredientLines(
        'Taco night\nIngredients\n1 lb ground beef\n2 tbsp seasoning\nMethod\nBrown the beef.',
      ),
    ).toEqual(['1 lb ground beef', '2 tbsp seasoning']);
    expect(ingredientLines('A card\n1 lb beef\nsome words\n2 onions')).toEqual([
      '1 lb beef',
      '2 onions',
    ]);
  });
});

describe('reading a made-up recipe file', () => {
  it('[MEAL-25-c] reads a PDF’s text into ingredient lines', async () => {
    const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
    const text = await pdfText(pdfjs, new Uint8Array(readFileSync(fixture('taco-night.pdf'))));
    expect(ingredientRows(ingredientLines(text))).toEqual([
      { name: 'Ground beef', amount: '1 lb', have: false },
      { name: 'Corn tortillas', amount: '8', have: false },
      { name: 'Onion', amount: '1', have: false },
      { name: 'Taco seasoning', amount: null, have: false },
      { name: 'Shredded cheddar', amount: null, have: false },
    ]);
  });

  it('[MEAL-25-d] reads a photo’s text with Tesseract.js into ingredient lines', async () => {
    const require = createRequire(import.meta.url);
    const ocr = (await import('tesseract.js')) as unknown as { default?: Ocr } & Ocr;
    const langPath = join(
      dirname(require.resolve('@tesseract.js-data/eng/package.json')),
      '4.0.0_best_int',
    );
    const text = await photoText(ocr.default ?? ocr, readFileSync(fixture('taco-card.png')), {
      langPath,
      cachePath: tmpdir(),
      gzip: true,
    });
    const rows = ingredientRows(ingredientLines(text));
    expect(rows.map((r) => r.name)).toEqual([
      'Ground beef',
      'Corn tortillas',
      'Onion',
      'Taco seasoning',
      'Shredded cheddar',
    ]);
    expect(rows[0]!.amount).toBe('1 lb');
  }, 30_000); // Measured at 4 to 6 s on this machine (the first read loads the model); 3x and more.
});

describe('fetching a recipe link', () => {
  const deps = (o: Partial<FetchDeps> & { pages?: Record<string, Response> } = {}): FetchDeps => ({
    lookup: o.lookup ?? (async (h) => (h === 'inside.example' ? ['10.0.0.5'] : ['93.184.216.34'])),
    fetch:
      o.fetch ??
      (async (u) => {
        const r = o.pages?.[String(u)];
        if (!r) throw new Error('no page');
        return r;
      }),
  });
  const html = (body: string, headers: Record<string, string> = {}) =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    });

  it('[MEAL-25-e] takes only http and https to a public address', async () => {
    for (const bad of [
      'ftp://tacos.example/r',
      'javascript:alert(1)',
      'not a link',
      'https://u:p@tacos.example/',
    ])
      expect(await fetchRecipePage(bad, deps())).toEqual({ ok: false, why: 'bad_link' });
    for (const inside of [
      'http://localhost/r',
      'http://127.0.0.1/r',
      'http://[::1]/r',
      'http://169.254.169.254/latest',
      'https://inside.example/r',
      'https://tacos.example:8443/r',
    ])
      expect(await fetchRecipePage(inside, deps())).toEqual({ ok: false, why: 'private' });
    expect(
      ['10.1.2.3', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::ffff:10.0.0.1', 'fd00::1'].every(
        isPrivateAddress,
      ),
    ).toBe(true);
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(
      await fetchRecipePage(
        'https://tacos.example/r',
        deps({ pages: { 'https://tacos.example/r': html('<p>ok</p>') } }),
      ),
    ).toEqual({ ok: true, html: '<p>ok</p>', url: 'https://tacos.example/r' });
  });

  it('[MEAL-25-e] never follows a redirect to a private address, and follows at most three', async () => {
    const to = (location: string) => new Response(null, { status: 302, headers: { location } });
    expect(
      await fetchRecipePage(
        'https://tacos.example/r',
        deps({ pages: { 'https://tacos.example/r': to('http://169.254.169.254/') } }),
      ),
    ).toEqual({ ok: false, why: 'private' });
    const loop: Record<string, Response> = {};
    for (let i = 0; i < 6; i += 1) loop[`https://tacos.example/${i}`] = to(`/${i + 1}`);
    expect(await fetchRecipePage('https://tacos.example/0', deps({ pages: loop }))).toEqual({
      ok: false,
      why: 'unreachable',
    });
  });

  it('[MEAL-25-e] gives up past its size limit, on a page that isn’t a page, or when it can’t reach it', async () => {
    const big = 'x'.repeat(LIMITS.maxBytes + 10);
    expect(
      await fetchRecipePage(
        'https://tacos.example/r',
        deps({ pages: { 'https://tacos.example/r': html(big) } }),
      ),
    ).toEqual({ ok: false, why: 'too_big' });
    expect(
      await fetchRecipePage(
        'https://tacos.example/r',
        deps({
          pages: {
            'https://tacos.example/r': new Response('{}', {
              headers: { 'content-type': 'application/json' },
            }),
          },
        }),
      ),
    ).toEqual({ ok: false, why: 'not_a_page' });
    expect(await fetchRecipePage('https://tacos.example/gone', deps())).toEqual({
      ok: false,
      why: 'unreachable',
    });
  });
});
