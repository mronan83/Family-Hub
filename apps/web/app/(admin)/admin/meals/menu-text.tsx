import { dayMenu, menuWords } from '@/lib/menus';
import type { MenuItem } from '@/lib/menu/nutrislice';

/**
 * [MENU-06][US-804] A day's school menu in the admin app (WP-64, D-94): a line a section, its name
 * then its options ("Entree: Beef tacos or Chicken wrap with Tortilla chips"); a menu with no
 * sections on one line, as before.
 */
export function MenuText({
  day,
}: {
  day: { items: MenuItem[]; noService: boolean; note?: string | null };
}) {
  const sections = day.noService ? [] : dayMenu(day.items);
  if (sections.length === 0 || (sections.length === 1 && !sections[0]!.label)) {
    return <span>{menuWords(day)}</span>;
  }
  return (
    <span className="fw-menu-text">
      {sections.map((s, i) => (
        <span key={i} className="fw-menu-text__row">
          {s.label ? (
            <>
              <span className="fw-menu-text__label">{s.label}</span>
              <span className="fw-visually-hidden">: </span>
            </>
          ) : null}
          {s.words}
        </span>
      ))}
    </span>
  );
}
