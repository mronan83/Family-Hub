# 06 — FamilyWise Brand and Style Guide

> Version 1.9 · Status: built (WP-37, WP-06, WP-11, WP-13, WP-17, WP-40)
> v1.9: reminders in the admin app: the Reminders page and the bell on each item in My tasks (`bell`, pressed Teal-tinted "Bell on", plain "Bell off"); a reminder notification is the item's title (or "Private task") and "Due at 3:00 pm" (§7.3, WP-40).
> v1.6: the streak flame as built: tiers at 3, 7, 14 and 30 days, a glow on reaching one; the Insights heatmap marks each day with an icon as well as a colour (§7.2, WP-17).
> v1.5: the board's offline and stale lines sit in its bar as pills; a balance not yet saved while offline is provisional: dashed plum ring and `wifi-off` (§7.2, WP-13).
> v1.4: the board's points list says what each entry was for; points a parent took away read "A parent changed your points", never the reason (D-50, § Voice).
> v1.3: every board action works by touch, mouse click and keyboard; no gesture is the only way to do anything (§ Touch).
> v1.2: the board's manual theme override is a per-board hold an admin sets in Boards (Always Day or Always Evening); the board's live status uses `wifi` and `wifi-off`.
> v1.1: Evening success is Leaf 400; display states (overdue, past its time, covered, done by, private) and admin words for each status; `.theme-day`/`.theme-evening` force a theme on part of a page; board theme times; two manifests; implementation notes match the code. The brand page `/dev/brand` renders everything from the real components.
> Companions: `01-technical-architecture.md` · `02-data-model.md` · `03-user-stories.md` · `04-requirements-traceability.md` · `05-backlog.md`
> Assets live in `brand/`. Open `brand/specimen.html` to see everything rendered. Implementation lands in WP-37.

---

## 1. Brand essence

**FamilyWise** is the calm center of a busy house: the place where a child sees what's next, gets credit for it, and a parent can trust the record.

| | |
|---|---|
| **Promise** | Everyone knows what's next, and effort gets noticed. |
| **Personality** | Warm, capable, encouraging, fair. A kind coach, not a game show and not a nag. |
| **Principles** | **1. Kid-first, parent-trusted.** The board is for a child. The admin is for adults. Same brand, two registers. **2. Honest, never shaming.** Trust and accountability are the point, so misses and reversals are stated plainly and kindly. **3. Calm by default, joyful on purpose.** Quiet surfaces; celebration is rare and earned. **4. Legible from across the room.** Large, simple, high contrast. |
| **Name** | One word, capital F and W: **FamilyWise**. Never "Family Wise", "Familywise", or "FW" in user-facing text. "Wise" refers to being smart with time and effort, not a mascot. |

**Name clearance (action for you).** I could not verify availability. A similarly named product, FamilyWize (a prescription discount card), exists in an unrelated category. For a private household app this is low risk, but run a USPTO and domain check before you register a domain or publish an app-store listing.

---

## 2. Voice and tone

**Board (to the child):** short, positive, concrete, present tense. Second person. Never sarcasm, never guilt.
**Admin (to parents):** clear, brief, neutral. Say what happened and what the next step is.

| Situation | Board | Admin |
|---|---|---|
| Chore done | "Done! +5" | "Sam checked off *Make bed* at 7:42 am." |
| Waiting for approval | "Waiting for a parent" | "3 check-offs need review." |
| Rejected | "Try again" | "You sent *Dishes* back. Sam sees it as open." |
| Missed day | "Missed" (history only) | "Missed 2 of 6 on Tue." |
| Reversal took points | "Make bed, undone −5" | "Reversed *Make bed*. −5 points." |
| Points taken away | "A parent changed your points −5" (never the reason) | "Took away 5 points." The reason shows in the member's history. |
| Balance below zero | "−5 to earn back" | "Balance is −5 after a reversal." |
| Goal un-achieved | "Almost there again: 4 of 5" | "*Movie night* dropped from achieved to 80% because *Dishes* was reversed." |
| Offline | "Offline: your check-offs are saved" | "Board offline since 6:10 pm. 3 changes queued." |
| Stale data | "Updated 12 minutes ago" | "Calendar sync failed at 5:55 pm. Showing last good data." |
| Empty chores | "All done today. Nice work!" | "No chores yet. Add the first one." |

