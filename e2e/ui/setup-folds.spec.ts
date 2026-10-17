import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { foldOf, unfold } from '../support/fold';

// [NFR-18][D-120] The set-up pages folded (WP-94), on their /dev pages: made-up family, no database.
// Family options, School and a school year's page, Tags, Reminders and Health: each section set once
// folded to what it is set to, a warning or a count waiting on its header while folded, each opened by
// a tap after React has taken the page over (D-110), and the section saved in open again. Thursday,
// Oct 15, 2026 at 2:45 pm. On the preview, e2e/tests/admin-day.spec.ts saves Check-offs (NFR-18-w) and
// e2e/tests/health.spec.ts reads a failing job on its folded header (NFR-18-x).

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

/** A fold's header, and whether it is closed. */
const head = (fold: ReturnType<typeof foldOf>) => fold.locator(':scope > summary');
async function folded(page: Page, titles: string[]) {
  for (const t of titles) await expect(foldOf(page, t)).not.toHaveAttribute('open');
}

/** Opens every fold on the page by a tap, outer before inner, so every field is measured too. */
async function openAll(page: Page) {
  const closed = page.locator('main details:not([open]) > summary:visible');
  // Each tap opens one, waited on before the next; an inner fold shows once its outer one is open.
  for (let i = 0; (await closed.count()) > 0; i++) {
    await closed
      .first()
      .evaluate((s, n) => s.parentElement!.setAttribute('data-tapped', n), `${i}`);
    await closed.first().click();
    await expect(page.locator(`details[data-tapped="${i}"]`)).toHaveAttribute('open', '');
  }
  await expect(page.locator('main details:not([open])')).toHaveCount(0);
}

const PAGES = [
  ['Family options', '/dev/family?weather=failing'],
  ['School', '/dev/school'],
  ['a school year', '/dev/school?page=year'],
  ['Tags', '/dev/tags'],
  ['Reminders', '/dev/reminders?error=gone'],
  ['Health', '/dev/health?state=near'],
] as const;

for (const [width, height, name] of [
  [390, 844, 'a phone'],
  [1280, 800, 'a laptop'],
] as const) {
  test.describe(`on ${name}`, () => {
    test.use({ viewport: { width, height } });
    for (const theme of ['day', 'evening'] as const) {
      test(`[NFR-18-q][NFR-18-r][NFR-18-s][NFR-18-t][NFR-18-u][NFR-11] the set-up pages fit ${name} in ${theme}, folded and opened`, async ({
        page,
      }) => {
        for (const [what, url] of PAGES) {
          await test.step(what, async () => {
            await open(page, `${url}&theme=${theme}`);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            // Folded, the warnings are read too.
            await contrastOk(page);
            await openAll(page);
            expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
            const small = await page.evaluate(() =>
              [...document.querySelectorAll('main button, main input, main select, main summary')]
                .filter((b) => {
                  const r = b.getBoundingClientRect();
                  const type = (b as HTMLInputElement).type;
                  return r.height > 0 && r.height < 44 && type !== 'checkbox' && type !== 'radio';
                })
                .map(
                  (b) => b.getAttribute('aria-label') ?? b.getAttribute('name') ?? b.textContent,
                ),
            );
            expect(small).toEqual([]);
            await contrastOk(page);
          });
        }
      });
    }
  });
}

