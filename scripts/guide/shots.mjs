#!/usr/bin/env node
// Screenshots for the user guide (docs/07-user-guide.md). Every picture comes from a dev page that
// renders the made-up demo family with no database (apps/web/app/dev/*), so no real data can reach
// the guide. The board is shot at its logical 1920×1080 and saved 1280 px wide; the admin app on a
// phone (390 px) or a laptop (1280 px). The board's clock is held on a school-day afternoon so its
// pictures don't change with the day they are taken.
//
//   pnpm build
//   (cd apps/web && npx next start -p 3200)      # in another terminal
//   pnpm guide:shots                              # or: pnpm guide:shots --base=http://localhost:3200
//   fuser -k 3200/tcp
//
// Options: --base=URL (default http://localhost:3200), --only=name1,name2 (retake some).
// CHROMIUM_PATH picks the browser; /opt/pw-browsers/chromium is used when it exists.
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(root, 'docs/guide/img');
const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const base = (arg('base') ?? process.env.GUIDE_BASE_URL ?? 'http://localhost:3200').replace(
  /\/$/,
  '',
);
const only = arg('only')?.split(',') ?? null;

/** Wednesday, Oct 14, 4:20 pm in New York, the made-up family's timezone. */
const BOARD_TIME = new Date('2026-10-14T20:20:00Z');
/** Each picture should stay under this; the whole set under TOTAL_LIMIT. */
const SHOT_LIMIT = 120 * 1024;
const TOTAL_LIMIT = 3 * 1024 * 1024;

const DEVICES = {
  // The board's logical layout, drawn at 2/3 scale: a 1280×720 picture.
  board: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 / 3 },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1.5,
    isMobile: true,
    hasTouch: true,
  },
  laptop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

const person = (page, name) => page.locator('.fw-today__people button', { hasText: name }).first();
const tap = (page, label) => page.getByRole('button', { name: label, exact: true }).first();

/**
 * The pictures: a name (the file), a dev page, a device, and optionally what to do first (`act`), a
 * scroll position, a height to cut the page at (`maxHeight`, CSS px), or one element to shoot.
 */