**Rules**
- No red, no exclamation on bad news, no "failed", "wrong", "lazy", "bad".
- Use "bad streak" only in parent insights. On the board it is "a rough patch" or just a plain count.
- Points are "points" in the app. Arcade-style tickets are an *icon style* for the shop, not different currency.
- Sentence case everywhere. No ALL CAPS except tiny labels in admin tables.
- Numbers: digits always ("5 chores", "120 points"). Dates: "Tue, Oct 7". Times: "7:42 am".
- Contractions are fine. Emoji are not used in UI copy; icons do that job.

---

## 3. Logo

### 3.1 Construction
The mark is a rounded square (the app tile) holding a **roof line** (home and family) over a **check** (done). The check is the only warm element, so the eye lands on completion. The wordmark is **Family** in Nunito 600 followed by **Wise** in Nunito 800, which makes "Wise" the emphasis.

### 3.2 Files (`brand/logo/`)

| File | Use |
|---|---|
| `familywise-horizontal-color.svg` | Default lockup on light backgrounds (admin header, emails, docs) |
| `familywise-horizontal-reversed.svg` | On Evening (dark) backgrounds |
| `familywise-horizontal-mono-light.svg` | White on brand teal or photos |
| `familywise-horizontal-mono-dark.svg` | One-color print, fax-style, stamps |
| `familywise-stacked-*.svg` | Square spaces: login, pairing screen, splash |
| `familywise-wordmark-*.svg` | Text-only, when the mark already appears nearby |
| `familywise-mark*.svg` | App tile, avatars, favicons, small spaces |
| `familywise-glyph-on-teal.svg`, `-glyph-ink.svg` | The roof and check without the tile, for use on teal or as a watermark |
| `*.png` | 160 px and 360 px renders for slide decks and documents |

All text is outlined, so the logo renders correctly without the font installed.

### 3.3 Rules
- **Clear space:** keep a margin equal to the height of the check (about 1/4 of the tile) on all sides.
- **Minimum size:** mark 24 px; horizontal lockup 112 px wide; stacked lockup 72 px wide. Below that, use the mark alone.
- **Backgrounds:** color lockup on Paper, white, or light tints only. Reversed lockup on Evening or ink. Mono-light on brand teal.
- **Don't:** recolor outside the files provided, stretch, rotate, add shadows or gradients, outline, place on busy photos, replace the check with another symbol, or set the name in another typeface.

---

## 4. Color

Defined once in `brand/familywise-tokens.css`. Use the **role** tokens (`--primary`, `--text`, `--surface`) in components, never raw hex.

### 4.1 Palette

| Name | Hex | Role | Contrast |
|---|---|---|---|
| **Teal 600** | `#0F766E` | Primary actions, brand | White on it **5.47:1** |
| Teal 700 | `#115E59` | Primary text on light | On Paper **7.10:1** |
| Teal 300 | `#5EEAD4` | Primary in Evening theme | On Evening bg **11.30:1** |
| Teal 100 | `#CCFBF1` | Primary tint (done, selected) | Teal 700 on it **6.73:1** |
| **Sun 400** | `#FBBF24` | Points, rewards, celebration | Ink on it **8.79:1** |
| Sun 800 | `#92400E` | Reward text on tint | On Sun 100 **6.37:1** |
| Sun 100 | `#FEF3C7` | Reward tint, "waiting" | |
| Leaf 600 | `#15803D` | Success (admin) | White on it **5.02:1** |
| Leaf 400 | `#4ADE80` | Success in the Evening theme | On Evening surface **8.33:1** |
| **Plum 600** | `#7E4F8F` | Missed, reversed: calm, never alarm red | White on it **6.17:1** |
| Plum 700 / 100 | `#5B3A68` / `#F1E8F5` | Missed text / tint | **7.82:1** |
| Sky 600 | `#0369A1` | Info, "try again", focus ring | White on it **5.93:1** |
| **Paper** | `#FAF7F2` | App background | Ink on it **13.74:1** |
| Surface | `#FFFFFF` | Cards | Ink on it **14.68:1** |
| **Ink** | `#1F2937` | Text | |
| Ink soft | `#4B5563` | Secondary text | On Paper **7.07:1** |
| Line | `#E7E1D6` | Borders and dividers | |

