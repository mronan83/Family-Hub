import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CHR-05][CHR-06][CHR-08][CHR-14] A parent's day and My tasks (WP-12) on /dev/admin: a made-up family,
// no database. The pages' layout, words and buttons on a phone and a laptop, in Day and Evening. The
// same pages run signed in against the database in e2e/tests/admin-day.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const theme of ['day', 'evening'] as const) {
    for (const view of ['today', 'my'] as const) {
      test(`[CHR-14][NFR-11] ${view} fits a phone in ${theme}: no sideways scroll, 44 px buttons, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/admin?view=${view}&theme=${theme}&notice=1`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main button, main summary')]
            .filter((b) => b.getBoundingClientRect().height < 44)
            .map((b) => b.getAttribute('aria-label') ?? b.textContent),
        );
        expect(small).toEqual([]);
        await contrastOk(page);
      });
    }
  }
});

test('[CHR-05] waiting check-offs come first, each to approve or send back, a late one marked', async ({
  page,
}) => {
  await page.goto('/dev/admin');
  const waiting = page.getByRole('list', { name: 'Waiting for you' });
  await expect(waiting.getByRole('listitem')).toHaveCount(2);
  await expect(waiting.getByRole('button', { name: 'Approve Homework' })).toBeVisible();
  await expect(waiting.getByRole('button', { name: 'Send Homework back' })).toBeVisible();
  await expect(waiting.getByRole('listitem').nth(1)).toContainText(
    'after its day: check it was really done',
  );
  // Waiting items offer nothing else.
  await expect(waiting.getByRole('button', { name: /Uncheck|Skip|Mark/ })).toHaveCount(0);
});

test('[CHR-06][CHR-12] the day by part of day, overdue tasks first; each item offers what fits its state', async ({
  page,
}) => {
  await page.goto('/dev/admin');
  const day = page.getByRole('region', { name: 'Today' });
  await expect(day.getByRole('heading', { level: 2 })).toHaveText([
    'Overdue',
    'Morning',
    'Evening',
    'Anytime',
  ]);
  // Each person's own item names them (D-47).
  await expect(day.getByRole('button', { name: 'Mark Make bed (Leo) done' })).toBeVisible();
  await expect(day.getByRole('button', { name: 'Uncheck Make bed (Maya)' })).toBeVisible();
  await expect(day.getByRole('button', { name: 'Skip Return library books' })).toBeVisible();
  await expect(day.getByRole('button', { name: 'Put Take out the bins back' })).toBeVisible();
  await expect(day.getByRole('listitem').filter({ hasText: 'Return library books' })).toContainText(
    'Overdue',
  );
  // A task due today is open, not overdue.
  await expect(day.getByRole('listitem').filter({ hasText: 'Call the plumber' })).toContainText(
    'Open',
  );
});

test('[CHR-08] only done items can be ticked for “Not actually done”', async ({ page }) => {
  await page.goto('/dev/admin');
  const ticks = page.getByRole('checkbox', { name: /^Select / });
  await expect(ticks).toHaveCount(3);
  for (const name of [
    'Select Make bed (Maya)',
    'Select Brush teeth (Maya)',
    'Select Set the table',
  ]) {
    await expect(page.getByRole('checkbox', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Not actually done' })).toBeVisible();
});

test('[CHR-09][CHR-06] a shared item with several people asks who did it: its people first, anyone allowed', async ({
  page,
}) => {
  await page.goto('/dev/admin');
  const row = page.getByRole('listitem').filter({ hasText: 'Feed the dog' });
  await row.getByText('Mark done…').click();
  const who = row.getByRole('group', { name: 'Who did Feed the dog?' });
  await expect(who.getByRole('checkbox')).toHaveCount(4);
  await expect(who.locator('label')).toHaveText(['Maya', 'Alex', 'Leo', 'Sam']);
  await expect(row.getByRole('button', { name: 'Mark Feed the dog done' })).toBeVisible();
  await contrastOk(page);
});

test('[CHR-08] after “Not actually done”, the notice offers Undo', async ({ page }) => {
  await page.goto('/dev/admin?notice=1');
  const notice = page.getByRole('status');
  await expect(notice).toContainText('Unchecked 2 items. Their points are taken back.');
  await expect(notice.getByRole('button', { name: 'Undo' })).toBeVisible();
});

test('[CHR-14][US-316] My tasks: overdue, today’s, then coming up; done credits me; quick add', async ({
  page,
}) => {
  await page.goto('/dev/admin?view=my');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText([
    'Overdue',
    'Today',
    'Coming up',
  ]);
  await expect(page.getByRole('list', { name: 'Overdue' })).toContainText('Book the dentist');
  await expect(page.getByRole('list', { name: 'Today' })).toContainText('Feed the dog');
  await expect(page.getByRole('list', { name: 'Coming up' })).toContainText(
    'Pay the school trip fee',
  );
  // One tap: no picker in My tasks, and nothing a parent does for others (skip, approve).
  await expect(page.getByText('Mark done…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Skip|Approve)/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mark Feed the dog done' })).toBeVisible();
  const add = page.getByRole('form', { name: 'Quick add' });
  await expect(add.getByLabel('Add a task for today')).toHaveAttribute('maxlength', '80');
  await expect(add.getByRole('button', { name: 'Add' })).toBeVisible();
});

test('[CHR-14] a sign-in not linked to anyone is told how to link it', async ({ page }) => {
  await page.goto('/dev/admin?view=unlinked');
  await expect(page.getByRole('main')).toContainText('isn’t linked to anyone in the family yet');
  await expect(page.getByRole('link', { name: 'Members' }).last()).toHaveAttribute(
    'href',
    '/admin/members',
  );
});