test.describe('folded', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[NFR-18-q][ACC-08] Family options: every section folded to what it is set to, the weather’s warning and the invites waiting on their headers', async ({
    page,
  }) => {
    await open(page, '/dev/family?weather=failing');
    await folded(page, [
      'The week',
      'Check-offs',
      'Weather on the boards',
      'Admins',
      'Invite an admin',
    ]);
    await expect(head(foldOf(page, 'The week'))).toContainText('Starts on Sunday');
    await expect(head(foldOf(page, 'Check-offs'))).toContainText(
      'A child’s check-off counts straight away; a parent can uncheck it later',
    );
    const weather = head(foldOf(page, 'Weather on the boards'));
    await expect(weather.locator('.fw-fold__flag')).toHaveText('Not updated since 2:10 pm');
    await expect(weather).toContainText(
      'Springfield, Illinois, United States · °F · last reading 54°F',
    );
    await expect(head(foldOf(page, 'Admins'))).toContainText('Alex (Owner) · Sam (Admin)');
    const invite = head(foldOf(page, 'Invite an admin'));
    await expect(invite.locator('.fw-fold__wait')).toHaveText('1 waiting · runs out in 2 days');
    await expect(invite.getByText('Invite', { exact: true })).toBeVisible();

    // A change waiting to start reads on the week's header.
    await open(page, '/dev/family?state=pending');
    await expect(head(foldOf(page, 'The week'))).toContainText(
      'Starts on Sunday · from Monday, Oct 19 it starts on Monday',
    );

    // Each opens by a tap.
    await unfold(foldOf(page, 'Admins'));
    await expect(page.getByRole('list', { name: 'Admins' }).getByRole('listitem')).toHaveText([
      /Alex · alex@example\.com\s*Owner/,
      /Sam · sam@example\.com\s*Admin/,
    ]);
    await unfold(foldOf(page, 'Invite an admin'));
    await expect(page.getByRole('list', { name: 'Open invites' })).toContainText(
      'grandma@example.com',
    );
    await expect(head(foldOf(page, 'Invite an admin')).locator('.fw-fold__wait')).toBeVisible();
  });

  test('[NFR-18-r][SCH-01] School: today and the years open, the cut-off, Add a school year and Archived folded', async ({
    page,
  }) => {
    await open(page, '/dev/school');
    await expect(page.getByRole('list', { name: 'Today for each member' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'School years' })).toContainText('Lincoln 2026–27');
    await folded(page, ['Lunch changes', 'Add a school year', 'Archived']);
    await expect(head(foldOf(page, 'Lunch changes'))).toContainText(
      'Today’s lunch can change until 8:00 am',
    );
    await expect(head(foldOf(page, 'Add a school year')).getByText('Add a year')).toBeVisible();
    await expect(head(foldOf(page, 'Archived'))).toContainText('1 archived: Lincoln 2025–26');
    await unfold(foldOf(page, 'Archived'));
    await expect(page.getByRole('list', { name: 'Archived school years' })).toContainText(
      'Lincoln 2025–26',
    );
    await unfold(foldOf(page, 'Add a school year'));
    await expect(page.getByRole('form', { name: 'Add a school year' })).toBeVisible();
  });

  test('[NFR-18-r][SCH-01][SCH-02] a school year: the timeline open, its set-up folded to its facts, Archive set apart at the bottom', async ({
    page,
  }) => {
    await open(page, '/dev/school?page=year');
    await expect(page.getByTestId('day-counts')).toBeVisible();
    const titles = ['Breaks and days off', 'Terms', 'Who follows it', 'Dates and name', 'Archive'];
    await folded(page, titles);
    // In that order, Archive last.
    await expect(page.locator('main > section.fw-fold h2')).toHaveText(titles);
    await expect(head(foldOf(page, 'Breaks and days off'))).toContainText(
      '4 days off · next: Teacher day, Fri, Oct 23',
    );
    await expect(head(foldOf(page, 'Terms'))).toContainText('2 terms: Fall, Spring');
    await expect(head(foldOf(page, 'Who follows it'))).toContainText('Maya, Leo');
    await expect(head(foldOf(page, 'Dates and name'))).toContainText(
      'Aug 26, 2026 to Jun 11, 2027 · Lincoln Elementary',
    );
    await expect(head(foldOf(page, 'Archive'))).toContainText(
      'Stops it applying; its days off stay as a record',
    );

    await unfold(foldOf(page, 'Breaks and days off'));
    await expect(page.getByRole('list', { name: 'Breaks and days off' })).toContainText(
      'Thanksgiving break',
    );
    const addDay = foldOf(page, 'Add a day off');
    await expect(addDay).not.toHaveAttribute('open');
    await expect(head(addDay).getByText('Add a day off', { exact: true }).last()).toBeVisible();
    await unfold(addDay);
    await expect(page.getByRole('form', { name: 'Add a day off' }).getByLabel('Kind')).toHaveValue(
      'break',
    );
    await unfold(foldOf(page, 'Terms'));
    await unfold(foldOf(page, 'Add a term'));
    await expect(page.getByRole('form', { name: 'Add a term' })).toBeVisible();
    await unfold(foldOf(page, 'Archive'));
    await expect(page.getByRole('button', { name: 'Archive Lincoln 2026–27' })).toBeVisible();

    // A year with nothing set up: its add forms open, its headers say so.
    await open(page, '/dev/school?page=year&state=empty');
    await expect(head(foldOf(page, 'Breaks and days off'))).toContainText('None yet');
    await expect(head(foldOf(page, 'Terms'))).toContainText('None yet');
    await expect(head(foldOf(page, 'Who follows it'))).toContainText(
      'Everyone not given another year',
    );
    await unfold(foldOf(page, 'Breaks and days off'));
    await unfold(foldOf(page, 'Terms'));
    await expect(foldOf(page, 'Add a day off')).toHaveAttribute('open', '');
    await expect(foldOf(page, 'Add a term')).toHaveAttribute('open', '');
  });

  test('[NFR-18-s][CHR-10] Tags: Add a tag folded to its button, Our tags open, each Edit a fold, Archived folded to its count', async ({
    page,
  }) => {
    await open(page, '/dev/tags');
    await folded(page, ['Add a tag', 'Archived', 'Edit Morning', 'Edit Kitchen']);
    await expect(head(foldOf(page, 'Add a tag')).getByText('Add a tag').last()).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Tags', exact: true }).getByRole('listitem'),
    ).toHaveCount(4);
    await expect(head(foldOf(page, 'Archived'))).toContainText('1 archived: Garden');
    await unfold(foldOf(page, 'Edit Kitchen'));
    await expect(page.getByRole('form', { name: 'Edit Kitchen' }).getByLabel('Name')).toHaveValue(
      'Kitchen',
    );
    await expect(page.getByRole('button', { name: 'Archive Kitchen' })).toBeVisible();
    await expect(foldOf(page, 'Edit Morning')).not.toHaveAttribute('open');
    await unfold(foldOf(page, 'Archived'));
    await expect(page.getByRole('button', { name: 'Restore Garden' })).toBeVisible();
  });

  test('[NFR-18-t][CHR-15] Reminders: the state open, My devices and When to remind me folded, a removed device on the header', async ({
    page,
  }) => {
    await open(page, '/dev/reminders?error=gone');
    await expect(page.getByText('On. Reminders come to the devices below.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off reminders' })).toBeVisible();
    await folded(page, ['My devices', 'When to remind me']);
    const devices = head(foldOf(page, 'My devices'));
    await expect(devices.locator('.fw-fold__flag')).toHaveText('1 removed');
    await expect(devices).toContainText('2 devices, 1 on, 1 off · last reached 9:14 am');
    await unfold(foldOf(page, 'My devices'));
    await expect(page.getByRole('list', { name: 'My devices' }).getByRole('listitem')).toHaveCount(
      2,
    );
    await expect(devices.locator('.fw-fold__flag')).toBeVisible();
    // No device removed: no warning.
    await open(page, '/dev/reminders');
    await expect(head(foldOf(page, 'My devices')).locator('.fw-fold__flag')).toHaveCount(0);
  });

  test('[NFR-18-u][NFR-07][NFR-08] Health: the verdict open, jobs, errors and usage folded, a failing job and a limit near on their headers', async ({
    page,
  }) => {
    await open(page, '/dev/health?state=near');
    await expect(page.getByRole('status').filter({ hasText: 'needs attention' })).toContainText(
      'Calendar sync',
    );
    await folded(page, ['Background jobs', 'Server errors', 'Usage']);
    const jobs = head(foldOf(page, 'Background jobs'));
    await expect(jobs.locator('.fw-fold__flag')).toHaveText('Calendar sync: Failing');
    await expect(jobs).toContainText('7 running fine · 1 failing');
    await expect(head(foldOf(page, 'Server errors'))).toContainText(
      '3 in the last 30 days · latest Oct 14',
    );
    const usage = head(foldOf(page, 'Usage'));
    await expect(usage.locator('.fw-fold__flag')).toHaveText('Near a limit: Active CPU');
    await expect(usage).toContainText('Highest: Active CPU, 88% of the free plan');
    await unfold(foldOf(page, 'Background jobs'));
    await expect(
      page.getByRole('list', { name: 'Background jobs' }).getByRole('listitem'),
    ).toHaveCount(8);

    await open(page, '/dev/health?state=fine');
    await expect(page.getByText('Everything is running normally.')).toBeVisible();
    await expect(head(foldOf(page, 'Background jobs')).locator('.fw-fold__flag')).toHaveCount(0);
    await expect(head(foldOf(page, 'Server errors'))).toContainText('None in the last 30 days');
    await expect(head(foldOf(page, 'Usage'))).toContainText(
      'Highest: Database, 31% of the free plan',
    );
  });
});

