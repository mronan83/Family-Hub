// [NFR-16][D-127] Screenshots of the made-up family's screens for a side-by-side with their mockups
// (WP-100): the admin app as an iPhone (390 px, WebKit, Safari's engine) and a laptop (1280 px), the
// board at 1920 px, in Day and Evening. CI's build job runs it with WebKit after the UI suite and
// keeps the pictures as the `screen-shots` artifact; locally, BROWSER=chromium runs it with the
// container's Chromium. It reads /dev pages only: no database, no sign-in, no real family's data.
//
//   node scripts/screen-shots.mjs [--base=http://localhost:3100] [--out=test-results/screens]
import { mkdir } from 'node:fs/promises';
import { chromium, devices, webkit } from '@playwright/test';

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const base = arg('base', 'http://localhost:3100');
const out = arg('out', 'test-results/screens');
const engine = process.env.BROWSER === 'chromium' ? chromium : webkit;
const executablePath = process.env.CHROMIUM_PATH;

/** Thursday, Oct 15, 2026, 11 am in the family's zone: the board's goal cards are drawn for it. */
const THURSDAY = new Date('2026-10-15T15:00:00Z');

/** [name, path] per admin screen: the goal screens of the WP-80 to WP-82 mockups, then the rest. */
export const ADMIN = [
  ['goals', '/dev/goals'],
  ['goals-steps', '/dev/goals?list=steps'],
  ['goals-perfect', '/dev/goals?list=perfect'],
  ['goal-new', '/dev/goals?form=new'],
  ['goal-homework', '/dev/goals?form=homework'],
  ['goal-repeating', '/dev/goals?form=repeating&open=weeks'],
  ['goal-steps', '/dev/goals?form=steps'],
  ['goal-count-steps', '/dev/goals?form=count-steps'],
  ['goal-weighted', '/dev/goals?form=weighted'],
  ['goal-family', '/dev/goals?form=family'],
  ['goal-perfect', '/dev/goals?form=perfect'],
  ['goal-family-weeks', '/dev/goals?form=family-weeks'],
  ['admin-home', '/dev/admin'],
  ['admin-today', '/dev/admin?view=today'],
  ['admin-my', '/dev/admin?view=my'],
  ['forms', '/dev/forms'],
  ['family', '/dev/family'],
  ['rewards', '/dev/rewards'],
  ['meals', '/dev/meals'],
  ['meals-library', '/dev/meals?page=library'],
  // [NFR-18] WP-93's folds opened: Archived, a menu, a calendar (the fold audit's open frames).
  ['meals-library-archived', '/dev/meals?page=library&open=archived'],
  ['menus', '/dev/menus'],
  ['menus-open', '/dev/menus?open=1'],
  ['calendars', '/dev/calendars'],
  ['calendars-open', '/dev/calendars?open=1'],
  ['boards', '/dev/boards'],
  ['reminders', '/dev/reminders'],
  // [NFR-18] WP-94's set-up pages, as the fold audit draws them: a failed weather read, a removed
  // device and a failing job on their folded headers.
  ['family-folded', '/dev/family?weather=failing&state=pending'],
  ['school', '/dev/school'],
  ['school-year', '/dev/school?page=year'],
  ['tags', '/dev/tags'],
  ['reminders-removed', '/dev/reminders?error=gone'],
  ['health', '/dev/health'],
  ['settings', '/dev/settings'],
  ['insights', '/dev/insights'],
  // [MEAL-18][MEAL-23][MEAL-24] WP-104's Groceries, as the smart grocery list mockup draws it (D-138):
  // busy, an item's ⋯, adding with the suggestion, moving several, categories and stores, empty.
  ['groceries', '/dev/groceries'],
  ['groceries-menu', '/dev/groceries?menu=Onions'],
  ['groceries-adding', '/dev/groceries?typed=greek%20yog'],
  ['groceries-select', '/dev/groceries?select=1&sel=Apples,Avocados,Bananas&panel=move'],
  ['groceries-places', '/dev/groceries?store=Costco&open=places'],
  ['groceries-got', '/dev/groceries?open=got'],
  ['groceries-empty', '/dev/groceries?state=empty'],
];
/**
 * [name, query, person, whole] per board screen: Maya's goal cards; with `whole`, a screen of the
 * rail drawn as the board shows it (WP-104's Groceries).
 */
export const BOARD = [
  ['board-going', '?repeating=going', 'Maya'],
  ['board-missed', '?repeating=missed', 'Maya'],
  ['board-won', '?repeating=won', 'Maya'],
  ['board-steps', '?steps=going', 'Maya'],
  ['board-weighted', '?steps=weighted', 'Maya'],
  ['board-family', '?perfect=missed', 'Maya'],
  ['board-groceries', '?groceries=1', 'Groceries', 'whole'],
  ['board-groceries-empty', '?groceries=empty', 'Groceries', 'whole'],
];

const only = arg('only', '');
const wanted = (name) => !only || only.split(',').some((o) => name.startsWith(o));

async function shoot(context, url, file, person, whole = false) {
  const page = await context.newPage();
  await page.clock.setFixedTime(THURSDAY);
  await page.goto(url);
  // The page is ready once React has hydrated it (D-110) and its fonts have loaded.
  await page.locator('html[data-hydrated]').waitFor();
  // [D-128] A goal form shows its live summaries once they are worked out (WP-101).
  await page.waitForFunction(() => !document.querySelector('form[data-live="waiting"]'));
  if (person) {
    await page
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole('button', { name: person, exact: true })
      .click();
    await page.getByRole('heading', { name: person, level: 2 }).waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  if (person && whole) {
    await page.screenshot({ path: file });
  } else if (person) {
    // The board is one screen that scrolls inside; the goal cards are its Goals section, drawn
    // whole by letting the parts around it grow.
    const goals = page.getByRole('region', { name: 'Goals' });
    await goals.evaluate((el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        n.style.overflow = 'visible';
        n.style.maxHeight = 'none';
        n.style.height = 'auto';
      }
    });
    await goals.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
  await page.close();
}

const browser = await engine.launch(
  executablePath && engine === chromium ? { executablePath } : {},
);
await mkdir(out, { recursive: true });
const shapes = [
  ['iphone', { ...devices['iPhone 13'], deviceScaleFactor: 2 }],
  ['laptop', { viewport: { width: 1280, height: 800 } }],
];
let n = 0;
for (const theme of ['day', 'evening']) {
  for (const [shape, options] of shapes) {
    const context = await browser.newContext(
      engine === chromium ? { ...options, isMobile: false, hasTouch: false } : options,
    );
    for (const [name, path] of ADMIN.filter(([name]) => wanted(name))) {
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}theme=${theme}`;
      await shoot(context, url, `${out}/${name}-${shape}-${theme}.png`);
      n += 1;
    }
    await context.close();
  }
  const board = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  for (const [name, query, person, whole] of BOARD.filter(([name]) => wanted(name))) {
    const url = `${base}/dev/board${query}&theme=${theme}`;
    await shoot(board, url, `${out}/${name}-${theme}.png`, person, whole === 'whole');
    n += 1;
  }
  await board.close();
}
await browser.close();
console.log(`${n} screenshots in ${out} (${engine.name()})`);
