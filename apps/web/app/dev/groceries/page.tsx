import type { Metadata } from 'next';
import { GroceriesView } from '../../(admin)/admin/groceries/view';
import { groceriesData, NOW, TZ, withStapleAdded } from './fixture';

// The admin Groceries page (WP-104) with the made-up demo family and no database, for the UI suite,
// the screen shots and the guide: Day or Evening (?theme=evening); ?state=empty; the add field typed
// into (?typed=greek yog); an item's ⋯ open (?menu=Onions); Select with three picked and Move to
// open (?select=1&sel=Apples,Avocados,Bananas&panel=move); a store chip (?store=Costco); Got
// recently or Categories and stores open (?open=got, ?open=places); a row's Edit, Move to or Store
// (?edit=Onions, ?move=Onions, ?storeOf=Onions); [MEAL-28] a preferred store (?preferred=Costco, WP-112);
// [MEAL-29] WP-116's brands: the Brand field typed into with its offers open (?typed=milk&brand=kirk),
// a row's Brand… (?brandOf=Milk), a brand's Merge into… (?merge=Kirkland%20Signature&open=places),
// Rename (?renameBrand=Fairlife); [MEAL-21] WP-106's staples: Staples open (?open=staples), after
// Running low?'s Add (?staple=added), after Not now (?did=staple-not-now&name=Butter&until=2026-10-27).
export const metadata: Metadata = { title: 'Groceries', robots: { index: false } };

type Params = Record<string, string | undefined>;

export default async function DevGroceriesPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const base = groceriesData(p.state === 'empty' ? 'empty' : 'busy', p.preferred ?? null);
  // [MEAL-21] Running low?'s Add on Butter, with its Undo (?staple=added, WP-106).
  const added = p.staple === 'added' ? withStapleAdded(base) : null;
  const data = added?.data ?? base;
  const idOf = (name: string | undefined) =>
    name ? data.items.find((i) => i.name === name)?.id : undefined;
  const store = p.store
    ? (data.stores.find((s) => s.name === p.store || s.id === p.store)?.id ?? p.store)
    : undefined;
  return (
    <div className={`admin ${theme}`}>
      <GroceriesView
        data={data}
        timezone={TZ}
        now={NOW}
        query={{
          ...p,
          ...(added ? { did: 'staple-added', id: added.id } : {}),
          store,
          edit: idOf(p.edit),
          move: idOf(p.move),
          storeOf: idOf(p.storeOf),
          brandOf: idOf(p.brandOf),
          merge: data.brands.find((b) => b.name === p.merge)?.id,
          rename: data.brands.find((b) => b.name === p.renameBrand)?.id ?? p.rename,
          sel: p.sel
            ?.split(',')
            .map((n) => idOf(n))
            .filter(Boolean)
            .join(','),
        }}
        error={null}
        dev={{ typed: p.typed, menu: idOf(p.menu), panel: p.panel, brand: p.brand }}
      />
    </div>
  );
}