**Evening theme** (board switches automatically by time of day and ambient setting; admin follows the OS): background `#14201F`, surface `#1D2C2B`, text `#F3EFE8` (14.59:1), soft text `#B7C2BE` (9.13:1), primary `#5EEAD4`, reward `#FCD34D` (10.06:1 on surface), success `#4ADE80` (8.33:1 on surface; Leaf 600 was only 2.89:1). All pairs verified at AA or better, by a unit test over every role pair the components use and by axe in CI.

**When the theme changes.** The board is Day from 06:30 to 19:00 household-local time and Evening otherwise, unless an admin holds that board on Day or Evening (Boards in the admin app); the admin app follows the device's dark mode. The theme is `data-theme` on `<html>`; `.theme-day` and `.theme-evening` force one theme on part of a page (the boot splash is always Evening).

### 4.2 Usage
- **Ratio:** about 80% Paper/Surface and Ink, 15% Teal, 5% Sun. Sun is a reward signal; if everything is gold, nothing is.
- **Never use red** for a child-visible state. A miss is Plum, a warning is Sun, an error in admin forms is Plum with an icon and text.
- **Never rely on color alone.** Every state pairs color with an icon and a label (see 7.1).
- **Family member colors** (`--member-1..6`, all ≥ 5.18:1 with white) are assigned per person. Always pair with the member's avatar or initial; never color-code alone.
- **Burn-in:** the board avoids large static bright fills. Use tints for large areas; reserve saturated teal and sun for small controls and chips.

---

## 5. Typography

| Role | Family | Weights | Where |
|---|---|---|---|
| Display and UI | **Nunito** | 600, 700, 800 | Board everything; admin headings and buttons |
| Body | **Inter** | 400, 500, 600, 700 | Admin body, tables, forms |

Both are open source (SIL OFL), **self-hosted** in `brand/fonts/` and loaded by `brand/fonts.css` so the kiosk works offline. Precache them in the service worker. Do not use Google Fonts at runtime.

### 5.1 Type scales (logical px)

| Token | Board (1920×1080 @ DPR 2) | Admin (phone/laptop) | Weight |
|---|---|---|---|
| `--t-hero` | 96 | 40 | Nunito 800 |
| `--t-title` | 56 | 28 | Nunito 800 |
| `--t-heading` | 40 | 20 | Nunito 700 |
| `--t-body` | **32** | 16 | Nunito 600 / Inter 400 |
| `--t-small` | 28 (minimum) | 14 | Nunito 600 / Inter 500 |

Why the board is large: one logical pixel is about 0.37 mm on the 32" 4K panel, so 32 px gives a cap height near 8 mm, comfortable at 2 m. **No child-facing text below 28 px.** Line height 1.25 for headings, 1.4 for body. Numbers in points chips use Nunito 800 with tabular figures.

---

## 6. Layout, shape, motion

**Grid and spacing.** 8 px base unit (`--s-1..12`). Board safe margin 48 px; no essential control within 24 px of the screen edge. Admin uses a 4-column phone, 12-column desktop grid, max content width 1180 px.

**Shape.** Cards `--r-lg` 24 px, controls `--r-md` 16 px, chips and primary buttons `--r-pill`. Borders 2 px on the board, 1 px in admin. Shadows are soft and used only to separate layers (`--shadow-1`, `--shadow-2`).

