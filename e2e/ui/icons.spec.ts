import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CHR-01][CHR-10][ACC-04][CAL-05] The one icon picker and the sixteen colors (WP-46, D-70) on
// /dev/forms: the chore, tag, member and calendar forms with a made-up family and no database. The
// picker's search, groups and chosen icon; an icon hidden by a search still chosen; an icon the picker
// no longer offers kept; every Lucide icon drawn exactly as Lucide draws it; and every color as a line
// or dot at 3:1 in both themes. The same forms save on the preview in e2e/tests/icons.spec.ts.

const root = join(__dirname, '../..');

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

const picker = (page: Page) => page.getByRole('group', { name: 'Icon', exact: true });
const icon = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
/** A radio hidden by a search or a group: out of the accessibility tree, still in the form. */
const hiddenIcon = (page: Page, name: string) =>
  page.getByRole('radio', { name, exact: true, includeHidden: true });

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${device}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      for (const form of ['chore', 'tag', 'member', 'calendar'] as const) {
        test(`[NFR-11] the ${form} form fits ${device} in ${theme}: no sideways scroll, 44 px controls, AA contrast`, async ({
          page,
        }) => {
          await page.goto(`/dev/forms?form=${form}&theme=${theme}`);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          const small = await page.evaluate(() =>
            [...document.querySelectorAll('main button, main input, main select, main label')]
              .filter((b) => {
                const r = b.getBoundingClientRect();
                const type = (b as HTMLInputElement).type;
                const tiny = b.tagName === 'LABEL' ? !b.querySelector('input') : false;
                return (
                  r.height > 0 &&
                  r.height < 44 &&
                  !tiny &&
                  !['checkbox', 'radio', 'hidden'].includes(type) &&
                  !(b.tagName === 'LABEL' && !b.className.includes('fw-picker__item'))
                );
              })
              .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
          );
          expect(small).toEqual([]);
          await contrastOk(page);
        });
      }
    }
  });
}

test('[CHR-01] search finds an icon by its everyday words; Enter never sends the form', async ({
  page,
}) => {
  await page.goto('/dev/forms');
  const search = page.getByRole('searchbox', { name: 'Find an icon' });
  await expect(picker(page)).toContainText('Chosen: bed');
  await search.fill('laundry');
  await expect(icon(page, 'washing machine')).toBeVisible();
  await expect(icon(page, 'laundry')).toBeVisible();
  await expect(hiddenIcon(page, 'pizza')).toBeHidden();
  await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Add a chore', level: 1 })).toBeVisible();
  await expect(page.locator('.fw-banner')).toHaveCount(0);

  await page.locator('label', { has: icon(page, 'washing machine') }).click();
  await expect(picker(page)).toContainText('Chosen: washing machine');
  // Searching again hides the chosen icon, but it stays chosen: the form still sends it.
  await search.fill('zzzq');
  await expect(picker(page)).toContainText('No icon matches “zzzq”. Try another word.');
  await expect(hiddenIcon(page, 'washing machine')).toBeChecked();
  expect(
    await page.evaluate(() =>
      new FormData(document.querySelector('form.fw-form') as HTMLFormElement).get('icon'),
    ),
  ).toBe('washing-machine');
});

