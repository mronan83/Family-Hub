import { expect, type Locator, type Page } from '@playwright/test';

/**
 * [MEAL-14][D-98] Opens a folded section (a `<details>`: a meal day, Add to the plan, Copy last week,
 * the usual lunch week, WP-75) unless it is open already: the page keeps a section open across a
 * save, and a tap on an open one would close it. Waits until it is open.
 */
export async function unfold(details: Locator): Promise<void> {
  if ((await details.getAttribute('open')) === null)
    await details.locator(':scope > summary').click();
  await expect(details).toHaveAttribute('open', '');
}

/** A meal day's fold on Meals, by its date. */
export const mealDay = (scope: Page | Locator, date: string): Locator =>
  scope.locator(`.fw-meal-day[data-date="${date}"] > details`);
