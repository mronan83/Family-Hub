import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [NFR-17][US-109][ACC-08][US-110] Home at a glance and Family options (WP-57, D-84), on /dev/home and
// /dev/family with the made-up family and no database: what needs a parent first, each with where to
// deal with it, then heads-ups; one tap to add a chore, a task, a reward, a goal or a meal, to call off
// school today (or undo it) and to fetch the school menus; and the household's options in Settings.
// On a phone and a laptop, in Day and Evening: nothing overlaps or scrolls sideways, buttons and links
// are 44 px tall at least, and contrast is AA. The actions themselves run on the preview
// (e2e/tests/home.spec.ts).

async function contrastOk(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => `${n.target}: ${n.failureSummary}`))).toEqual(
    [],
  );
}

/** The page's width, controls under 44 px tall, and any two controls that overlap. */
const fit = (page: Page) =>
  page.evaluate(() => {
    const shown = [
      ...document.querySelectorAll<HTMLElement>(
        'main button, main a, main input, main select, main summary',
      ),
    ]
      // Not what a closed "Add a day off…" holds: it isn't on the page until opened.
      .filter((e) => e.tagName === 'SUMMARY' || !e.closest('details:not([open])'))
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden');
    const boxes = shown.map((e) => ({ e, r: e.getBoundingClientRect() }));
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i]!, boxes[j]!];
        if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 1 && y > 1)
          overlaps.push(`${a.e.textContent?.trim()} / ${b.e.textContent?.trim()}`);
      }
    }
    return {
      wide: document.documentElement.scrollWidth,
      small: boxes
        .filter(
          ({ e, r }) => r.height < 44 && !(e instanceof HTMLInputElement && e.type === 'radio'),
        )
        // A link inside a sentence (a credit) is the sentence's size, as WCAG's target size allows.
        .filter(({ e }) => !(e instanceof HTMLAnchorElement && e.closest('p')))
        .map(({ e }) => e.textContent?.trim() || e.getAttribute('name')),
      overlaps,
    };
  });

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${device}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[NFR-17][NFR-16] Home in ${theme}: tidy, nothing overlapping, 44 px controls, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/home?theme=${theme}`);
        await expect(page.getByRole('heading', { name: 'Needs you' })).toBeVisible();
        const f = await fit(page);
        expect(f.wide).toBe(width);
        expect(f.small).toEqual([]);
        expect(f.overlaps).toEqual([]);
        await contrastOk(page);
      });

      test(`[ACC-08][NFR-16] Family options in ${theme}: tidy, nothing overlapping, AA contrast`, async ({
        page,
      }) => {
        await page.goto(`/dev/family?theme=${theme}&state=pending`);
        await expect(page.getByRole('heading', { name: 'Family options', level: 1 })).toBeVisible();
        const f = await fit(page);
        expect(f.wide).toBe(width);
        expect(f.small).toEqual([]);
        expect(f.overlaps).toEqual([]);
        await contrastOk(page);
      });
    }
  });
}

test.describe('what Home says', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('[NFR-17][US-109] what needs you, then heads-ups, each with where to deal with it', async ({
    page,
  }) => {
    await page.goto('/dev/home');
    const needs = page.getByRole('list', { name: 'Needs you' });
    await expect(needs.getByRole('listitem')).toHaveText([
      /2 check-offs wait for you/,
      /1 reward request waits for you/,
      /Den hasn’t been seen for 3 hours/,
      /School can’t sync/,
    ]);
    await expect(needs.getByRole('link', { name: 'Review' })).toHaveAttribute(
      'href',
      '/admin/today',
    );
    await expect(needs.getByRole('link', { name: 'Decide' })).toHaveAttribute(
      'href',
      '/admin/rewards',
    );
    const heads = page.getByRole('list', { name: 'Heads-up' });
    await expect(heads).toContainText('No school menu for next week yet');
    await expect(heads.getByRole('link', { name: 'School menus' })).toHaveAttribute(
      'href',
      '/admin/meals/menus',
    );
    // Nothing to look at: one calm line, and no heads-up list.
    await page.goto('/dev/home?state=quiet');
    await expect(page.getByText('Nothing needs you right now.')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Heads-up' })).toHaveCount(0);
  });

  test('[NFR-17][US-109] the quick actions open the page that adds each thing', async ({
    page,
  }) => {
    await page.goto('/dev/home');
    const quick = page.getByRole('list', { name: 'Quick actions' });
    for (const [name, href] of [
      ['Add a chore', '/admin/chores/new'],
      ['Add a task', '/admin/chores/new?kind=task'],
      ['Add a reward', '/admin/rewards/new'],
      ['Add a goal', '/admin/goals/new'],
    ] as const) {
      await expect(quick.getByRole('link', { name })).toHaveAttribute('href', href);
    }
    const more = page.getByRole('list', { name: 'More quick actions' });
    await expect(more.getByRole('link', { name: 'Plan a meal' })).toHaveAttribute(
      'href',
      '/admin/meals#add',
    );
    await expect(more.getByRole('link', { name: 'New in the library' })).toHaveAttribute(
      'href',
      '/admin/meals/library',
    );
    await expect(more.getByRole('button', { name: 'No school today' })).toBeVisible();
    await expect(more.getByRole('button', { name: 'Refresh school menu' })).toBeVisible();
    // A day off ahead: the form opens in place, a day off to start with.
    await more.getByText('Add a day off…').click();
    const dayOff = more.getByRole('form', { name: 'Add a day off' });
    await expect(dayOff.getByLabel('Kind')).toHaveValue('other');
    const f = await fit(page);
    expect(f.overlaps).toEqual([]);
  });

  test('[NFR-17][SCH-01] school today: a snow day with Undo, the weekend, no school year, no menu feed', async ({
    page,
  }) => {
    await page.goto('/dev/home?school=off');
    await expect(page.getByText('No school today: Snow day')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'No school today' })).toHaveCount(0);
    await page.goto('/dev/home?school=weekend');
    await expect(page.getByText('No school today: the weekend')).toBeVisible();
    await page.goto('/dev/home?school=none&menus=none');
    await expect(page.getByRole('link', { name: 'Set up the school year' })).toHaveAttribute(
      'href',
      '/admin/school',
    );
    await expect(page.getByRole('link', { name: 'Set up school menus' })).toBeVisible();
  });
});

test.describe('Family options', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[ACC-08][US-110] the week starts on a day; a change waits for next week, and can be kept as is', async ({
    page,
  }) => {
    await page.goto('/dev/family');
    const week = page.getByRole('region', { name: 'The week' });
    await expect(week).toContainText('The week starts on Sunday.');
    await expect(week.getByRole('button', { name: /^Keep/ })).toHaveCount(0);
    await page.goto('/dev/family?state=pending');
    await expect(week).toContainText(
      'The week starts on Sunday. From Monday, Oct 19, it starts on Monday.',
    );
    await expect(week.getByLabel('Start the week on')).toHaveValue('1');
    await expect(week.getByRole('button', { name: 'Keep Sunday' })).toBeVisible();
  });

  test('[CHR-05][NFR-16] check-offs: each choice on a line of its own', async ({ page }) => {
    await page.goto('/dev/family');
    const form = page.getByRole('form', { name: 'Check-offs', exact: true });
    const [a, b] = await Promise.all([
      form.getByText('It counts straight away').boundingBox(),
      form.getByText('It waits for a parent').boundingBox(),
    ]);
    expect(b!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
  });

  test('[ACC-08] Family options holds check-offs, the weather, the admins and invites', async ({
    page,
  }) => {
    await page.goto('/dev/family');
    for (const name of ['Check-offs', 'Weather on the boards', 'Admins', 'Invite an admin']) {
      await expect(page.getByRole('region', { name })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Settings' }).last()).toHaveAttribute(
      'href',
      '/admin/settings',
    );
  });
});