**Touch (board).** Minimum target 56 logical px (about 21 mm); primary actions 96 px tall. 16 px minimum gap between targets. Debounce taps; destructive actions need a confirm step. No hover-only behavior anywhere on the board. Every action is a real button: it works by touch, mouse click and keyboard (Enter or Space) alike, and no gesture (long-press, swipe, pinch) is the only way to do anything. Those gestures are blocked on the kiosk (US-203); the Pi hides the cursor.

**Motion.** Fast and small: 120 ms feedback, 220 ms transitions, 1.4 s celebrations. Animate `transform` and `opacity` only (the 4K Pi budget from SPIKE-03). Honor `prefers-reduced-motion` and the in-app setting: replace motion with a static state change plus a sound or icon swap. A celebration never blocks input and never plays more than once per achievement.

**Celebration ladder**
1. *Chore done:* check pops, tile tint fades in, points count up (about 600 ms).
2. *Streak milestone:* flame glows, short confetti burst in Sun and Teal (about 1.4 s).
3. *Goal achieved:* full-screen moment, once per achievement, dismissible by touch.
4. *Reward approved:* the prize card flips to a "Yours!" state.

---

## 7. Components

### 7.1 Chore tile states (icon + label + color; all seven statuses)

| Status | Icon | Board label | Style |
|---|---|---|---|
| `scheduled` | `circle` | To do | Surface, line border |
| `completed` | `check-circle` | Done! | Teal tint, teal border |
| `pending_approval` | `clock` | Waiting for a parent | Sun tint, sun border |
| `approved` | `shield-check` | Approved | Teal tint, teal border |
| `rejected` | `retry` | Try again | Surface, sky border |
| `skipped` | `moon` | Skipped today | Dashed border, no fill |
| `missed` | `minus-circle` | Missed | Plum tint, plum border |

`missed` appears only on past days (history, calendar, insights), never on today's list.

Admin views use plain words for the same statuses: Open, Done, Needs review, Approved, Sent back, Skipped, Missed.

**Display states** are views of a status, not stored statuses (D-30, D-31):

| Display state | When | Icon | Label | Style |
|---|---|---|---|---|
| Overdue | A task still open after its due date | `hourglass` | Overdue | Surface, sun border, sun text |
| Past its time | Today's item still open after its due time | `hourglass` | Past its time | Surface, sun border, sun text |
| Covered | A shared item done by another assignee | `check` | Covered · by Maya | Surface, soft text |
| Done by | Who did a shared item | the status icon | Done! · by Maya | The status style |
| Private | Admin views only, never on the board | `lock` | Private | Outline pill |

### 7.2 Other board components
- **Points chip:** Sun pill with `star`, Nunito 800, minimum height 56. Negative balance: Plum pill, "−5 to earn back". Provisional (offline, counting check-offs not yet saved): a dashed Plum ring and a small `wifi-off`, "Not saved yet" for screen readers.
- **Streak flame:** `flame` plus count; one flame size per milestone tier, no animation unless a milestone was just reached. As built: Sun text beside the name, flame 36 px below 3 days, then 40, 48, 52 and 56 px at 3, 7, 14 and 30; the glow is a 1.4 s scale of the flame (none with reduced motion). In admin Insights a day is Teal with `check` (good), Plum with `close` (bad), Sun with `hourglass` (waiting) or dotted (nothing counted).
- **Goal meter:** 28 px tall pill, teal-to-sun fill, percentage label always visible, never color-only.
- **Shop card:** 280 px wide, image on tint, title, cost chip with `ticket`, one "Ask" button. Unaffordable items stay visible with "Need 40 more".
- **Banners:** `hourglass` for stale, `wifi-off` for offline. Sun tint and Plum tint respectively; never red; never cover chores. On the board they are pills in the bar under the clock: "Offline: your check-offs are saved", "Updated 12 minutes ago", "Today's list may be out of date"; not a second live region.
- **Buttons:** primary (teal, white text), secondary (teal tint), ghost (line border). Minimum height 56, label Nunito 800, always icon + word on the board.