test.describe('open again', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('[NFR-18-v][D-120] the section saved in comes back open and the others stay folded', async ({
    page,
  }) => {
    for (const [url, opened, closed] of [
      ['/dev/family?open=check-offs', 'Check-offs', ['The week', 'Weather on the boards']],
      ['/dev/family?open=week', 'The week', ['Check-offs', 'Admins']],
      ['/dev/family?open=weather', 'Weather on the boards', ['The week', 'Check-offs']],
      ['/dev/school?open=lunch', 'Lunch changes', ['Add a school year', 'Archived']],
      ['/dev/school?open=archived', 'Archived', ['Lunch changes']],
      ['/dev/school?page=year&open=closures', 'Breaks and days off', ['Terms', 'Dates and name']],
      ['/dev/school?page=year&open=terms', 'Terms', ['Breaks and days off']],
      ['/dev/school?page=year&open=followers', 'Who follows it', ['Terms']],
      ['/dev/school?page=year&open=dates', 'Dates and name', ['Who follows it', 'Archive']],
      ['/dev/tags?open=Kitchen', 'Edit Kitchen', ['Edit Morning', 'Add a tag', 'Archived']],
      ['/dev/tags?open=archived', 'Archived', ['Add a tag']],
      ['/dev/reminders?open=when', 'When to remind me', ['My devices']],
      ['/dev/reminders?open=devices', 'My devices', ['When to remind me']],
    ] as const) {
      await test.step(url, async () => {
        await open(page, url);
        await expect(foldOf(page, opened)).toHaveAttribute('open', '');
        await folded(page, [...closed]);
      });
    }
  });

  test('[NFR-18-v] with none yet, Add a tag and Add a school year are open; Home’s Add a day off is an inner fold', async ({
    page,
  }) => {
    await open(page, '/dev/tags?state=empty');
    await expect(foldOf(page, 'Add a tag')).toHaveAttribute('open', '');
    await open(page, '/dev/school?state=empty');
    await expect(foldOf(page, 'Add a school year')).toHaveAttribute('open', '');
    await open(page, '/dev/home');
    const dayOff = foldOf(page, 'Add a day off');
    await expect(dayOff).toHaveClass(/fw-fold--inner/);
    await expect(dayOff).not.toHaveAttribute('open');
    await unfold(dayOff);
    await expect(page.getByRole('form', { name: 'Add a day off' })).toBeVisible();
  });
});