const SHOTS = [
  // The board ----------------------------------------------------------------------------------
  { name: 'board-home', device: 'board', url: '/dev/board' },
  {
    // The cards in another order (Waiting for a parent first), with something waiting: Maya asks
    // for a reward and checks off Homework, which needs a parent. Since WP-48 the cards are on the
    // first screen, so this is the whole home screen.
    name: 'board-home-cards',
    device: 'board',
    url: '/dev/board?cards=waiting,coming,goals',
    act: async (page) => {
      await person(page, 'Maya').click();
      await page.locator('.fw-today__card-head button', { hasText: 'Shop' }).click();
      await tap(page, 'Ask for this: Stay up 30 minutes late').click();
      await tap(page, 'Yes, ask').click();
      await person(page, 'Home').click();
      await tap(page, 'Check off Homework for Maya').click();
    },
    wait: 1600,
  },
  { name: 'board-home-month', device: 'board', url: '/dev/board?span=month' },
  { name: 'board-home-evening', device: 'board', url: '/dev/board?theme=evening&span=3' },
  // [BRD-08] Largest text on a 1080p screen (WP-47): the list goes under the calendar.
  { name: 'board-home-largest', device: 'board', url: '/dev/board?text=largest' },
  // The weather beside the clock (WP-45), from the dev board's made-up rainy reading.
  {
    name: 'board-weather',
    device: 'board',
    url: '/dev/board?weather=rain',
    clip: { x: 960, y: 0, width: 960, height: 130 },
  },
  {
    name: 'board-more-info',
    device: 'board',
    url: '/dev/board',
    act: (page) => tap(page, 'More info about Homework').click(),
  },
  {
    name: 'board-person',
    device: 'board',
    url: '/dev/board',
    act: (page) => person(page, 'Maya').click(),
  },
  {
    name: 'board-undo',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Leo').click();
      await tap(page, 'Check off Make bed').click();
      await page.waitForTimeout(1600);
      await tap(page, 'Undo Make bed').click();
    },
  },
  {
    name: 'board-chores',
    device: 'board',
    url: '/dev/board',
    act: (page) => person(page, 'Chores').click(),
  },
  {
    name: 'board-who-did-it',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Chores').click();
      await tap(page, 'Check off Feed the dog').click();
    },
  },
  {
    name: 'board-calendar-week',
    device: 'board',
    url: '/dev/board?allday=1',
    act: (page) => person(page, 'Calendar').click(),
  },
  // The time grid (WP-52): a day with two events at once, and an event in full.
  {
    name: 'board-calendar-day',
    device: 'board',
    url: '/dev/board?allday=1',
    act: async (page) => {
      await person(page, 'Calendar').click();
      await page.locator('.fw-bcal__view', { hasText: 'Day' }).click();
      await page.getByRole('button', { name: 'Next day' }).click();
    },
  },
  {
    name: 'board-event-details',
    device: 'board',
    url: '/dev/board?allday=1',
    act: async (page) => {
      await person(page, 'Calendar').click();
      await page.locator('.fw-bcal__view', { hasText: 'Day' }).click();
      await page.getByRole('button', { name: 'Next day' }).click();
      await page.locator('.fw-tgrid__event', { hasText: 'Dentist' }).click();
    },
  },
  // [CAL-09] A calendar for two people (WP-50): School is Maya's and Leo's, both faces in full.
  {
    name: 'board-event-people',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Calendar').click();
      await page.locator('.fw-tgrid__bar', { hasText: 'Spelling test' }).click();
    },
  },
  {
    name: 'board-calendar-month',
    device: 'board',
    url: '/dev/board?busy=1',
    act: async (page) => {
      await person(page, 'Calendar').click();
      await page.locator('.fw-bcal__view', { hasText: 'Month' }).click();
    },
  },
  {
    name: 'board-meals-week',
    device: 'board',
    url: '/dev/board',
    act: (page) => person(page, 'Meals').click(),
  },
  // [MEAL-26] A meal's recipe on the board, full screen (WP-105): a tap on Tacos on Meals.
  {
    name: 'board-recipe',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Meals').click();
      await page.getByRole('button', { name: 'Tacos: open the recipe' }).click();
      await page.getByRole('dialog').waitFor();
    },
  },
  // [MEAL-18][MEAL-23] The grocery list on the board (WP-104), by category, with the store chips.
  {
    name: 'board-groceries',
    device: 'board',
    url: '/dev/board?groceries=1',
    act: (page) => person(page, 'Groceries').click(),
  },
  // [MEAL-22][MEAL-30] WP-107: asking (Maya picked, the tiles), and a thing's sheet as Leo.
  {
    name: 'board-ask',
    device: 'board',
    url: '/dev/board?groceries=1',
    act: async (page) => {
      await person(page, 'Groceries').click();
      await tap(page, 'Ask for something').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Maya', exact: true }).click();
    },
  },
  {
    name: 'board-groceries-sheet',
    device: 'board',
    url: '/dev/board?groceries=1',
    act: async (page) => {
      await person(page, 'Groceries').click();
      await page.getByRole('button', { name: /^Paper towels/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Leo', exact: true }).click();
    },
  },
  // [MENU-06] The school menu by section (WP-64): a buy day's whole menu at a tap, and the week's
  // menu a row a section under School lunch.
  {
    name: 'board-lunch-menu',
    device: 'board',
    url: '/dev/board',
    act: (page) => tap(page, 'Show Leo’s whole lunch menu').click(),
  },
  // [MEAL-09][MEAL-11] Lunches (WP-49): Leo's coming week from his item, and a day's choices.
  {
    name: 'board-lunches-week',
    device: 'board',
    url: '/dev/board?lunches=1',
    act: async (page) => {
      await tap(page, 'Open Pick next week’s lunches for Leo').click();
      await tap(page, 'Next week').click();
      await page.locator('.fw-lunches__day').nth(4).waitFor();
    },
  },
  {
    name: 'board-lunches-choices',
    device: 'board',
    url: '/dev/board?lunches=1',
    act: async (page) => {
      await tap(page, 'Open Pick next week’s lunches for Leo').click();
      await tap(page, 'Next week').click();
      await tap(page, 'Pick your lunch').click();
      await tap(page, 'Chicken wrap with Tortilla chips').click();
      await tap(page, 'Apple slices').click();
      await tap(page, 'Grapes').click();
    },
  },
  {
    name: 'board-meals-menu',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Meals').click();
      await page.locator('.fw-mweek__wrap').evaluate((el) => (el.scrollTop = el.scrollHeight));
    },
  },
  {
    name: 'board-shop',
    device: 'board',
    url: '/dev/board',
    act: async (page) => {
      await person(page, 'Maya').click();
      await page.locator('.fw-today__card-head button', { hasText: 'Shop' }).click();
      await tap(page, 'Ask for this: Stay up 30 minutes late').click();
    },
  },
  { name: 'board-celebrate', device: 'board', url: '/dev/board?celebrate=1', wait: 1800 },
  {
    name: 'board-offline',
    device: 'board',
    url: '/dev/board',
    act: async (page, context) => {
      await person(page, 'Leo').click();
      await context.setOffline(true);
      await tap(page, 'Check off Set the table').click();
      await page.waitForTimeout(2200);
    },
  },
  {
    name: 'board-stale',
    device: 'board',
    url: '/dev/board?stale=1',
    clip: { x: 0, y: 0, width: 1920, height: 210 },
  },
  {
    name: 'tile-states',
    device: 'board',
    url: '/dev/brand?surface=board',
    element: '[data-testid="tiles-day"]',
  },

  // The admin app -------------------------------------------------------------------------------
  // The menu and Settings (WP-51): Settings on a laptop with the menu beside it, the menu on a phone.
  { name: 'admin-settings-laptop', device: 'laptop', url: '/dev/settings' },
  // [DEV-07] A board's Sleep and wake on Boards (WP-34): Kitchen's, open, as in the mockup.
  {
    name: 'admin-boards-sleep-laptop',
    device: 'laptop',
    url: '/dev/boards?open=kitchen',
    // Kitchen opened (WP-91), down to Save sleep and wake: the page whole is over 120 KB.
    maxHeight: 1080,
  },
  // [D-118] Boards folded (WP-91): every board to its facts, Playroom's not-seen warning.
  { name: 'admin-boards-phone', device: 'phone', url: '/dev/boards', full: true },
  // Home at a glance and Family options (WP-57): what needs you and the quick actions; a quiet day
  // with today's snow day on a phone; Family options folded, the week's start day with a change
  // waiting (WP-94).
  { name: 'admin-home-laptop', device: 'laptop', url: '/dev/home', full: true },
  {
    name: 'admin-home-phone',
    device: 'phone',
    url: '/dev/home?state=quiet&school=off',
    full: true,
  },
  {
    name: 'admin-family-phone',
    device: 'phone',
    url: '/dev/family?state=pending',
    maxHeight: 1400,
  },
  {
    name: 'admin-menu-phone',
    device: 'phone',
    url: '/dev/settings',
    act: (page) => page.getByRole('button', { name: /^Menu/ }).click(),
  },
  // [NFR-18] Today folded (WP-97): taller with After school, so more compressed to stay under 120 KB.
  { name: 'admin-today-laptop', device: 'laptop', url: '/dev/admin', full: true, quality: 52 },
  { name: 'admin-not-done-phone', device: 'phone', url: '/dev/admin?notice=1', maxHeight: 1300 },
  { name: 'admin-my-tasks-phone', device: 'phone', url: '/dev/admin?view=my', full: true },
  // [NFR-18] My devices open, as after a device's action; When to remind me folded (WP-94).
  {
    name: 'admin-reminders-phone',
    device: 'phone',
    url: '/dev/reminders?open=devices',
    maxHeight: 1500,
  },
  {
    name: 'admin-rewards-laptop',
    device: 'laptop',
    url: '/dev/rewards',
    full: true,
    quality: 64,
  },
  // [PTS-08] The points register (WP-115): its filters and the first two days.
  {
    name: 'admin-points-register-phone',
    device: 'phone',
    url: '/dev/rewards/points',
    maxHeight: 1400,
  },
  { name: 'admin-goals-laptop', device: 'laptop', url: '/dev/goals', maxHeight: 1430 },
  {
    name: 'admin-goal-form-phone',
    device: 'phone',
    url: '/dev/goals?form=new',
    full: true,
    // Taller since the icon picker (WP-46) and what a goal pays (WP-39), so more compressed to stay
    // under 120 KB.
    quality: 48,
  },
  // [NFR-16][D-128] The goal form's rule with its live summary, and two weighted rules folded to
  // their lines (WP-101), once the summaries are back.
  {
    name: 'admin-goal-summary-phone',
    device: 'phone',
    url: '/dev/goals?form=homework',
    element: 'fieldset.fw-goal-rule',
    act: async (page) => {
      await page.locator('form[data-live="ready"]').waitFor();
    },
  },
  // [RWD-21][D-146] A goal's Some items for its person, with a done and an archived item kept (WP-114).
  {
    name: 'admin-goal-items-phone',
    device: 'phone',
    url: '/dev/goals?form=items',
    element: 'fieldset.fw-goal-rule',
  },
  {
    name: 'admin-goal-rules-phone',
    device: 'phone',
    url: '/dev/goals?form=weighted',
    element: '.fw-form',
    quality: 50,
    act: async (page) => {
      await page.locator('form[data-live="ready"]').waitFor();
      // Only the rules and the weights' line: the rest of the form folded away for the picture.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('.fw-form > *')) {
          const keep =
            el.matches('fieldset.fw-goal-rule, [data-testid="weights-summary"]') ||
            el.querySelector('[data-testid="weights-total"]');
          if (!keep && !el.matches('[data-testid="weights-total"]')) el.style.display = 'none';
        }
      });
    },
  },
  // [RWD-14] A started goal's end date (WP-79): Ends on a date ticked, the date and Clear.
  {
    name: 'admin-goal-end-date-phone',
    device: 'phone',
    url: '/dev/goals?form=started',
    // The Ends field (its own box since WP-100 put Starts and Ends in the form's grid).
    element: '.fw-end-date',
  },
  // [RWD-15][RWD-16] A repeating goal (WP-80): Maya's card on Goals, and her week on the board.
  {
    name: 'admin-goal-repeating-phone',
    device: 'phone',
    url: '/dev/goals',
    element: '.fw-goal:has(.fw-days) >> nth=0',
  },
  {
    name: 'admin-goal-weeks-phone',
    device: 'phone',
    url: '/dev/goals?form=repeating',
    act: async (page) => {
      await page.locator('summary', { hasText: 'Weeks' }).click();
    },
    element: 'details:has(#goal-weeks-heading)',
  },
  // [RWD-19][RWD-20] An every-child goal and perfect weeks on Goals, and the family card on the board
  // (WP-82).
  {
    name: 'admin-goal-every-child-phone',
    device: 'phone',
    url: '/dev/goals?list=perfect',
    element: '.fw-goals > li:first-child',
  },
  {
    name: 'board-goal-every-child',
    device: 'board',
    url: '/dev/board?perfect=missed',
    act: async (page) => {
      await person(page, 'Maya').click();
    },
    element: '[data-goal="g-everyone"]',
  },
  {
    name: 'board-goal-perfect-weeks',
    device: 'board',
    url: '/dev/board?perfect=going',
    act: async (page) => {
      await person(page, 'Maya').click();
    },
    element: '[data-goal="g-perfect"]',
  },
  // [RWD-18] Pay in steps in the form, and a goal in steps on the board (WP-81).
  {
    name: 'admin-goal-steps-phone',
    device: 'phone',
    url: '/dev/goals?form=steps',
    element: '.fw-goal-steps',
  },
  {
    name: 'board-goal-steps',
    device: 'board',
    url: '/dev/board?steps=going',
    act: async (page) => {
      await person(page, 'Maya').click();
    },
    element: '[data-goal="g-steps"]',
  },
  {
    name: 'board-goal-repeating',
    device: 'board',
    url: '/dev/board?repeating=missed',
    act: async (page) => {
      await person(page, 'Maya').click();
    },
    element: '[data-goal="g-homework"]',
  },
  // The preview of a change (WP-39): the panel itself, under the form.
  {
    name: 'admin-goal-preview-phone',
    device: 'phone',
    url: '/dev/goals?form=preview',
    element: '.fw-goal-preview',
  },
  // [CHR-21][CHR-23][NFR-18] Chores in four sections (WP-96): the page on a phone, an item's ⋯ on a
  // laptop, Do again's date step, and an item's page folded.
  { name: 'admin-chores-phone', device: 'phone', url: '/dev/chores', maxHeight: 1500, quality: 62 },
  {
    name: 'admin-chores-menu-laptop',
    device: 'laptop',
    url: '/dev/chores?menu=Wash%20the%20car',
    maxHeight: 1100,
  },
  {
    name: 'admin-chores-again-phone',
    device: 'phone',
    url: '/dev/chores?again=Clean%20out%20the%20garage',
    element: '.fw-sheet__box',
  },
  {
    name: 'admin-chores-item-phone',
    device: 'phone',
    url: '/dev/chores?page=item',
    maxHeight: 1500,
  },
  // Meals (WP-25): the week on a laptop, and the library on a phone.
  // [MEAL-14] The days folded, today opened (WP-75).
  {
    name: 'admin-meals-laptop',
    device: 'laptop',
    url: '/dev/meals?open=2026-10-14',
    maxHeight: 1900,
    quality: 62,
  },
  // [MEAL-15] A planned dinner opened with Edit, in place (WP-76).
  {
    name: 'admin-meal-edit-phone',
    device: 'phone',
    url: '/dev/meals?edit=f2e10000-0000-4000-8000-000000000010',
    element: '#entry-f2e10000-0000-4000-8000-000000000010',
  },
  // School lunch (WP-26) as a list of days (WP-74): on a phone, Leo's week with today opened.
  {
    name: 'admin-lunch-phone',
    device: 'phone',
    url: '/dev/meals',
    element: '#lunch',
    // The whole section, the usual weeks too, kept under 120 KB.
    quality: 48,
    act: (page) => page.locator('#lunch .fw-lunchday[data-today]:visible summary').click(),
  },
  // [MEAL-11] On a laptop, with a child's picks (WP-49), today opened.
  {
    name: 'admin-lunch-laptop',
    device: 'laptop',
    url: '/dev/meals?lunches=1',
    element: '#lunch',
    act: (page) => page.locator('#lunch .fw-lunchday[data-today]:visible summary').click(),
  },
  // [MEAL-09] The children's lunch changes waiting on Today (WP-49), on a laptop and a phone.
  {
    name: 'admin-lunch-changes-laptop',
    device: 'laptop',
    url: '/dev/admin?lunches=1',
    element: '.fw-lunchq',
  },
  {
    name: 'admin-lunch-changes-phone',
    device: 'phone',
    url: '/dev/admin?lunches=1',
    element: '.fw-lunchq',
  },
  // School menus (WP-27): the page on a laptop, Maple Elementary opened and the others folded
  // (WP-93), and adding one on a phone with the schools found.
  {
    name: 'admin-menus-laptop',
    device: 'laptop',
    url: '/dev/menus?open=1',
    maxHeight: 1500,
    quality: 62,
  },
  {
    name: 'admin-menu-add-phone',
    device: 'phone',
    url: '/dev/menus?add=1',
    element: 'section[aria-labelledby="add-menu-heading"]',
  },
  {
    name: 'admin-meal-library-phone',
    device: 'phone',
    url: '/dev/meals?page=library',
    maxHeight: 1500,
  },
  // [MEAL-07][MEAL-25] A meal's Recipe and Ingredients in its form (WP-105).
  {
    name: 'admin-meal-recipe-laptop',
    device: 'laptop',
    url: '/dev/meals?page=library&edit=Tacos',
    maxHeight: 1600,
  },
  // [MEAL-19] The week's Add to groceries (WP-105).
  { name: 'admin-meals-groceries-laptop', device: 'laptop', url: '/dev/meals?groceries=1' },
  // [MEAL-18][MEAL-23][MEAL-24] Groceries (WP-104): the list, adding with the suggestion, Select
  // and Move to, and the household's categories and stores.
  // [MEAL-22] Since WP-107, Asked for opens above the list while asks wait.
  { name: 'admin-groceries-phone', device: 'phone', url: '/dev/groceries', maxHeight: 1700 },
  // [MEAL-22] Groceries' Asked for (WP-107), with each child's OK.
  {
    name: 'admin-groceries-asked-phone',
    device: 'phone',
    url: '/dev/groceries',
    element: '#asked',
  },
  {
    name: 'admin-groceries-adding-phone',
    device: 'phone',
    url: '/dev/groceries?typed=greek%20yog',
    maxHeight: 1000,
  },
  {
    name: 'admin-groceries-select-phone',
    device: 'phone',
    url: '/dev/groceries?select=1&sel=Apples,Avocados,Bananas&panel=move',
    maxHeight: 1100,
  },
  {
    name: 'admin-groceries-places-laptop',
    device: 'laptop',
    // [MEAL-28] With Costco under New items go to (WP-112).
    url: '/dev/groceries?open=places&preferred=Costco',
    element: '#places',
  },
  // [MEAL-27][MEAL-28] Groceries on Home (WP-112): typing something new, and after Add; the add
  // field with the preferred store picked.
  {
    name: 'admin-home-groceries-phone',
    device: 'phone',
    url: '/dev/home?typed=olive%20oil',
    element: 'li[aria-labelledby="groceries-quick-heading"]',
  },
  {
    name: 'admin-home-groceries-added-phone',
    device: 'phone',
    url: '/dev/home?groceries=added',
    element: 'li[aria-labelledby="groceries-quick-heading"]',
  },
  {
    name: 'admin-groceries-preferred-phone',
    device: 'phone',
    url: '/dev/groceries?preferred=Costco&typed=olive%20oil',
    maxHeight: 1000,
  },
  // [MEAL-29] A brand typed when adding, its saved brands offered (WP-116).
  {
    name: 'admin-groceries-brand-phone',
    device: 'phone',
    url: '/dev/groceries?typed=milk&brand=kirk',
    maxHeight: 1000,
  },
  { name: 'admin-calendars-phone', device: 'phone', url: '/dev/calendars', maxHeight: 1330 },
  // [CAL-09] Who a calendar is for (WP-50): The whole family, or a tick a person.
  {
    name: 'admin-calendar-who-phone',
    device: 'phone',
    url: '/dev/calendars?open=2',
    element: 'form[aria-label="Edit School"]',
    act: async (page) => {
      await page.locator('summary', { hasText: 'Edit School' }).click();
    },
  },
  {
    name: 'admin-calendar-add-phone',
    device: 'phone',
    url: '/dev/calendars?state=empty',
    full: true,
    // Sixteen colors to choose from (WP-46).
    quality: 66,
    // A made-up link on a reserved domain, so the picture shows a filled-in form.
    act: async (page) => {
      await page.getByLabel('Name', { exact: true }).fill('Family');
      const link = page.getByLabel('Public link');
      await link.fill('webcal://calendar.example.com/family.ics');
      // Unfocused and scrolled back, so the link reads from its start.
      await link.evaluate((input) => {
        input.blur();
        input.scrollLeft = 0;
      });
    },
  },
  { name: 'admin-insights-laptop', device: 'laptop', url: '/dev/insights', full: true },
];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : existsSync('/opt/pw-browsers/chromium')
      ? { executablePath: '/opt/pw-browsers/chromium' }
      : {},
);
mkdirSync(outDir, { recursive: true });
let total = 0;
let failures = 0;
for (const shot of SHOTS) {
  if (only && !only.includes(shot.name)) continue;
  const context = await browser.newContext({
    ...DEVICES[shot.device],
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  if (shot.device === 'board') await page.clock.setFixedTime(BOARD_TIME);
  const file = join(outDir, `${shot.name}.jpg`);
  try {
    const res = await page.goto(base + shot.url, { waitUntil: 'networkidle' });
    if (!res || !res.ok()) throw new Error(`${shot.url} answered ${res?.status()}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    if (shot.act) await shot.act(page, context);
    if (shot.scroll) await page.evaluate((y) => window.scrollTo(0, y), shot.scroll);
    await page.waitForTimeout(shot.wait ?? 500);
    const jpeg = { path: file, type: 'jpeg', quality: shot.quality ?? 72 };
    if (shot.element) {
      await page.locator(shot.element).screenshot(jpeg);
    } else if (shot.full || shot.maxHeight) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const width = DEVICES[shot.device].viewport.width;
      await page.screenshot({
        ...jpeg,
        fullPage: true,
        clip: { x: 0, y: 0, width, height: Math.min(height, shot.maxHeight ?? height) },
      });
    } else {
      // A clip is measured on the whole page, where the pinned bar sits at the top.
      await page.screenshot({ ...jpeg, ...(shot.clip ? { fullPage: true, clip: shot.clip } : {}) });
    }
    const size = statSync(file).size;
    total += size;
    const flag = size > SHOT_LIMIT ? '  (over 120 KB)' : '';
    console.log(
      `${`${shot.name}.jpg`.padEnd(32)} ${(size / 1024).toFixed(0).padStart(4)} KB${flag}`,
    );
  } catch (e) {
    failures += 1;
    console.log(`FAIL ${shot.name}: ${e.message.split('\n')[0]}`);
  } finally {
    await context.close();
  }
}
await browser.close();
console.log(`${(total / 1024).toFixed(0)} KB in total, written to docs/guide/img`);
if (!only && total > TOTAL_LIMIT) {
  console.log('FAIL the set is over 3 MB; lower a shot’s quality or cut it shorter');
  failures += 1;
}
if (failures) process.exit(1);
