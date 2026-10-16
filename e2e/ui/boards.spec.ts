import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// [DEV-03][DEV-05][DEV-07][BRD-05][BRD-08][DEV-09][D-118][D-120] Boards folded (WP-91) on /dev/boards: the
// made-up family, no database, Thursday 15 October 2026 at 7:42 am. Each board folded at first to
// its name and facts, Playroom's not-seen warning on its header; the household's Home screen to
// one line, Add a board to its button, Disconnected to a count. Each opened by a tap after React
// has taken the page over (D-110): a board's Display, Sleep and wake, Calendars and Home screen,
// then its name and Disconnect set apart. On a phone and a laptop, in Day and Evening. Saving runs
// on the preview (e2e/tests/devices.spec.ts).

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

/** The page's width, and the controls in sight under 44 px tall (radios and checkboxes aside). */
const fit = (page: Page) =>
  page.evaluate(() => ({
    wide: document.documentElement.scrollWidth,
    small: [
      ...document.querySelectorAll<HTMLElement>(
        'main button, main summary, main select, main input:not([type=hidden]):not(.fw-visually-hidden)',
      ),
    ]
      .filter((e) => !(e instanceof HTMLInputElement && ['radio', 'checkbox'].includes(e.type)))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.height > 0 && r.height < 44;
      })
      .map((e) => e.getAttribute('aria-label') || e.getAttribute('name') || e.textContent?.trim()),
  }));

const folds = (page: Page) => page.locator('main details:is(.fw-fold, .fw-card.fw-fold > details)');
const board = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Paired boards' }).locator('details.fw-fold--row', {
    has: page.getByRole('heading', { name, exact: true }),
  });
const section = (page: Page, heading: string) =>
  page.locator('section.fw-fold', { has: page.getByRole('heading', { name: heading, level: 2 }) });