test('[CHR-01] a group shows only its icons; All shows every group, Home first for a chore', async ({
  page,
}) => {
  await page.goto('/dev/forms');
  const groups = page.getByRole('group', { name: 'Icon groups' });
  await expect(groups.getByRole('button')).toHaveText([
    'All',
    'Home',
    'Kitchen and food',
    'School and learning',
    'Pets and garden',
    'Health and care',
    'Play and sport',
    'Music and making',
    'Errands and money',
    'Out and about',
    'Treats and rewards',
    'Weather and time',
    'People and labels',
  ]);
  await expect(groups.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  await groups.getByRole('button', { name: 'Pets and garden' }).click();
  await expect(groups.getByRole('button', { name: 'Pets and garden' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(icon(page, 'dog')).toBeVisible();
  await expect(icon(page, 'pet')).toBeVisible();
  await expect(hiddenIcon(page, 'bed')).toBeHidden();
  await expect(hiddenIcon(page, 'bed')).toBeChecked();
  await page.locator('label', { has: icon(page, 'dog') }).click();
  await expect(picker(page)).toContainText('Chosen: dog');
  await groups.getByRole('button', { name: 'All' }).click();
  await expect(icon(page, 'bed')).toBeVisible();
});

test('[CHR-10] a tag starts with People and labels and can have no icon', async ({ page }) => {
  await page.goto('/dev/forms?form=tag');
  const pick = page.getByRole('group', { name: 'Icon (optional)' });
  await expect(pick).toContainText('No icon chosen');
  await expect(pick.getByRole('radio', { name: 'No icon' })).toBeChecked();
  await expect(
    pick.getByRole('group', { name: 'Icon groups' }).getByRole('button').nth(1),
  ).toHaveText('People and labels');
  await pick.getByRole('searchbox').fill('flag');
  await pick.locator('label', { has: icon(page, 'flag') }).click();
  await expect(pick).toContainText('Chosen: flag');
});

test('[CHR-01] editing shows the chosen icon in view; one the picker no longer offers is kept', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev/forms?icon=washing-machine');
  await expect(icon(page, 'washing machine')).toBeChecked();
  const grid = page.locator('.fw-iconpick__grid');
  const inView = await page.evaluate(() => {
    const box = document.querySelector('.fw-iconpick__grid')!.getBoundingClientRect();
    const item = document
      .querySelector('input[value="washing-machine"]')!
      .closest('label')!
      .getBoundingClientRect();
    return item.top >= box.top && item.bottom <= box.bottom;
  });
  expect(inView).toBe(true);
  await expect(grid).toBeVisible();

  await page.goto('/dev/forms?icon=image');
  await expect(icon(page, 'image')).toBeChecked();
  await expect(picker(page)).toContainText('Chosen: image');
});

test('[NFR-13] every Lucide icon draws exactly as Lucide draws it', async ({ page }) => {
  const list = JSON.parse(readFileSync(join(root, 'brand/icons/lucide.json'), 'utf8')) as {
    icons: { name: string; from?: string }[];
  };
  const pairs = list.icons.map((i) => [
    i.name,
    readFileSync(
      join(root, 'packages/ui/node_modules/lucide-static/icons', `${i.from ?? i.name}.svg`),
      'utf8',
    ).replace(/<!--[\s\S]*?-->/g, ''),
    readFileSync(join(root, 'brand/icons/lucide', `${i.name}.svg`), 'utf8'),
  ]);
  expect(pairs.length).toBeGreaterThan(200);
  await page.goto('/dev/forms');
  const differ = await page.evaluate(async (pairs) => {
    const draw = async (svg: string) => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 96;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, 96, 96);
      return ctx.getImageData(0, 0, 96, 96).data;
    };
    const out: string[] = [];
    for (const [name, theirs, ours] of pairs) {
      const [a, b] = [await draw(theirs!), await draw(ours!)];
      let ink = 0;
      let diff = 0;
      for (let i = 3; i < a.length; i += 4) {
        ink += a[i]!;
        diff += Math.abs(a[i]! - b[i]!);
      }
      if (diff > 0 || ink === 0) out.push(name!);
    }
    return out;
  }, pairs);
  expect(differ).toEqual([]);
});

test('[ACC-04][CAL-05][NFR-11] sixteen colors, each named; as lines and dots each meets 3:1 in both themes', async ({
  page,
}) => {
  const names = [
    'Blue',
    'Rose',
    'Orange',
    'Violet',
    'Green',
    'Teal',
    'Red',
    'Gold',
    'Lime',
    'Cyan',
    'Navy',
    'Indigo',
    'Purple',
    'Magenta',
    'Brown',
    'Slate',
  ];
  await page.goto('/dev/forms?form=member');
  await expect(page.getByRole('group', { name: 'Color' }).getByRole('radio')).toHaveCount(16);
  for (const theme of ['day', 'evening']) {
    await page.goto(`/dev/forms?form=calendar&theme=${theme}`);
    const colors = page.getByRole('group', { name: 'Color' });
    for (const n of names) await expect(colors.getByRole('radio', { name: n })).toHaveCount(1);
    const low = await page.evaluate(() => {
      const rgb = (s: string) =>
        s
          .match(/\d+(\.\d+)?/g)!
          .slice(0, 3)
          .map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (c: number) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const card = rgb(getComputedStyle(document.querySelector('.fw-card')!).backgroundColor);
      return [...document.querySelectorAll('.fw-swatch')]
        .map((s) => {
          const [a, b] = [lum(rgb(getComputedStyle(s).backgroundColor)), lum(card)];
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          return [s.parentElement!.textContent!.trim(), Math.round(ratio * 100) / 100] as const;
        })
        .filter(([, ratio]) => ratio < 3);
    });
    expect(low, theme).toEqual([]);
  }
});