### 7.3 Admin conventions
- Top app bar with the horizontal logo (112 px) and household name; bottom tab bar on phones (Today, Chores, Rewards, Calendar, More).
- Approval queue is a badge on Chores, not a modal.
- Insights uses the trust panel and heatmap; heatmap cells use Teal (good), Plum (missed), empty (neutral), plus a text legend.
- Destructive actions: ghost button, confirm dialog stating the consequence ("This reverses 4 chores and 20 points").
- Reminders (WP-40): the Reminders page says plainly whether they are on ("On. Reminders come to the devices below." in Teal, or "Off. Nothing is sent to you."), then my devices (each with Send a test, Switch off or on, Remove) and "When to remind me". Each open item in My tasks has a bell: "Bell on" pressed (Teal tint) or "Bell off" (ghost), named "Remind me about …". A notification reads like the board: the item's title, or "Private task" for a private item, over "Due at 3:00 pm"; the digest is "Your day: 3 to do, 1 overdue" over the first three titles.

---

## 8. Iconography

**Set:** 85 custom icons in `brand/icons/` (`ui/` and `chores/`), drawn on a 24 px grid, **2 px stroke, round caps and joins**, `currentColor`, no fills except tiny dots. They inherit text color and size with the font. See `icons/index.json` for names, categories, and search keywords, and `icons/sprite.svg` for the sprite (`<use href="#fw-check"/>`).

| Category | Icons |
|---|---|
| Status | circle, check, check-circle, clock, shield-check, retry, moon, minus-circle, x-circle, info, warning, sparkles |
| Navigation | home, sun, list-check, calendar, view-day, view-week, view-month, utensils, gift, target, chart, settings, board, person, family, logout, menu |
| Rewards | star (points), ticket (shop cost), flame (streak), trophy (achieved), bookmark (wishlist) |
| School | backpack, buy, bring |
| Meals | breakfast, snack, lunch, dinner |
| System | plus, minus, close, edit, trash, undo, copy, select-multiple, chevrons, more, search, image, link, download, heatmap, lock, bell, sync, wifi, wifi-off, hourglass |
| Weather | cloud, rain (sun is shared) |
| Chores (picker) | bed, dishes, table, bin, teeth, laundry, pet, plant, toys, shoes, broom, bath, read, homework, outdoors, music, exercise, pack |

**Sizes (logical px):** board 56 (tiles), 36 (chips and rows), 28 (inline); admin 24 and 20. Touch targets are never the icon size; pad to 56 (board) or 44 (admin).
**Rules:** one icon per meaning (`hourglass` means time has passed: stale data, overdue, past its time); don't mix in other icon sets; don't fill the outline icons; for new icons keep the grid, stroke, and 2 px minimum gaps.
**Chore icon picker:** show the 18 chore icons first; allow search by keyword; store the icon name in `chore.icon`.

### 8.1 Avatars
Eight friendly characters (`brand/avatars/`): owl, bear, fox, cat, bunny, dog, frog, panda, in 64 px circles on soft tints. Store the file stem in `member.avatar_key` (for example `owl`). Adults can use initials on their member color. The owl is the default and nods to the "Wise" in the name; it is **not** a mascot and does not appear in UI chrome.

---

## 9. App identity and surfaces

| Asset | File | Notes |
|---|---|---|
| Favicon | `app-icons/favicon.svg`, `favicon.ico`, `favicon-16/32/48.png` | SVG adapts to dark mode |
| Apple touch | `app-icons/apple-touch-icon.png` (180) | Full-bleed teal; iOS rounds the corners |
| PWA icons | `icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` | Maskable has a safe zone for circle and squircle crops |
| Manifests | `board.webmanifest`, `admin.webmanifest` (generated) | Board: `fullscreen`, landscape, `start_url: /board`, background Evening. Admin: `standalone`, any orientation, `start_url: /admin`, background Paper. Both theme teal, colors read from the tokens file. `app-icons/manifest.webmanifest` supplies the icon list |
| Head tags | root layout metadata | Icons, theme colors for light and dark, each surface's manifest, Apple Home Screen tags on admin (`app-icons/head-snippet.html` is the reference) |
| Board splash | `app-icons/board-splash-3840x2160.png` | Shown while the board loads; Evening background, stacked reversed logo |

