import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [CHR-21][CHR-22][CHR-23][NFR-16][NFR-18] Chores and tasks in four sections (WP-96, D-132) on
// /dev/chores: the made-up demo family, no database, today Wed, Oct 14. The page at 390 and 1280 px
// in Day and Evening, in Chrome, as an iPhone in WebKit and as Safari on a Mac (desktop WebKit at
// 1280 px); every fold closed and opened; a ⋯ menu opened by a tap and by a press and hold; Do
// again's sheet; an item's page and Duplicate's form; the Meal library's and Tags' ⋯ rows. Taps wait
// for React to take the page over (D-110). The same flows run signed in on the database in
// e2e/tests/chore-sections.spec.ts.

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

/** No sideways scroll, and every control at least 44 px tall (the admin's touch size). */
async function fits(page: Page) {
  const width = page.viewportSize()!.width;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  const small = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main button, main a.fw-btn, main a.fw-chip, main a.fw-seg__item, main a.fw-row__mi, main summary, main select, main input:not([type=hidden]):not([type=file])',
      ),
    ]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const type = (b as HTMLInputElement).type;
        return r.height > 0 && r.height < 44 && type !== 'checkbox' && type !== 'radio';
      })
      .map((b) => b.getAttribute('aria-label') ?? b.textContent),
  );
  expect(small).toEqual([]);
}

const fold = (page: Page, name: string) =>
  page.locator('details', { has: page.getByRole('heading', { name, exact: true }) }).first();
const rows = (page: Page, list: string) =>
  page.getByRole('list', { name: list, exact: true }).getByRole('listitem');
/** The ⋯ button of a row, and its menu. */
const moreFor = (page: Page, title: string) =>
  page.getByLabel(`More for ${title}`, { exact: true });
const menuOf = (page: Page, title: string) =>
  page.locator('li', { has: moreFor(page, title) }).locator('.fw-row__menu');

