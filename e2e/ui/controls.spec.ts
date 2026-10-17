import { expect, test, type Page } from '@playwright/test';

// [NFR-16][D-127] The admin app's form controls as the approved mockups draw them (WP-100), on the
// made-up family's /dev pages, no database. It runs as a desktop Chrome and as an iPhone in WebKit
// (Safari's engine, the `iphone` project): iPhone Safari draws its own field, list, date, radio, check
// box and file picker unless the app draws them, which Chrome never showed. Every page in Day and
// Evening; then the goal form's boxes and chips, a goal page's head, the folded icon picker, the file
// picker. The board's goal card is in board-repeating.spec.ts.

/** The admin pages with forms or buttons, each a made-up family's (WP-100's sweep). */
const PAGES = [
  '/dev/goals',
  '/dev/goals?form=new',
  '/dev/goals?form=repeating',
  '/dev/goals?form=steps',
  '/dev/goals?form=count-steps',
  '/dev/goals?form=weighted',
  '/dev/goals?form=family',
  '/dev/goals?form=perfect',
  '/dev/forms?form=chore',
  '/dev/forms?form=tag',
  '/dev/forms?form=member',
  '/dev/forms?form=calendar',
  '/dev/rewards',
  '/dev/meals',
  '/dev/meals?page=library',
  '/dev/menus',
  '/dev/family',
  '/dev/reminders',
  '/dev/settings',
  '/dev/admin',
  '/dev/admin?view=today',
  '/dev/admin?view=my',
];

/** Every shown control the app should draw that it doesn't, with what is wrong. */
function wrongControls(page: Page) {
  return page.evaluate(() => {
    const color = (v: string) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${v})`;
      document.querySelector('.admin')!.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    const soft = color('--text-soft');
    const primary = color('--primary');
    const shown = (el: Element) => el.getClientRects().length > 0;
    const wrong: string[] = [];
    const name = (el: Element) =>
      el.getAttribute('aria-label') ??
      el.getAttribute('name') ??
      el.closest('label')?.textContent?.trim().slice(0, 40) ??
      el.tagName;
    const controls = [
      ...document.querySelectorAll(
        'main input:not([type=hidden]):not(.fw-visually-hidden):not(.fw-seg__input), main select, main textarea',
      ),
    ].filter(shown) as HTMLInputElement[];
    for (const el of controls) {
      const s = getComputedStyle(el);
      const appearance =
        s.getPropertyValue('appearance') || s.getPropertyValue('-webkit-appearance');
      if (appearance !== 'none') wrong.push(`${name(el)}: appearance ${appearance}`);
      if (el.type === 'file') wrong.push(`${name(el)}: the browser's own file picker`);
      if (el.type === 'radio' || el.type === 'checkbox') {
        const r = el.getBoundingClientRect();
        if (Math.round(r.width) !== 20 || Math.round(r.height) !== 20)
          wrong.push(`${name(el)}: ${r.width}×${r.height}, not 20×20`);
        const edge = s.borderTopColor;
        if (edge !== (el.checked ? primary : soft))
          wrong.push(`${name(el)}: edge ${edge}, checked ${el.checked}`);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.height < 44) wrong.push(`${name(el)}: ${r.height} px tall`);
      if (s.borderTopLeftRadius !== '10px')
        wrong.push(`${name(el)}: radius ${s.borderTopLeftRadius}`);
      if (parseFloat(s.fontSize) < 16) wrong.push(`${name(el)}: text ${s.fontSize}`);
    }
    for (const b of [...document.querySelectorAll('main button, main a.fw-btn')].filter(shown)) {
      const r = b.getBoundingClientRect();
      if (r.height < 44) wrong.push(`${name(b)}: button ${r.height} px tall`);
    }
    return wrong;
  });
}

for (const theme of ['day', 'evening'] as const) {
  test(`[NFR-16-a][NFR-16-b] every admin page’s fields, lists, dates, radios and check boxes are the app’s, in ${theme}`, async ({
    page,
  }) => {
    for (const path of PAGES) {
      await test.step(path, async () => {
        await page.goto(`${path}${path.includes('?') ? '&' : '?'}theme=${theme}`);
        expect(await wrongControls(page), path).toEqual([]);
      });
    }
  });
}

test('[NFR-16-a] a field is filled, 10 px round, with a 3:1 edge and the focus ring', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const name = page.getByRole('textbox', { name: 'Name' });
  const look = await name.evaluate((el) => {
    const s = getComputedStyle(el);
    const probe = document.createElement('span');
    probe.style.color = 'var(--bg)';
    el.parentElement!.append(probe);
    const bg = getComputedStyle(probe).color;
    probe.remove();
    return { fill: s.backgroundColor, bg, radius: s.borderTopLeftRadius };
  });
  expect(look.fill).toBe(look.bg);
  expect(look.radius).toBe('10px');
  await name.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(name).toHaveCSS('outline-width', '3px');
});

