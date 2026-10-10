import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CHR-15][CHR-16][CHR-17] A person's reminders (WP-40) on /dev/reminders: made-up devices, no
// database. The page's words, buttons and layout on a phone and a laptop, in Day and Evening, and the
// bell on My tasks (/dev/admin?view=my). The same page runs signed in on the preview in
// e2e/tests/reminders.spec.ts.

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

for (const [width, height, name] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[CHR-15][NFR-11] fits ${name} in ${theme}: no sideways scroll, 44 px buttons, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/reminders?theme=${theme}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main button, main input, main select')]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              return r.height > 0 && r.height < 44 && (b as HTMLInputElement).type !== 'checkbox';
            })
            .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
        );
        expect(small).toEqual([]);
        await contrastOk(page);
      });
    }
  });
}

test('[CHR-15][US-317] on: the devices, each to test, switch off or remove; one already off', async ({
  page,
}) => {
  await page.goto('/dev/reminders');
  await expect(page.getByText('On. Reminders come to the devices below.')).toBeVisible();
  await expect(
    page.getByText(
      '15 minutes before the due time · items with no time at 8:00 am · a digest at 7:00 am · quiet 9:00 pm to 7:00 am.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add this device' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn off reminders' })).toBeVisible();
  const devices = page.getByRole('list', { name: 'My devices' });
  await expect(devices.getByRole('listitem')).toHaveCount(2);
  await expect(devices.getByRole('listitem').first()).toContainText('iPhone · Safari');
  await expect(devices.getByRole('listitem').first()).toContainText('last reached');
  await expect(
    devices.getByRole('button', { name: 'Send a test to iPhone · Safari' }),
  ).toBeEnabled();
  await expect(devices.getByRole('button', { name: 'Send a test to Mac · Chrome' })).toBeDisabled();
  await expect(devices.getByRole('button', { name: 'Switch on Mac · Chrome' })).toBeVisible();
  await expect(devices.getByRole('button', { name: 'Remove Mac · Chrome' })).toBeVisible();
});

test('[CHR-16][CHR-17][US-319] when to remind me: the digest and quiet hours show their times when on', async ({
  page,
}) => {
  await page.goto('/dev/reminders?state=off');
  await expect(page.getByText('Off. Nothing is sent to you.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  await expect(page.getByText('None yet.', { exact: false })).toBeVisible();
  const form = page.getByRole('form', { name: 'When to remind me' });
  await expect(form.getByRole('checkbox', { name: /Remind me about new items/ })).toBeChecked();
  await expect(form.getByRole('combobox', { name: /^Remind me/ })).toHaveValue('15');
  await expect(form.getByLabel(/no due time/)).toHaveValue('08:00');
  await expect(form.getByLabel(/^At/)).toHaveCount(0);
  await form.getByRole('checkbox', { name: 'Send me a summary of my day' }).check();
  await expect(form.getByLabel(/^At/)).toHaveValue('07:00');
  await expect(form.getByLabel('From', { exact: true })).toHaveCount(0);
  await form.getByRole('checkbox', { name: 'Hold reminders during quiet hours' }).check();
  await expect(form.getByLabel('From', { exact: true })).toHaveValue('21:00');
  await expect(form.getByLabel('To', { exact: true })).toHaveValue('07:00');
  await expect(
    form.getByRole('checkbox', { name: /Hide the names of private items/ }),
  ).toBeChecked();
});

test('[CHR-15] without web push keys, or without a linked sign-in, the page says so', async ({
  page,
}) => {
  await page.goto('/dev/reminders?state=off&keys=none');
  await expect(page.getByText('Reminders aren’t set up on this site yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Turn on reminders' })).toHaveCount(0);
  await page.goto('/dev/reminders?state=unlinked');
  await expect(
    page.getByText('Reminders are for someone in the family with a sign-in.'),
  ).toBeVisible();
});

test('[CHR-16][US-318] My tasks: a bell on each of my items, following my default unless I say', async ({
  page,
}) => {
  await page.goto('/dev/admin?view=my');
  const bells = page.locator('[data-bell]');
  expect(await bells.count()).toBeGreaterThan(1);
  await expect(bells.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(bells.nth(0)).toHaveText('Bell on');
  await expect(bells.nth(1)).toHaveAttribute('aria-pressed', 'false');
  await expect(bells.nth(1)).toHaveText('Bell off');
  await expect(bells.nth(0)).toHaveAccessibleName(/^Remind me about /);
  await expect(page.getByRole('link', { name: 'Reminders' }).last()).toHaveAttribute(
    'href',
    '/admin/reminders',
  );
});
