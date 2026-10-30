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
  // [NFR-18] WP-97: Today just after a part's last item was marked done (D-145), Insights back from
  // a rebuild with History open.
  ['admin-today-changed', '/dev/admin?changed=1'],
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
  ['insights-rebuilt', '/dev/insights?history=rebuilt'],
  // [MEAL-18][MEAL-23][MEAL-24] WP-104's Groceries, as the smart grocery list mockup draws it (D-138):
  // busy, an item's ⋯, adding with the suggestion, moving several, categories and stores, empty.
  ['groceries', '/dev/groceries'],
  ['groceries-menu', '/dev/groceries?menu=Onions'],
  ['groceries-adding', '/dev/groceries?typed=greek%20yog'],
  ['groceries-select', '/dev/groceries?select=1&sel=Apples,Avocados,Bananas&panel=move'],
  ['groceries-places', '/dev/groceries?store=Costco&open=places'],
  ['groceries-got', '/dev/groceries?open=got'],
  ['groceries-empty', '/dev/groceries?state=empty'],
  // [MEAL-19] WP-105's week into groceries.
  ['meals-groceries', '/dev/meals?groceries=1'],
  // [MEAL-07][MEAL-25] WP-105's meal form: its ingredients and recipe.
  ['meals-recipe', '/dev/meals?page=library&edit=Tacos'],
  // [CHR-21][CHR-22][CHR-23][NFR-18] WP-96's Chores in four sections, as its mockup draws them
  // (D-132): busy, Maya chosen, More filters, a ⋯ menu, Duplicate's form, Do again's date step and
  // after it, Show older, empty; an item's page; the Meal library's and Tags' ⋯ rows.
  ['chores', '/dev/chores'],
  ['chores-maya', '/dev/chores?who=Maya'],
  ['chores-more', '/dev/chores?open=more'],
  ['chores-more-set', '/dev/chores?tag=Kitchen'],
  ['chores-menu', '/dev/chores?menu=Wash%20the%20car'],
  ['chores-menu-completed', '/dev/chores?open=completed&menu=Clean%20out%20the%20garage'],
  ['chores-menu-archived', '/dev/chores?open=archived&menu=Recorder%20practice'],
  ['chores-copy', '/dev/chores?page=copy'],
  ['chores-again', '/dev/chores?open=completed&again=Clean%20out%20the%20garage'],
  ['chores-again-added', '/dev/chores?banner=again'],
  ['chores-older', '/dev/chores?state=older&open=completed'],
  ['chores-empty', '/dev/chores?state=empty'],
  ['chores-filtered-empty', '/dev/chores?who=Alex&kind=chore'],
  ['chores-item', '/dev/chores?page=item'],
  ['chores-item-open', '/dev/chores?page=item&open=coming-up'],
  ['meals-library-menu', '/dev/meals?page=library&menu=Spaghetti'],
  ['tags-menu', '/dev/tags?menu=Kitchen'],
  // [MEAL-27][MEAL-28] WP-112's Groceries on Home and the preferred store, as its mockup draws them
  // (D-142): Home busy, typing something had before, something new, something on the list already,
  // after Add, and with nothing on the list; New items go to; Groceries' add field with the
  // preferred store picked.
  ['home', '/dev/home'],
  ['home-typing', '/dev/home?typed=2%20lb%20ground%20beef'],
  ['home-preferred', '/dev/home?typed=olive%20oil'],
  ['home-merge', '/dev/home?typed=1%20onion'],
  ['home-added', '/dev/home?groceries=added'],
  ['home-empty', '/dev/home?groceries=empty'],
  ['groceries-stores', '/dev/groceries?preferred=Costco&open=places'],
  ['groceries-preferred', '/dev/groceries?preferred=Costco&typed=olive%20oil'],
  // [NFR-18] WP-95's Rewards, Members and a member's page folded, as the fold audit draws them; then
  // opened as a save leaves them: Bonus points with Archived bonuses, the shop's Archived, Points.
  ['rewards-open', '/dev/rewards?bonus=archive&archived=1'],
  ['members', '/dev/members'],
  ['members-archived', '/dev/members?archived=1'],
  ['member', '/dev/members?page=member'],
  ['member-points', '/dev/members?page=member&adjusted=5'],
  // [RWD-21] WP-114's goal Some items, as its mockup's four scenes draw them (D-146): a new goal for
  // Leo, a done and an archived item kept, changed to Maya, and a goal ending Oct 29.
  ['goal-items-new', '/dev/goals?form=items-new'],
  ['goal-items', '/dev/goals?form=items'],
  ['goal-items-maya', '/dev/goals?form=items-maya'],
  ['goal-items-dates', '/dev/goals?form=items-dates'],
  // [PTS-08] WP-115's points register, as its mockup's scenes draw it (D-147): everyone, one bonus's
  // payouts, Maya's By hand and Spent in October; and Rewards with its Points card and payouts.
  ['points-register', '/dev/rewards/points'],
  ['points-register-bonus', '/dev/rewards/points?rule=f3000000-0000-4000-8000-000000000001'],
  [
    'points-register-filters',
    '/dev/rewards/points?who=f1000000-0000-4000-8000-000000000001&type=adjustment,spend&from=2026-10-01&to=2026-10-31',
  ],
  ['rewards-bonus-open', '/dev/rewards?bonus=archive'],
  // [MEAL-29] WP-116's grocery brands, as its mockup draws them (D-148): the list with brands, typing
  // a brand, last time's brand, a new brand, an item's ⋯ and Brand…, Select's Brand…, Brands and a
  // merge; Home last time's brand, typing a brand, and after Add.
  ['brands-list', '/dev/groceries'],
  ['brands-typing', '/dev/groceries?typed=milk&brand=kirk'],
  ['brands-prefill', '/dev/groceries?typed=coffee'],
  ['brands-new', '/dev/groceries?typed=sparkling%20water&brand=La%20Croix'],
  ['brands-menu', '/dev/groceries?menu=Milk'],
  ['brands-brandof', '/dev/groceries?brandOf=Milk'],
  ['brands-select', '/dev/groceries?select=1&sel=Apples,Bananas&panel=brand'],
  ['brands-places', '/dev/groceries?open=places'],
  ['brands-merge', '/dev/groceries?merge=Kirkland%20Signature'],
  ['brands-home-prefill', '/dev/home?typed=coffee'],
  ['brands-home-typing', '/dev/home?typed=yogurt&brand=fair'],
  ['brands-home-added', '/dev/home?groceries=added-brand'],
  // [MEAL-22][MEAL-30] WP-107: Groceries with Asked for and each child's OK, Got recently with a
  // board's tick, and Home's Needs you line.
  ['asks-groceries', '/dev/groceries'],
  ['asks-got', '/dev/groceries?open=got'],
  ['asks-home', '/dev/home?asks=1'],
  // [MEAL-21] WP-106's staples: Running low?, after Add, Staples open, nothing due, Home's line.
  ['staples-low', '/dev/groceries'],
  ['staples-added', '/dev/groceries?staple=added'],
  ['staples-list', '/dev/groceries?open=staples'],
  ['staples-none', '/dev/groceries?state=empty'],
  ['staples-home', '/dev/home'],
];
/**
 * [name, query, person, whole, then] per board screen: Maya's goal cards; with `whole`, a screen of
 * the rail drawn as the board shows it (WP-104's Groceries), after a tap on `then` if given (WP-105).
 * [MEAL-22] `then` may be a list of taps (WP-107): the first on the screen, the rest in the dialog it
 * opens (a single letter is a key of the board's keyboard); the picture waits for the dialog, or for
 * the bar when the last tap closed it.
 */
