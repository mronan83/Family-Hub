import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CAL-01][CAL-03][CAL-06][CAL-09] The household's calendars (WP-22) on /dev/calendars: made-up
// calendars and events, no database. Each calendar's sync in words (synced, can't sync with its last
// good sync, not synced yet), who it's for (WP-50), what's coming up, no way to add or change an event,
// and the link never shown; the
// layout on a phone and a laptop, in Day and Evening. The same page runs signed in on the preview,
// with a real sync, in e2e/tests/calendar.spec.ts.

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
      test(`[CAL-06][NFR-11] fits ${name} in ${theme}: no sideways scroll, 44 px controls, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/calendars?theme=${theme}`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        // Every calendar's forms open, so their fields are measured too.
        for (const summary of await page.locator('main details > summary').all()) {
          await summary.click();
        }
        const small = await page.evaluate(() =>
          [...document.querySelectorAll('main button, main input, main select')]
            .filter((b) => {
              const r = b.getBoundingClientRect();
              const type = (b as HTMLInputElement).type;
              return r.height > 0 && r.height < 44 && type !== 'checkbox' && type !== 'radio';
            })
            .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent),
        );
        expect(small).toEqual([]);
        await contrastOk(page);
      });
    }
  });
}

test('[CAL-06][US-505] each calendar says how its sync went; a failing one keeps its last good events', async ({
  page,
}) => {
  await page.goto('/dev/calendars');
  await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();
  const list = page.getByRole('list', { name: 'Calendars', exact: true });
  const family = list.getByRole('listitem').filter({ hasText: 'Family' }).first();
  await expect(family).toContainText('SyncedLast synced Tue, Oct 20 at 12:03 pm.');
  await expect(family).toContainText('The whole family');
  const coming = page.getByRole('list', { name: 'Coming up on Family' });
  await expect(coming.getByRole('listitem')).toHaveText([
    'Tue, Oct 20 · 5:00 pm Swim',
    'Fri, Oct 23 · All day Field trip',
    'Wed, Oct 28 · 6:00 pm Swim (Wednesday this week) · moved',
    'Wed, Nov 25 – Sat, Nov 28 · All day Grandparents visit',
    'and 19 more in the next four months',
  ]);

  const school = list.getByRole('listitem').filter({ hasText: 'School' }).first();
  await expect(school).toContainText('Can’t sync');
  await expect(school).toContainText(
    'The link answered 404 (Not Found): the calendar may no longer be public.',
  );
  await expect(school).toContainText(
    'Last good sync Mon, Oct 19 at 5:48 pm: the board keeps showing its events.',
  );
  await expect(school).toContainText('Ava and Ben');
  await expect(page.getByRole('list', { name: 'Coming up on School' })).toContainText(
    'Picture day',
  );

  const work = list.getByRole('listitem').filter({ hasText: 'Work' }).first();
  await expect(work).toContainText('Not synced yetIt syncs within 15 minutes.');
  await expect(work).toContainText('Alex’s · Not on the boards');
});

test('[CAL-03][CAL-01] events are only read: no way to add or change one, and no link shown', async ({
  page,
}) => {
  await page.goto('/dev/calendars');
  await expect(page.getByRole('button', { name: /event/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /event/i })).toHaveCount(0);
  await expect(page.getByText('FamilyWise only reads them', { exact: false })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('icloud.com/published');

  await page.locator('summary', { hasText: 'Edit Family' }).click();
  const edit = page.getByRole('form', { name: 'Edit Family' });
  await expect(edit.getByLabel('Name')).toHaveValue('Family');
  await expect(edit.getByLabel('Replace the link (optional)')).toHaveValue('');
  await expect(edit.getByText('Leave this empty to keep it.', { exact: false })).toBeVisible();
  await expect(edit.getByRole('radio', { name: 'Teal' })).toBeChecked();
  await expect(edit.getByRole('checkbox', { name: 'The whole family' })).toBeChecked();
  await expect(edit.getByRole('checkbox', { name: 'Show on the boards' })).toBeChecked();

  const add = page.getByRole('form', { name: 'Add a calendar' });
  await expect(add.getByLabel('Public link')).toHaveAttribute('required', '');
  await expect(add.getByText('turn on Public Calendar', { exact: false })).toBeVisible();
  await expect(add.getByRole('button', { name: 'Add calendar' })).toBeVisible();
  const remove = page.locator('details', {
    has: page.locator('summary', { hasText: 'Remove Work' }),
  });
  await remove.locator('summary').click();
  await expect(remove.getByRole('button', { name: 'Remove Work' })).toBeVisible();
  await expect(remove.getByText('stays in Apple Calendar', { exact: false })).toBeVisible();
});

test('[CAL-09-d][US-508] who a calendar is for: The whole family or a tick a person', async ({
  page,
}) => {
  await page.goto('/dev/calendars');
  // [D-110] React has hydrated the page: a tick now runs its handler.
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
  const school = page
    .getByRole('list', { name: 'Calendars', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'School' })
    .first();
  // Its line: both faces before their names.
  await expect(school.locator('.fw-calendar__who')).toHaveText('Ava and Ben');
  await expect(school.locator('.fw-calendar__faces > *')).toHaveCount(2);

  await page.locator('summary', { hasText: 'Edit School' }).click();
  const who = page.getByRole('form', { name: 'Edit School' }).getByRole('group', {
    name: 'Who it’s for',
  });
  const tick = (name: string) => who.getByRole('checkbox', { name, exact: true });
  await expect(who.getByRole('checkbox')).toHaveCount(4); // the whole family, Ava, Ben, Alex
  await expect(tick('Kit')).toHaveCount(0); // archived: no tick
  await expect(tick('Ava')).toBeChecked();
  await expect(tick('Ben')).toBeChecked();
  await expect(tick('The whole family')).not.toBeChecked();

  await test.step('clearing every person ticks The whole family', async () => {
    await tick('Ava').click();
    await expect(tick('The whole family')).not.toBeChecked();
    await tick('Ben').click();
    await expect(tick('The whole family')).toBeChecked();
  });
  await test.step('ticking a person clears The whole family', async () => {
    await tick('Alex').click();
    await expect(tick('Alex')).toBeChecked();
    await expect(tick('The whole family')).not.toBeChecked();
  });
  await test.step('ticking The whole family clears the people', async () => {
    await tick('Ben').click();
    await tick('The whole family').click();
    await expect(tick('The whole family')).toBeChecked();
    for (const name of ['Ava', 'Ben', 'Alex']) await expect(tick(name)).not.toBeChecked();
  });
  // Each tick is a 44 px target, by touch and by mouse.
  for (const box of await who.locator('label').all()) {
    expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('[CAL-01] with none yet, the page says so and offers the form', async ({ page }) => {
  await page.goto('/dev/calendars?state=empty');
  await expect(page.getByText('No calendars yet. Add one below.')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Add a calendar' })).toBeVisible();
  // [NFR-15] Calendars is one of Settings' pages (WP-51): Settings is marked, with the way back.
  await expect(
    page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Settings' }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.fw-crumb')).toHaveText('Settings');
});