for (const [width, height, device] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`Boards on ${device}`, () => {
    test.use({ viewport: { width, height } });

    for (const theme of ['day', 'evening'] as const) {
      test(`[DEV-03][DEV-09][D-118] every fold closed, then each opened by a tap, in ${theme}`, async ({
        page,
      }) => {
        await open(page, `/dev/boards${theme === 'evening' ? '?theme=evening' : ''}`);

        await test.step('folded at first: each board’s facts, the warning, the summaries', async () => {
          await expect(folds(page)).toHaveCount(6);
          for (const d of await folds(page).all()) await expect(d).not.toHaveAttribute('open');
          await expect(board(page, 'Kitchen').locator(':scope > summary')).toContainText(
            'Awake · sleeps at 9:30 pm · seen 1 min ago · Automatic · Standard text · household layout',
          );
          await expect(board(page, 'Hallway tablet').locator(':scope > summary')).toContainText(
            'Asleep · wakes at 8:00 am · seen 7 h ago · Always Day · Larger text · its own layout',
          );
          const playroom = board(page, 'Playroom').locator(':scope > summary');
          await expect(playroom).toContainText(
            'Awake · no set times · seen Tue, Oct 13 at 7:12 am · Automatic · Standard text · household layout',
          );
          // Home lists Playroom as not seen, so its folded header says so.
          await expect(playroom.getByText('Not seen for 2 days')).toBeVisible();
          await expect(board(page, 'Kitchen').getByText(/^Not seen/)).toHaveCount(0);
          await expect(section(page, 'Home screen').locator('.fw-fold__sum')).toHaveText(
            '5 days · meals on · Goals, Waiting, Coming up · weather on',
          );
          await expect(section(page, 'Add a board').locator('.fw-fold__closed')).toHaveText(
            'Add a board',
          );
          await expect(section(page, 'Disconnected').locator('.fw-fold__sum')).toHaveText(
            '2 disconnected',
          );
          await expect(page.getByRole('form', { name: 'Text size for Kitchen' })).toBeHidden();
          expect(await fit(page)).toEqual({ wide: width, small: [] });
          await contrastOk(page);
        });

        await test.step('Kitchen opened: its groups, in order, with its name and Disconnect apart', async () => {
          const kitchen = board(page, 'Kitchen');
          await kitchen.locator(':scope > summary').click();
          await expect(kitchen).toHaveAttribute('open', '');
          expect(await kitchen.locator('h3').allTextContents()).toEqual([
            'Display',
            'Sleep and wake',
            'Calendars',
            'Home screen',
            'Name and connection',
          ]);
          await expect(kitchen.getByRole('combobox', { name: 'Theme for Kitchen' })).toHaveValue(
            'auto',
          );
          await expect(
            kitchen.getByRole('combobox', { name: 'Text size for Kitchen' }),
          ).toHaveValue('standard');
          await expect(kitchen.getByRole('checkbox', { name: 'Family' })).toBeChecked();
          await expect(kitchen.getByRole('checkbox', { name: 'Maya’s soccer' })).not.toBeChecked();
          await expect(
            kitchen.getByRole('checkbox', { name: 'Give Kitchen its own layout' }),
          ).not.toBeChecked();
          await expect(kitchen.getByRole('form', { name: 'Rename Kitchen' })).toBeVisible();
          await expect(kitchen.getByText('Disconnect Kitchen', { exact: true })).toBeVisible();
          // Disconnect still asks first.
          await expect(
            kitchen.getByRole('button', { name: 'Yes, disconnect Kitchen' }),
          ).toBeHidden();
        });

        await test.step('the other folds opened: the warning stays, the closed button goes', async () => {
          await board(page, 'Hallway tablet').locator(':scope > summary').click();
          await expect(
            page.getByRole('form', { name: 'Home screen on Hallway tablet' }),
          ).toBeVisible();
          const playroom = board(page, 'Playroom');
          await playroom.locator(':scope > summary').click();
          await expect(playroom.getByRole('form', { name: 'Theme for Playroom' })).toBeVisible();
          await expect(
            playroom.locator(':scope > summary').getByText('Not seen for 2 days'),
          ).toBeVisible();

          await section(page, 'Home screen').locator('summary').click();
          await expect(
            page.getByRole('form', { name: 'Home screen for every board' }),
          ).toBeVisible();
          await expect(section(page, 'Home screen').locator('.fw-fold__sum')).toBeHidden();

          await section(page, 'Add a board').locator('summary').click();
          await expect(page.getByRole('form', { name: 'Add a board' })).toBeVisible();
          await expect(section(page, 'Add a board').locator('.fw-fold__closed')).toBeHidden();

          await section(page, 'Disconnected').locator('summary').click();
          const gone = page.getByRole('list', { name: 'Disconnected boards' });
          await expect(gone.getByRole('listitem')).toHaveCount(2);
          await expect(gone).toContainText('Old iPad');

          for (const d of await folds(page).all()) await expect(d).toHaveAttribute('open', '');
          expect(await fit(page)).toEqual({ wide: width, small: [] });
          await contrastOk(page);
        });

        await test.step('a tap on an open fold folds it again', async () => {
          await board(page, 'Kitchen').locator(':scope > summary').click();
          await expect(board(page, 'Kitchen')).not.toHaveAttribute('open');
          await expect(page.getByRole('form', { name: 'Text size for Kitchen' })).toBeHidden();
        });
      });
    }
  });
}

test('[DEV-09][D-120] a board comes back open after a save in it, the rest folded', async ({
  page,
}) => {
  await open(page, '/dev/boards?open=kitchen&notice=saved');
  await expect(board(page, 'Kitchen')).toHaveAttribute('open', '');
  await expect(page.getByText('Saved sleep and wake for Kitchen.')).toBeVisible();
  await expect(board(page, 'Playroom')).not.toHaveAttribute('open');
  await expect(section(page, 'Home screen').locator('details')).not.toHaveAttribute('open');
  // The household's layout and Disconnected the same way.
  await open(page, '/dev/boards?open=household');
  await expect(section(page, 'Home screen').locator('details')).toHaveAttribute('open', '');
  await expect(board(page, 'Kitchen')).not.toHaveAttribute('open');
  await open(page, '/dev/boards?open=disconnected');
  await expect(section(page, 'Disconnected').locator('details')).toHaveAttribute('open', '');
});
