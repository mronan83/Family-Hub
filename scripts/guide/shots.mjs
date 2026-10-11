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
    // for a reward and checks off Homework, which needs a parent.
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
    clip: { x: 0, y: 940, width: 1920, height: 1080 },
  },
  { name: 'board-home-month', device: 'board', url: '/dev/board?span=month' },
  { name: 'board-home-evening', device: 'board', url: '/dev/board?theme=evening&span=3' },
  // The weather beside the clock (WP-45), from the dev board's made-up rainy reading.
  {
    name: 'board-weather',
    device: 'board',
    url: '/dev/board?weather=rain',
    clip: { x: 880, y: 20, width: 1040, height: 150 },
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
    maxHeight: 1500,
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
    url: '/dev/board',
    act: (page) => person(page, 'Calendar').click(),
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
  { name: 'admin-today-laptop', device: 'laptop', url: '/dev/admin', full: true },
  { name: 'admin-not-done-phone', device: 'phone', url: '/dev/admin?notice=1', maxHeight: 1300 },
  { name: 'admin-my-tasks-phone', device: 'phone', url: '/dev/admin?view=my', full: true },
  { name: 'admin-reminders-phone', device: 'phone', url: '/dev/reminders', maxHeight: 1500 },
  {
    name: 'admin-rewards-laptop',
    device: 'laptop',
    url: '/dev/rewards',
    full: true,
    quality: 64,
  },
  { name: 'admin-goals-laptop', device: 'laptop', url: '/dev/goals', maxHeight: 1430 },
  { name: 'admin-goal-form-phone', device: 'phone', url: '/dev/goals?form=new', full: true },
  { name: 'admin-calendars-phone', device: 'phone', url: '/dev/calendars', maxHeight: 1330 },
  {
    name: 'admin-calendar-add-phone',
    device: 'phone',
    url: '/dev/calendars?state=empty',
    full: true,
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