test.describe('Chores in four sections', () => {
  for (const theme of ['day', 'evening'] as const) {
    test(`[CHR-21-g] the four sections, Scheduled and Recurring open, Completed and Archived folded; fits in ${theme}`, async ({
      page,
    }) => {
      await open(page, `/dev/chores?theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Chores and tasks', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2 })).toHaveText([
        'Scheduled',
        'Recurring',
        'Completed',
        'Archived',
      ]);
      // Scheduled: under its date headings, Overdue first.
      for (const [heading, titles] of [
        ['Overdue', ['Book the dentist', 'Return the library books']],
        ['Today', ['Pay the school trip fee', 'Pack for the sleepover']],
        ['This week', ['Buy Leo’s football boots', 'Wash the car']],
        ['Later', ['Carve the pumpkins', 'Renew the passports', 'Anniversary gift']],
      ] as const) {
        await expect(rows(page, heading).locator('.fw-row__name')).toHaveText([...titles]);
      }
      await expect(rows(page, 'This week').filter({ hasText: 'Wash the car' })).toContainText(
        'Chore Once, Sat, Oct 17 · 10:00 am · Maya, Leo · 1 of 2 done · +15',
      );
      await expect(rows(page, 'Recurring').first()).toContainText(
        'Chore Every day · 7:30 am · Maya, Leo, each their own · +5',
      );
      await expect(rows(page, 'Recurring').filter({ hasText: 'furnace' })).toContainText(
        'Overdue since Thu, Oct 1',
      );
      // Folded to their counts.
      await expect(fold(page, 'Completed')).not.toHaveAttribute('open');
      await expect(fold(page, 'Completed')).toContainText(
        '12 done · 1 missed · latest Tue, Oct 13',
      );
      await expect(fold(page, 'Archived')).toContainText('3 archived');
      await expect(fold(page, 'More filters')).toContainText(
        'Any tag · Chores and tasks · Any time',
      );
      await fits(page);
      await contrastOk(page);

      // Every fold opened by a tap on its header.
      await fold(page, 'Completed').locator(':scope > summary').click();
      await expect(rows(page, 'Completed')).toHaveCount(13);
      await expect(rows(page, 'Completed').filter({ hasText: 'recital' })).toContainText(
        'Missed Sat, Oct 10',
      );
      await fold(page, 'Archived').locator(':scope > summary').click();
      await expect(rows(page, 'Archived').locator('.fw-row__name')).toHaveText([
        'Recorder practice',
        'Swim bag ready',
        'Sell the old bike',
      ]);
      await fold(page, 'More filters').locator(':scope > summary').click();
      await expect(page.getByRole('combobox', { name: 'Tag' })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Kind' }).getByRole('link')).toHaveText([
        'Both',
        'Chores',
        'Tasks',
      ]);
      await fits(page);
      await contrastOk(page);
    });
  }

  test('[CHR-21-g] a face chosen filters every section; More filters reads what is set', async ({
    page,
  }) => {
    await open(page, '/dev/chores?who=Maya');
    const chips = page.getByRole('group', { name: 'Whose' });
    await expect(chips.getByRole('button', { name: 'Maya' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(chips.getByRole('button', { name: 'Leo' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(chips.getByRole('link', { name: 'Clear' })).toHaveAttribute(
      'href',
      '/admin/chores',
    );
    // Every row left is for Maya.
    for (const r of await page.locator('.fw-row').all()) {
      await expect(r.locator('.fw-row__l2')).toContainText('Maya');
    }
    await expect(fold(page, 'Completed')).toContainText('done · 1 missed for Maya');
    await expect(fold(page, 'Archived')).toContainText('1 archived');

    await open(page, '/dev/chores?tag=Kitchen');
    await expect(fold(page, 'More filters')).toContainText('Tag: Kitchen · 2 of 35 show');
    await open(page, '/dev/chores?who=Alex&kind=chore');
    await expect(page.getByText('Nothing for Alex here with these filters.')).toBeVisible();
    await expect(rows(page, 'Recurring').locator('.fw-row__name')).toHaveText([
      'Take out the bins',
    ]);
    await fits(page);
  });

  test('[CHR-21-g] a ⋯ menu opened by a tap: Edit, Duplicate and Archive; Do again first on a completed one; Restore on an archived one', async ({
    page,
  }) => {
    await open(page, '/dev/chores?open=completed');
    await moreFor(page, 'Homework').click();
    const menu = menuOf(page, 'Homework');
    await expect(menu.getByRole('link')).toHaveText(['Edit', 'Duplicate']);
    await expect(menu.getByRole('button', { name: 'Archive Homework' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Duplicate Homework' })).toHaveAttribute(
      'href',
      /\/admin\/chores\/new\?from=/,
    );
    await fits(page);
    // Escape closes it; so does a tap elsewhere.
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await moreFor(page, 'Clean out the garage').click();
    const garage = menuOf(page, 'Clean out the garage');
    await expect(garage.getByRole('link')).toHaveText(['Do again…', 'Edit', 'Duplicate']);
    await page.getByRole('heading', { name: 'Chores and tasks' }).click();
    await expect(garage).toBeHidden();

    await open(page, '/dev/chores?open=archived&menu=Swim%20bag%20ready');
    const swim = menuOf(page, 'Swim bag ready');
    await expect(swim.getByRole('button', { name: 'Restore Swim bag ready' })).toBeVisible();
    await expect(swim.getByRole('link')).toHaveText(['Duplicate']);
    await contrastOk(page);
  });

  test('[CHR-21-h] pressing and holding a row opens its menu, not the link nor Safari’s preview', async ({
    page,
    browserName,
  }, testInfo) => {
    await open(page, '/dev/chores');
    const row = rows(page, 'Recurring').filter({ hasText: 'Feed the dog' });
    const name = row.getByRole('link', { name: 'Feed the dog' });
    // What stops Safari's callout and link preview on a hold: no callout and no text selection.
    // -webkit-touch-callout exists only where the engine has touch callouts (WebKit built for iOS);
    // where it does, the row and its link read "none".
    const callout = await row.evaluate(() => CSS.supports('-webkit-touch-callout', 'none'));
    testInfo.annotations.push({
      type: 'touch-callout',
      description: `${browserName}: ${callout ? 'supported, checked' : 'not in this engine'}`,
    });
    if (callout) {
      for (const el of [row, name]) {
        expect(
          await el.evaluate((e) => getComputedStyle(e).getPropertyValue('-webkit-touch-callout')),
        ).toBe('none');
      }
    }
    expect(
      await row.evaluate((e) => {
        const st = getComputedStyle(e);
        return st.userSelect || st.getPropertyValue('-webkit-user-select');
      }),
    ).toBe('none');
    // The browser's own context menu (a long press on Android, a right click) is the row's.
    const prevented = await name.evaluate((e) => {
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      e.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await expect(menuOf(page, 'Feed the dog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuOf(page, 'Feed the dog')).toBeHidden();

    // A held press, by touch on the phone and by mouse on a laptop.
    const box = (await name.boundingBox())!;
    const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const url = page.url();
    if (testInfo.project.use.hasTouch) {
      await name.dispatchEvent('pointerdown', {
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: at.x,
        clientY: at.y,
      });
      await expect(menuOf(page, 'Feed the dog')).toBeVisible();
      await name.dispatchEvent('pointerup', { pointerType: 'touch', clientX: at.x, clientY: at.y });
      await name.dispatchEvent('click', { clientX: at.x, clientY: at.y });
    } else {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      await expect(menuOf(page, 'Feed the dog')).toBeVisible();
      await page.mouse.up();
    }
    // The release did not follow the name's link: still on the page, its menu open.
    await expect(
      menuOf(page, 'Feed the dog').getByRole('link', { name: 'Edit Feed the dog' }),
    ).toBeVisible();
    expect(page.url()).toBe(url);
  });

  test('[CHR-21-g] Completed opened: the newest 20, then Show older', async ({ page }) => {
    await open(page, '/dev/chores?state=older&open=completed');
    await expect(rows(page, 'Completed')).toHaveCount(20);
    await expect(page.getByText('Showing the newest 20 of 26.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show older' })).toHaveAttribute(
      'href',
      /older=1#completed$/,
    );
    await open(page, '/dev/chores?state=older&older=1');
    await expect(fold(page, 'Completed')).toHaveAttribute('open');
    await expect(rows(page, 'Completed')).toHaveCount(26);
    await expect(page.getByRole('link', { name: 'Show older' })).toHaveCount(0);
    await fits(page);
  });

  test('[CHR-21-g] a family just started: all four sections show and say so', async ({ page }) => {
    await open(page, '/dev/chores?state=empty');
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Scheduled',
      'Recurring',
      'Completed',
      'Archived',
    ]);
    await expect(page.getByText('Nothing one-time coming up.')).toBeVisible();
    await expect(page.getByText('Nothing repeats yet.')).toBeVisible();
    await expect(fold(page, 'Completed')).toContainText('None done yet');
    await expect(fold(page, 'Archived')).toContainText('None archived');
    await fits(page);
    await contrastOk(page);
  });

  test('[CHR-23-a] Do again’s sheet: a date picked, what the first one keeps', async ({ page }) => {
    await open(page, '/dev/chores?again=Clean%20out%20the%20garage');
    const sheet = page.getByRole('dialog', { name: 'Do again: Clean out the garage' });
    await expect(sheet).toContainText('Adds a new one-time chore for Maya and Leo, +20,');
    const when = sheet.getByRole('group', { name: 'When' });
    await expect(when.getByRole('radio', { name: 'Sat, Oct 17' })).toBeChecked();
    await expect(sheet.getByLabel('Or a date')).toHaveValue('2026-10-17');
    await when.getByText('Tomorrow').click();
    await expect(sheet.getByLabel('Or a date')).toHaveValue('2026-10-15');
    await expect(sheet).toContainText(
      'The first one stays done on Sun, Oct 11. Maya and Leo keep its 20 points and its goal credit.',
    );
    await expect(sheet.getByRole('button', { name: 'Add it' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Change more first' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
    await open(page, '/dev/chores?banner=again');
    await expect(page.getByRole('status')).toHaveText(
      'Added Clean out the garage for Sat, Oct 17. It’s in Scheduled, under This week.',
    );
  });
});

test.describe('the ⋯ menus with no service worker', () => {
  // A page the service worker controls sends its fetches through it, and WebKit then doesn't route
  // them to the test: a choice's page couldn't be held here (as Groceries' ⋯ test, WP-104).
  test.use({ serviceWorkers: 'block' });

  for (const [url, title] of [
    ['/dev/chores', 'Feed the dog'],
    ['/dev/chores?open=completed', 'Clean out the garage'],
    ['/dev/meals?page=library', 'Spaghetti'],
    ['/dev/tags', 'Kitchen'],
  ] as const) {
    test(`[NFR-16-t] ${title}’s ⋯ fits inside the screen and closes once a choice is made (${url})`, async ({
      page,
    }) => {
      await open(page, url);
      await moreFor(page, title).click();
      const menu = menuOf(page, title);
      await expect(menu).toBeVisible();
      // Every choice and its words sit inside the menu, and the menu inside the screen.
      const outside = await menu.evaluate((m) => {
        const box = m.getBoundingClientRect();
        const out = [...m.querySelectorAll('.fw-row__mi, .fw-row__mi > *')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.right > box.right + 0.5 || r.left < box.left - 0.5;
          })
          .map((el) => el.textContent?.trim());
        if (box.left < 0 || box.right > document.documentElement.clientWidth) out.push('the menu');
        return out;
      });
      expect(outside).toEqual([]);
      // A choice closes it at once. Its page (signed in, under /admin) and a form's post are
      // held, so this page stays to be looked at.
      const held: unknown[] = [];
      await page.route('**/admin/**', (route) => void held.push(route));
      await page.route(
        (u) => u.pathname.startsWith('/dev/'),
        (route) => (route.request().method() === 'POST' ? void held.push(route) : route.fallback()),
      );
      const more = page
        .locator('li', { has: moreFor(page, title) })
        .locator('details.fw-row__more');
      await menu.getByRole('link', { name: `Edit ${title}` }).click();
      await expect(more).not.toHaveAttribute('open');
      await moreFor(page, title).click();
      await expect(menu).toBeVisible();
      await menu.getByRole('button', { name: `Archive ${title}` }).click();
      await expect(more).not.toHaveAttribute('open');
    });
  }
});

test.describe('An item’s page, Duplicate, the Meal library and Tags', () => {
  for (const theme of ['day', 'evening'] as const) {
    test(`[NFR-16-t] an item’s page folded: the form open, More options, Coming up, Last 7 days and Archive folded, each opened; ${theme}`, async ({
      page,
    }) => {
      await open(page, `/dev/chores?page=item&theme=${theme}`);
      await expect(page.getByRole('heading', { name: 'Feed the dog', level: 1 })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Feed the dog');
      const folds: [string, string][] = [
        ['More options', 'Approval: family setting (off) · every kind of day · any lunch day'],
        ['Coming up', 'Next: today 5:00 pm, Maya · 15 in the next two weeks'],
        ['Last 7 days', '5 done · 1 missed · 1 skipped'],
        ['Archive', 'Takes it off the list and the boards; its history stays'],
      ];
      for (const [title, line] of folds) {
        await expect(fold(page, title)).not.toHaveAttribute('open');
        await expect(fold(page, title)).toContainText(line);
      }
      await fits(page);
      await contrastOk(page);
      for (const [title] of folds) await fold(page, title).locator(':scope > summary').click();
      await expect(page.getByRole('combobox', { name: 'Approval' })).toBeVisible();
      await expect(rows(page, 'Coming up')).toHaveCount(15);
      await expect(rows(page, 'Last 7 days')).toHaveCount(7);
      await expect(page.getByRole('button', { name: 'Archive Feed the dog' })).toBeVisible();
      await fits(page);
      await contrastOk(page);
    });
  }

  test('[NFR-16-t] Duplicate’s form filled in, "(copy)"; Do again’s Change more first on its date', async ({
    page,
  }) => {
    await open(page, '/dev/chores?page=copy');
    await expect(page.getByRole('heading', { name: 'Add a chore', level: 1 })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('A copy of Homework.');
    const form = page.getByRole('form', { name: 'Add an item' });
    await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Homework (copy)');
    await expect(form.getByRole('checkbox', { name: 'Maya', exact: true })).toBeChecked();
    await expect(form.getByRole('checkbox', { name: 'Leo', exact: true })).toBeChecked();
    await expect(form.getByRole('textbox', { name: /^Points/ })).toHaveValue('10');
    await expect(form).toContainText('The copy starts fresh.');
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await fits(page);
    await open(page, '/dev/chores?page=again');
    await expect(page.getByRole('status')).toContainText(
      'Do again: Clean out the garage, on Sat, Oct 17.',
    );
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Clean out the garage');
    await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-17');
  });

  test('[NFR-16-t][MEAL-25-h] the Meal library: a meal a row with ⋯ (Edit, Duplicate, Archive); Duplicate opens Add a meal filled in', async ({
    page,
  }) => {
    await open(page, '/dev/meals?page=library');
    const meals = rows(page, 'Meals');
    await expect(meals.first().locator('.fw-row__name')).toHaveText('Tacos');
    // One row per meal: no "Edit <meal>" line under it.
    await expect(page.getByText('Edit Tacos', { exact: true })).toHaveCount(0);
    await moreFor(page, 'Tacos').click();
    const menu = menuOf(page, 'Tacos');
    await expect(menu.getByRole('link')).toHaveText(['Edit', 'Duplicate']);
    await expect(menu.getByRole('button', { name: 'Archive Tacos' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
    await open(page, '/dev/meals?page=library&copy=Tacos');
    const add = page.getByRole('form', { name: 'Add a meal' });
    await expect(add.getByRole('textbox', { name: 'Name' })).toHaveValue('Tacos (copy)');
    // [MEAL-25-h] Copy all (the owner's answer): ingredients, link, steps, and its files on save.
    await expect(add.getByRole('textbox', { name: 'Ingredient 1' })).toHaveValue('Ground beef');
    await expect(add.getByLabel('Recipe link')).toHaveValue('https://example.com/tacos');
    await expect(add.locator('input[name="recipeSteps"]')).toHaveCount(1);
    await expect(add.locator('input[name="copyFrom"]')).toHaveCount(1);
    await expect(add).toContainText(
      'Grandma’s card.jpg, Taco night.pdf are copied with it when you tap Add meal.',
    );
    // The original's files are not offered for removal from the copy's form.
    await expect(add.getByRole('list', { name: 'Photos and PDFs' })).toHaveCount(0);
    await expect(add.getByRole('button', { name: 'Remove Taco night.pdf' })).toHaveCount(0);
    await expect(add.getByRole('button', { name: 'Add meal' })).toBeVisible();
    await open(page, '/dev/meals?page=library&edit=Tacos');
    await expect(page.getByRole('form', { name: 'Edit Tacos' })).toBeVisible();
    await fits(page);
  });

  test('[NFR-16-t] Tags: a tag a row with ⋯ (Edit, Archive); Edit opens its form under the row', async ({
    page,
  }) => {
    await open(page, '/dev/tags');
    await expect(rows(page, 'Tags').locator('.fw-row__name')).toHaveText([
      'Morning',
      'Kitchen',
      'Bedroom',
      'School',
    ]);
    await moreFor(page, 'Kitchen').click();
    const menu = menuOf(page, 'Kitchen');
    await expect(menu.getByRole('link', { name: 'Edit Kitchen' })).toBeVisible();
    await expect(menu.getByRole('button', { name: 'Archive Kitchen' })).toBeVisible();
    await fits(page);
    await contrastOk(page);
    await open(page, '/dev/tags?open=Kitchen');
    await expect(page.getByRole('form', { name: 'Edit Kitchen' })).toBeVisible();
  });
});
