import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CHR-14][CHR-15][ACC-04] "Which one is you?" (D-61): a parent whose sign-in isn't linked to anyone in
// the family links it to themselves in one tap, on Reminders (/dev/reminders?state=unlinked) and My
// tasks (/dev/admin?view=unlinked), made-up members and no database. The tap itself runs signed in on
// the preview in e2e/tests/link-me.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

const PAGES = [
  ['/dev/reminders?state=unlinked', 'Reminders'],
  ['/dev/admin?view=unlinked', 'My tasks'],
] as const;

for (const [path, title] of PAGES) {
  test(`[CHR-14][US-316] ${title}, not linked: choose yourself among the adults with no sign-in`, async ({
    page,
  }) => {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    const choose = page.getByRole('region', { name: 'Which one is you?' });
    await expect(choose).toContainText('Your sign-in isn’t linked to anyone in the family yet.');
    const list = choose.getByRole('list', { name: 'Adults without a sign-in' });
    await expect(list.getByRole('button')).toHaveText(['I’m Alex', 'I’m Sam']);
    // A parent whose own record says Child is told how to change it; one not in the family yet, how
    // to add themselves.
    await expect(choose).toContainText(
      'Only an adult can have a sign-in: if your record says Child, open it on Members and choose Adult.',
    );
    await expect(choose.getByRole('link', { name: 'Members' })).toHaveAttribute(
      'href',
      '/admin/members',
    );
    await expect(choose.getByRole('link', { name: 'Add yourself' })).toHaveAttribute(
      'href',
      '/admin/members/new',
    );
  });
}

test('[CHR-14] with every adult already linked, it says so', async ({ page }) => {
  await page.goto('/dev/reminders?state=unlinked&none=1');
  const choose = page.getByRole('region', { name: 'Which one is you?' });
  await expect(choose).toContainText('Every adult in the family already has a sign-in.');
  await expect(choose.getByRole('button')).toHaveCount(0);
});

for (const [width, height, name] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[ACC-04][NFR-11] the choice fits ${name} in ${theme}: no sideways scroll, 44 px, AA contrast`, async ({
        page,
      }) => {
        for (const [path] of PAGES) {
          await page.goto(`${path}&theme=${theme}`);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          const small = await page.evaluate(() =>
            [...document.querySelectorAll('.fw-link-me button, .fw-link-me a')]
              .filter((b) => b.tagName === 'BUTTON' && b.getBoundingClientRect().height < 44)
              .map((b) => b.textContent),
          );
          expect(small).toEqual([]);
          await contrastOk(page);
        }
      });
    }
  });
}
