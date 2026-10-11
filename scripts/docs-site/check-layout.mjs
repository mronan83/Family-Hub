#!/usr/bin/env node
// Renders the built docs pages across phones, tablets, laptops and monitors and fails on layout
// regressions: page-level horizontal scroll, content spilling past the screen edge, touch targets too
// small to tap, and script errors. Run after `pnpm docs:build`.
//
//   pnpm docs:layout                 check every page on every device
//   pnpm docs:layout --shots=DIR     also save a top-of-page screenshot per page and device
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../..');
const dist = join(root, 'dist/docs-site');
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const shots = shotsArg ? resolve(shotsArg.slice(8)) : null;
const PAGES = ['architecture', 'data-model', 'requirements', 'stories', 'backlog', 'user-guide'];

// Logical viewports of real devices (CSS px). Touch devices also get a coarse pointer and no hover.
const DEVICES = [
  { name: 'phone-320', width: 320, height: 568, dpr: 2, touch: true },
  { name: 'iphone', width: 393, height: 852, dpr: 3, touch: true },
  { name: 'iphone-max', width: 430, height: 932, dpr: 3, touch: true },
  { name: 'iphone-landscape', width: 852, height: 393, dpr: 3, touch: true },
  { name: 'ipad-mini', width: 744, height: 1133, dpr: 2, touch: true },
  { name: 'ipad', width: 820, height: 1180, dpr: 2, touch: true },
  { name: 'ipad-landscape', width: 1180, height: 820, dpr: 2, touch: true },
  { name: 'ipad-pro-landscape', width: 1366, height: 1024, dpr: 2, touch: true },
  { name: 'laptop-13', width: 1280, height: 800, dpr: 2, touch: false },
  { name: 'laptop-15', width: 1440, height: 900, dpr: 2, touch: false },
  { name: 'monitor-1080p', width: 1920, height: 1080, dpr: 1, touch: false },
  { name: 'monitor-1440p', width: 2560, height: 1440, dpr: 1, touch: false },
  { name: 'monitor-4k', width: 3840, height: 2160, dpr: 1, touch: false },
];

// The publish skeleton the artifact viewer wraps each page in.
const wrap = (html) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${html}</body></html>`;

// Runs in the page. Returns problems as strings.
function inspect(touch) {
  const out = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1)
    out.push(`page scrolls sideways (${doc.scrollWidth}px content in ${doc.clientWidth}px)`);
  const scrollers = '.table-wrap, .diagram, .code, .matrix, .toc nav';
  const label = (el) => {
    const id = el.id || el.closest('[id]')?.id || '';
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
    return `<${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}>${id ? ' in #' + id : ''}`;
  };
  const visible = (el) => {
    if (el.closest('[hidden], details:not([open]) > :not(summary)')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  let spill = 0;
  for (const el of document.querySelectorAll('.page *')) {
    if (el.closest(scrollers) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > doc.clientWidth + 1 || r.left < -1) {
      if (spill++ < 3)
        out.push(
          `${label(el)} spills past the screen edge (${Math.round(r.left)}–${Math.round(r.right)}px)`,
        );
    }
  }
  if (spill > 3) out.push(`…and ${spill - 3} more elements spill past the screen edge`);
  if (touch) {
    // Controls get a full 44px target (Apple HIG); ID tags at least 24px (WCAG 2.2 target size).
    const rules = [
      [
        '.chip, .btn, .reset, .row > summary, .mast nav a, .toc-m a, .toc-m summary, .search input, details.more > summary',
        44,
      ],
      ['a.tag', 24],
    ];
    for (const [sel, min] of rules) {
      const small = [...document.querySelectorAll(sel)].filter(
        (el) => visible(el) && el.getBoundingClientRect().height < min - 0.5,
      );
      if (small.length)
        out.push(
          `${small.length} touch targets under ${min}px, e.g. ${label(small[0])} at ${Math.round(small[0].getBoundingClientRect().height)}px`,
        );
    }
  }
  return out;
}

const tmp = join(tmpdir(), 'fw-docs-layout');
mkdirSync(tmp, { recursive: true });
for (const p of PAGES)
  writeFileSync(join(tmp, `${p}.html`), wrap(readFileSync(join(dist, `${p}.html`), 'utf8')));
if (shots) mkdirSync(shots, { recursive: true });

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
let failures = 0;
for (const d of DEVICES) {
  const context = await browser.newContext({
    viewport: { width: d.width, height: d.height },
    deviceScaleFactor: d.dpr,
    isMobile: d.touch && d.width < 1000,
    hasTouch: d.touch,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`script error: ${e.message}`));
  for (const p of PAGES) {
    await page.goto(`file://${join(tmp, `${p}.html`)}`);
    // Fonts load from Google; layout must hold with or without them, so do not wait long.
    await page.waitForTimeout(150);
    const problems = [...(await page.evaluate(inspect, d.touch)), ...errors.splice(0)];
    if (shots) await page.screenshot({ path: join(shots, `${p}--${d.name}.png`) });
    if (problems.length) {
      failures += problems.length;
      for (const msg of problems) console.log(`FAIL ${d.name.padEnd(19)} ${p.padEnd(13)} ${msg}`);
    }
  }
  await context.close();
}
await browser.close();
console.log(`${PAGES.length} pages × ${DEVICES.length} devices · ${failures} problem(s)`);
if (failures) process.exit(1);