**Surfaces**
- **Board boot and pairing:** Evening background, stacked reversed logo, one short line of text ("Getting your day ready").
- **Admin sign-in:** Paper background, stacked color logo, "Sign in with Apple" first.
- **Emails:** horizontal color logo, 560 px wide layout, Inter 16 px, one teal button.
- **Browser tab:** "FamilyWise" on admin pages; "FamilyWise Board" on `/board`.

---

## 10. Accessibility (ties to NFR-11, NFR-03, BRD-03)

- Text and meaningful graphics meet WCAG AA (4.5:1 text, 3:1 large text and icons). All token pairs in 4.1 are verified.
- Color is never the only cue; every state has an icon and a word.
- Focus ring: 3 px sky (`--focus`) with 2 px offset, always visible for keyboard and switch access in admin.
- Reduced motion is honored globally (tokens file) and by the in-app setting.
- Touch targets and spacing per section 6.
- Screen reader names for icon-only controls come from `icons/index.json` names; icons inside labeled buttons are `aria-hidden`.

---

## 11. Implementation notes (for Claude Code)

- **Where it goes:** `packages/ui` holds the components (`Icon`, `Avatar`, `ChoreTile`, `PointsChip`, `GoalMeter`, `Banner`, `Button`, `Logo`, `BootSplash`) and `ui.css`. `packages/ui/scripts/brand.mjs` generates the typed icons, theme colors and a copy of the tokens (committed; CI fails if stale), and before every dev run and build copies fonts, logos, avatars and app icons into `apps/web/public` and writes the two manifests and the service worker (not committed).
- **Tokens:** import `brand/familywise-tokens.css` once at the root. Map Tailwind (or CSS modules) to the role tokens; do not hardcode hex in components. A lint rule or a test greps for raw hex outside the tokens file.
- **Icons:** a typed `IconName` union is generated from `icons/index.json`; `<Icon name="check-circle" size={36} />` renders inline SVG, and the generator accepts only drawing elements. Add new icons by adding an SVG file, rebuilding the index, and running `pnpm --filter @familywise/ui brand`.
- **Theme switching:** `data-theme="evening"` on `<html>`, set before first paint by a small boot script; the board switches by household-local time (06:30 and 19:00) unless an admin holds it on one theme (`device.board_config.theme`); admin uses `prefers-color-scheme`. `.theme-day` and `.theme-evening` force a theme on part of a page.
- **Fonts:** load `brand/fonts.css`; add the eight `.woff2` files to the service worker precache.
- **Tests:** Playwright snapshots of the chore tile in all seven states and the display states, in both themes and both surfaces, taken as computed styles (icon, word, colors, borders) so they match on every machine; an axe contrast check on the board, admin and brand pages; a unit test that every `OccurrenceStatus` has a tile mapping; a contrast test over the token pairs; a test that fails on raw hex outside the tokens file.
- **Source of truth:** if this guide and `familywise-tokens.css` disagree, the tokens file wins; fix the guide.

---

## 12. Asset index

```
brand/
├── familywise-tokens.css        design tokens (light + Evening)
├── fonts.css, fonts/            self-hosted Nunito and Inter
├── specimen.html                everything rendered (open in a browser)
├── logo/                        lockups, wordmarks, marks, glyphs (SVG + PNG)
├── app-icons/                   favicon, touch icon, PWA icons, manifest, splash
├── icons/ui, icons/chores       85 SVG icons
├── icons/sprite.svg, index.json sprite and searchable index
└── avatars/                     8 member avatars
```
