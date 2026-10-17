import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf, unfold } from '../support/fold';

// [CAL-01][CAL-03][CAL-06][CAL-09] The household's calendars (WP-22) on /dev/calendars: made-up
// calendars and events, no database. Each calendar's sync in words (synced, can't sync with its last
// good sync, not synced yet), who it's for (WP-50), what's coming up, no way to add or change an event,
// and the link never shown; the
// layout on a phone and a laptop, in Day and Evening. Each calendar folded to its facts, opened by a
// tap after React has taken the page over (WP-93, D-110), Tue, Oct 20, 2026 at 12:15 pm. The same
// page runs signed in on the preview, with a real sync, in e2e/tests/calendar.spec.ts.

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

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
  await open(page, '/dev/calendars');
  await expect(page.getByRole('heading', { name: 'Calendars', level: 1 })).toBeVisible();
  await unfold(foldOf(page, 'Family'));
  await unfold(foldOf(page, 'School'));
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
  await open(page, '/dev/calendars');
  await expect(page.getByRole('button', { name: /event/i })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /event/i })).toHaveCount(0);
  await expect(page.getByText('FamilyWise only reads them', { exact: false })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('icloud.com/published');

  await unfold(foldOf(page, 'Family'));
  await unfold(foldOf(page, 'Edit Family'));
  const edit = page.getByRole('form', { name: 'Edit Family' });
  await expect(edit.getByLabel('Name')).toHaveValue('Family');
  await expect(edit.getByLabel('Replace the link (optional)')).toHaveValue('');
  await expect(edit.getByText('Leave this empty to keep it.', { exact: false })).toBeVisible();
  await expect(edit.getByRole('radio', { name: 'Teal' })).toBeChecked();
  await expect(edit.getByRole('checkbox', { name: 'The whole family' })).toBeChecked();
  await expect(edit.getByRole('checkbox', { name: 'Show on the boards' })).toBeChecked();

  await unfold(foldOf(page, 'Add a calendar'));
  const add = page.getByRole('form', { name: 'Add a calendar' });
  await expect(add.getByLabel('Public link')).toHaveAttribute('required', '');
  await expect(add.getByText('turn on Public Calendar', { exact: false })).toBeVisible();
  await expect(add.getByRole('button', { name: 'Add calendar' })).toBeVisible();
  await unfold(foldOf(page, 'Work'));
  const remove = foldOf(page, 'Remove Work');
  await unfold(remove);
  await expect(remove.getByRole('button', { name: 'Remove Work' })).toBeVisible();
  await expect(remove.getByText('stays in Apple Calendar', { exact: false })).toBeVisible();
});

