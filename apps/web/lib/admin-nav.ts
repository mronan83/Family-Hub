import type { IconName } from '@familywise/ui';

// [NFR-15][US-107] The admin app's one menu (WP-51, D-81): the pages a parent uses in a day, the
// family's own pages, and Settings, a page of its own that holds the pages set once and left alone.

export interface NavPage {
  href: string;
  label: string;
  icon: IconName;
}

export interface SettingsPage extends NavPage {
  /** What it is for, on the Settings page. */
  what: string;
}

export interface NavGroup {
  label: string;
  pages: NavPage[];
}

export const SETTINGS_HREF = '/admin/settings';

/** [NFR-15] The pages Settings holds, in its order. */
export const SETTINGS_PAGES: readonly SettingsPage[] = [
  {
    href: '/admin/settings/family',
    label: 'Family options',
    icon: 'family',
    what: 'The day the week starts on, how check-offs count, the weather on the boards, and the admins.',
  },
  {
    href: '/admin/school',
    label: 'School',
    icon: 'backpack',
    what: 'School years, terms, breaks and days off, so chores and lunch follow the school calendar.',
  },
  {
    href: '/admin/calendars',
    label: 'Calendars',
    icon: 'calendar',
    what: 'The family’s calendars: who each one is for, and its color.',
  },
  {
    href: '/admin/devices',
    label: 'Boards',
    icon: 'board',
    what: 'The boards in the house: their theme, text size, calendars and home screen.',
  },
  {
    href: '/admin/tags',
    label: 'Tags',
    icon: 'tag',
    what: 'Labels like Morning or Kitchen that group chores and let goals count by kind.',
  },
  {
    href: '/admin/reminders',
    label: 'Reminders',
    icon: 'bell',
    what: 'Your own reminders: when they come, and on which phones and laptops.',
  },
  {
    href: '/admin/health',
    label: 'Health',
    icon: 'activity',
    what: 'Whether calendars, menus and the nightly jobs are running.',
  },
];

/** [NFR-15] The menu, in its groups. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Your day',
    pages: [
      { href: '/admin', label: 'Home', icon: 'home' },
      { href: '/admin/today', label: 'Today', icon: 'list-check' },
      { href: '/admin/my', label: 'My tasks', icon: 'user' },
    ],
  },
  {
    label: 'The family',
    pages: [
      { href: '/admin/chores', label: 'Chores', icon: 'clipboard-check' },
      { href: '/admin/members', label: 'Members', icon: 'family' },
      { href: '/admin/rewards', label: 'Rewards', icon: 'gift' },
      { href: '/admin/goals', label: 'Goals', icon: 'target' },
      { href: '/admin/meals', label: 'Meals', icon: 'utensils' },
      { href: '/admin/groceries', label: 'Groceries', icon: 'shopping-cart' },
      { href: '/admin/insights', label: 'Insights', icon: 'chart' },
    ],
  },
  {
    label: 'Set-up',
    pages: [{ href: SETTINGS_HREF, label: 'Settings', icon: 'settings' }],
  },
];

/** The menu item to mark for a page: a page Settings holds marks Settings. */
export function navCurrent(page: string): string {
  return SETTINGS_PAGES.some((p) => p.href === page) ? SETTINGS_HREF : page;
}

/** The Settings page a page belongs to, for its way back; null for any other page. */
export function settingsPage(page: string): SettingsPage | null {
  return SETTINGS_PAGES.find((p) => p.href === page) ?? null;
}