export const BOARD = [
  ['board-going', '?repeating=going', 'Maya'],
  ['board-missed', '?repeating=missed', 'Maya'],
  ['board-won', '?repeating=won', 'Maya'],
  ['board-steps', '?steps=going', 'Maya'],
  ['board-weighted', '?steps=weighted', 'Maya'],
  ['board-family', '?perfect=missed', 'Maya'],
  ['board-groceries', '?groceries=1', 'Groceries', 'whole'],
  // [MEAL-29] WP-116: the same board screen shows each thing's brand (board-groceries above).
  ['board-groceries-empty', '?groceries=empty', 'Groceries', 'whole'],
  // [MEAL-26] WP-105's recipe on the board: Meals, then a tap on Tacos.
  ['board-recipe', '?x=1', 'Meals', 'whole', 'Tacos: open the recipe'],
  // [MEAL-22][MEAL-30] WP-107: asking (who and what, a brand, typed, 5 waiting), a thing's sheet as an
  // adult and as a child, and the Undo bar after taking a thing off.
  ['board-ask', '?groceries=1', 'Groceries', 'whole', ['Ask for something', 'Maya']],
  [
    'board-ask-brand',
    '?groceries=1',
    'Groceries',
    'whole',
    ['Ask for something', 'Maya', 'Sourdough'],
  ],
  [
    'board-ask-type',
    '?groceries=1',
    'Groceries',
    'whole',
    ['Ask for something', 'Maya', 'Something else', 'Y', 'O', 'G'],
  ],
  ['board-ask-full', '?groceries=full', 'Groceries', 'whole', ['Ask for something', 'Maya']],
  // A long list (35 things) from the top, and its last thing reached and opened.
  ['board-groceries-long', '?groceries=long', 'Groceries', 'whole'],
  ['board-groceries-long-end', '?groceries=long', 'Groceries', 'whole', ['Trash bags']],
  ['board-sheet', '?groceries=1', 'Groceries', 'whole', ['Paper towels', 'Sam']],
  ['board-sheet-child', '?groceries=1', 'Groceries', 'whole', ['Paper towels', 'Leo']],
  [
    'board-undo',
    '?groceries=1',
    'Groceries',
    'whole',
    ['Paper towels', 'Sam', 'Take it off the list'],
  ],
];