test('[NFR-16-d] the goal form: Repeats as chips, Who it’s for as choices, its parts in boxes', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  await test.step('Repeats is chips: the chosen one tinted, no radio dot', async () => {
    const repeats = form.getByRole('group', { name: 'Repeats' });
    await repeats.getByText('Each week').click();
    const chip = repeats.locator('.fw-seg__item', { hasText: 'Each week' });
    const tint = await page.evaluate(() => {
      const p = document.createElement('span');
      p.style.color = 'var(--primary-tint)';
      document.querySelector('.admin')!.append(p);
      return getComputedStyle(p).color;
    });
    await expect(chip).toHaveCSS('background-color', tint);
    // Its radio covers the chip, unseen: a tap on the chip is a tap on the radio.
    await expect(repeats.getByRole('radio', { name: 'Each week' })).toHaveCSS('opacity', '0');
  });
  await test.step('Who it’s for is choices, not chips with a ring', async () => {
    const who = form.getByRole('group', { name: 'Who it’s for' });
    const maya = who.locator('label', { has: page.getByRole('radio', { name: 'Maya' }) });
    await expect(maya).toHaveCSS('box-shadow', 'none');
    await expect(maya).toHaveCSS('border-top-style', 'none');
  });
  await test.step('Repeats, Rule, Counts only when done and what it pays are boxes', async () => {
    for (const box of ['Repeats', 'Rule', 'Counts only when done', 'What each week pays']) {
      await expect(form.getByRole('group', { name: box, exact: true })).toHaveClass(/fw-box/);
    }
    await form.getByRole('radio', { name: 'The whole family' }).check();
    await expect(form.getByRole('group', { name: 'For the whole family' })).toHaveClass(/fw-box/);
  });
  await test.step('the copy: Points first, Something else, Set the goal and Cancel', async () => {
    const pays = form.getByRole('group', { name: 'What each week pays' });
    await expect(pays.locator('label.fw-choice')).toHaveText([
      'Points',
      'A reward from the shop',
      'Something else',
    ]);
    await expect(form.getByRole('button', { name: 'Set the goal' })).toBeVisible();
    await expect(form.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '/admin/goals',
    );
  });
});

test('[NFR-16-e] a goal’s page: Goals to go back to, its name and state, then its form', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=repeating');
  const main = page.getByRole('main');
  await expect(main.locator('a.fw-crumb')).toHaveText('Goals');
  await expect(main.locator('a.fw-crumb')).toHaveAttribute('href', '/admin/goals');
  await expect(main.getByRole('heading', { level: 1 })).toHaveText(
    'Homework home every school day',
  );
  // Started: who it's for, how it repeats and its start are shown, not offered.
  const form = page.getByRole('form');
  await expect(form.getByText('Who it’s for', { exact: true })).toBeVisible();
  await expect(form.getByText('Each week', { exact: true })).toBeVisible();
  await expect(form.getByText('Sep 14, 2026')).toBeVisible();
  await expect(form.getByRole('radio', { name: 'Maya' })).toHaveCount(0);
  // Goals: the heading and Set a goal above the card of goals.
  await page.goto('/dev/goals');
  const head = page.locator('.fw-goals__head');
  await expect(head.getByRole('heading', { name: 'Goals', level: 1 })).toBeVisible();
  await expect(head.locator('xpath=..')).not.toHaveClass(/fw-card/);
});

test('[NFR-16-g] the icon picker folds to the icon chosen; opened, the search and the icons', async ({
  page,
}) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  const fold = form.locator('details', { hasText: 'Icon, shown when there’s no photo' });
  await expect(fold).not.toHaveAttribute('open');
  await expect(fold.locator('summary')).toContainText('Chosen: trophy');
  await expect(form.getByRole('searchbox', { name: 'Find an icon' })).toBeHidden();
  await fold.locator('summary').click();
  await form.getByRole('searchbox', { name: 'Find an icon' }).fill('fish');
  await form
    .locator('label', { has: page.getByRole('radio', { name: 'fish', exact: true }) })
    .click();
  await fold.locator('summary').click();
  await expect(fold.locator('summary')).toContainText('Chosen: fish');
});

test('[NFR-16-c] a photo is chosen with the app’s button, and its name shows', async ({ page }) => {
  await page.goto('/dev/goals?form=new');
  const form = page.getByRole('form', { name: 'Set a goal' });
  await expect(form.getByText('No photo chosen')).toBeVisible();
  await expect(form.getByText('Choose a photo')).toBeVisible();
  await form.getByLabel('Photo (optional)').setInputFiles({
    name: 'bike.png',
    mimeType: 'image/png',
    buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  });
  await expect(form.getByText('bike.png')).toBeVisible();
});