test('[CAL-09-d][US-508] who a calendar is for: The whole family or a tick a person', async ({
  page,
}) => {
  // [D-110] React has hydrated the page: a tick now runs its handler.
  await open(page, '/dev/calendars');
  const school = page
    .getByRole('list', { name: 'Calendars', exact: true })
    .getByRole('listitem')
    .filter({ hasText: 'School' })
    .first();
  // Its folded header: both faces before their names (WP-93).
  await expect(school.locator('.fw-calendar__who')).toHaveText(
    'Ava and Ben · last synced 18 h ago · 2 events coming up',
  );
  await expect(school.locator('.fw-calendar__faces > *')).toHaveCount(2);

  await unfold(foldOf(page, 'School'));
  await unfold(foldOf(page, 'Edit School'));
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

// [NFR-18][D-120] Calendars folded (WP-93), as the fold audit draws them.
const folds = (page: Page) => page.locator('main details:is(.fw-fold, .fw-card.fw-fold > details)');
const header = (page: Page, name: string) => foldOf(page, name).locator(':scope > summary');

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`Calendars folded on ${device}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[NFR-18-f][US-111][CAL-06][D-120] every fold closed, then each opened by a tap, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/calendars${theme === 'evening' ? '?theme=evening' : ''}`);

        await test.step('folded at first: each calendar’s facts, the warning, Add a calendar’s button', async () => {
          // Three calendars, each with Edit and Remove inside, and Add a calendar.
          await expect(folds(page)).toHaveCount(10);
          for (const d of await folds(page).all()) await expect(d).not.toHaveAttribute('open');
          await expect(header(page, 'Family')).toHaveText(
            'FamilyThe whole family · Synced 12 min ago · 23 events coming up',
          );
          await expect(header(page, 'School')).toContainText(
            'Ava and Ben · last synced 18 h ago · 2 events coming up',
          );
          await expect(header(page, 'Work')).toHaveText(
            'WorkAlex’s · Not on the boards · Not synced yet · nothing coming up',
          );
          // School can't sync, so its folded header says so; the others don't.
          await expect(header(page, 'School').locator('.fw-fold__flag')).toBeVisible();
          await expect(header(page, 'School').locator('.fw-fold__flag')).toHaveText('Can’t sync');
          await expect(page.locator('.fw-fold__flag')).toHaveCount(1);
          await expect(header(page, 'Add a calendar').locator('.fw-fold__closed')).toHaveText(
            'Add a calendar',
          );
          await expect(page.getByRole('list', { name: 'Coming up on Family' })).toBeHidden();
          await expect(page.getByRole('form', { name: 'Add a calendar' })).toBeHidden();
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          await contrastOk(page);
        });

        await test.step('Family opened: what’s coming up, then Edit and Remove as folds', async () => {
          const family = foldOf(page, 'Family');
          await header(page, 'Family').click();
          await expect(family).toHaveAttribute('open', '');
          const coming = page.getByRole('list', { name: 'Coming up on Family' });
          await expect(coming).toBeVisible();
          expect(await family.locator('h3').allTextContents()).toEqual([
            'Edit Family',
            'Remove Family',
          ]);
          const edit = foldOf(page, 'Edit Family');
          // What's coming up comes first, above Edit.
          expect((await coming.boundingBox())!.y).toBeLessThan((await edit.boundingBox())!.y);
          await expect(edit).not.toHaveAttribute('open');
          await expect(foldOf(page, 'School')).not.toHaveAttribute('open');
          // School's warning stays on its header while Family is open.
          await expect(header(page, 'School').locator('.fw-fold__flag')).toBeVisible();

          await header(page, 'Edit Family').click();
          await expect(page.getByRole('form', { name: 'Edit Family' })).toBeVisible();
          await header(page, 'Remove Family').click();
          await expect(page.getByRole('button', { name: 'Remove Family' })).toBeVisible();
        });

        await test.step('Add a calendar opened to its form; the page still fits', async () => {
          await header(page, 'Add a calendar').click();
          await expect(page.getByRole('form', { name: 'Add a calendar' })).toBeVisible();
          await expect(header(page, 'Add a calendar').locator('.fw-fold__closed')).toBeHidden();
          await header(page, 'School').click();
          await expect(page.getByRole('list', { name: 'Coming up on School' })).toBeVisible();
          // Each fold's header is a 44 px target, by touch and by mouse.
          for (const s of await page.locator('main summary').all()) {
            const box = await s.boundingBox();
            if (box) expect(box.height).toBeGreaterThanOrEqual(44);
          }
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
          await contrastOk(page);
        });
      });
    }
  });
}

test('[NFR-18-i][D-120] a calendar just saved in comes back open, the others folded; with none, Add a calendar is open', async ({
  page,
}) => {
  await open(page, '/dev/calendars?open=1');
  await expect(foldOf(page, 'Family')).toHaveAttribute('open', '');
  await expect(page.getByRole('list', { name: 'Coming up on Family' })).toBeVisible();
  for (const name of ['School', 'Work', 'Add a calendar']) {
    await expect(foldOf(page, name)).not.toHaveAttribute('open');
  }
  await open(page, '/dev/calendars?state=empty');
  await expect(foldOf(page, 'Add a calendar')).toHaveAttribute('open', '');
});