const only = arg('only', '');
const wanted = (name) => !only || only.split(',').some((o) => name.startsWith(o));

async function shoot(context, url, file, person, whole = false, then = null) {
  const page = await context.newPage();
  await page.clock.setFixedTime(THURSDAY);
  await page.goto(url);
  // The page is ready once React has hydrated it (D-110) and its fonts have loaded.
  await page.locator('html[data-hydrated]').waitFor();
  // [D-128] A goal form shows its live summaries once they are worked out (WP-101).
  await page.waitForFunction(() => !document.querySelector('form[data-live="waiting"]'));
  if (person) {
    // [MEAL-22] Groceries' rail button also says how many asks wait (WP-107).
    await page
      .getByRole('list', { name: 'Family', exact: true })
      .getByRole(
        'button',
        person === 'Groceries' ? { name: /^Groceries/ } : { name: person, exact: true },
      )
      .click();
    await page.getByRole('heading', { name: person, level: 2 }).first().waitFor();
    const taps = then ? [then].flat() : [];
    for (const [i, name] of taps.entries()) {
      const within = i === 0 ? page : page.getByRole('dialog');
      await within
        .getByRole('button', { name, exact: name.length === 1 })
        .first()
        .click();
    }
    if (taps.length) {
      await page.locator('[role="dialog"], .fw-bgroc__bar').first().waitFor();
    }
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
    // No service worker: the pictures are of the pages, and under one WebKit's navigations can
    // fail ("WebKit encountered an internal error", WP-113).
    const context = await browser.newContext({
      ...(engine === chromium ? { ...options, isMobile: false, hasTouch: false } : options),
      serviceWorkers: 'block',
    });
    for (const [name, path] of ADMIN.filter(([name]) => wanted(name))) {
      const url = `${base}${path}${path.includes('?') ? '&' : '?'}theme=${theme}`;
      await shoot(context, url, `${out}/${name}-${shape}-${theme}.png`);
      n += 1;
    }
    await context.close();
  }
  const board = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: 'block',
  });
  for (const [name, query, person, whole, then] of BOARD.filter(([name]) => wanted(name))) {
    const url = `${base}/dev/board${query}&theme=${theme}`;
    await shoot(board, url, `${out}/${name}-${theme}.png`, person, whole === 'whole', then);
    n += 1;
  }
  await board.close();
}
await browser.close();
console.log(`${n} screenshots in ${out} (${engine.name()})`);
