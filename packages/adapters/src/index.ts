// School menu adapters (MENU-02). Implementations land in WP-27 after SPIKE-04.

export type MealService = 'breakfast' | 'lunch';

export interface MenuDay {
  date: string;
  service: MealService;
  items: { name: string; category?: string }[];
  noService: boolean;
}

export interface MenuAdapter {
  readonly id: 'nutrislice' | 'schoolcafe' | 'linq' | 'csv' | 'manual';
  fetchMenu(
    config: Record<string, unknown>,
    window: { from: string; to: string },
  ): Promise<MenuDay[]>;
}
