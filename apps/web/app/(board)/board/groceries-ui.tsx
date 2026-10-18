'use client';

import { Avatar, Icon, type IconName } from '@familywise/ui';
import { useMemo, useState } from 'react';
import { type BoardGroceries, pictureOf } from '@/lib/board-groceries';
import { forMeals, itemAmount, sections, storeChips, type StoreFilter } from '@/lib/groceries';
import type { BoardMember } from '@/lib/snapshot';

/**
 * [MEAL-18][MEAL-23][US-714] Groceries on the board (WP-104, D-138): the list by the household's
 * categories, A to Z, each thing with its picture, its amount, and why when a meal needs it or a
 * child asked. Store chips change only what the board shows. Nothing here changes the list
 * (D-134 (12)); asking comes with WP-107.
 */
export function GroceriesBoard({
  groceries,
  members,
}: {
  groceries: BoardGroceries | null | undefined;
  members: BoardMember[];
}) {
  const [store, setStore] = useState<StoreFilter>('all');
  const people = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const items = groceries?.items ?? [];
  const chips = groceries ? storeChips(items, groceries.stores) : [];
  // A store whose items have all gone shows the whole list again.
  const shown = chips.some((c) => c.filter === store) ? store : 'all';
  const list = groceries ? sections(items, groceries.categories, shown) : [];
  return (
    <section className="fw-bgroc" aria-labelledby="bgroc-title">
      <h2 id="bgroc-title" className="fw-bgroc__title">
        <Icon name="shopping-cart" size={56} />
        Groceries
        <span className="fw-bgroc__sub">{items.length} to get</span>
      </h2>
      {chips.length > 2 ? (
        <div className="fw-bgroc__chips" role="group" aria-label="Stores">
          {chips.map((c) => (
            <button
              key={c.filter}
              type="button"
              className="fw-bgroc__chip"
              aria-pressed={c.filter === shown}
              onClick={() => setStore(c.filter)}
            >
              {c.filter !== 'all' && c.filter !== 'any' ? <Icon name="store" size={32} /> : null}
              {c.label} {c.count}
            </button>
          ))}
        </div>
      ) : null}
      {items.length === 0 ? (
        <div className="fw-bgroc__empty">
          <Icon name="shopping-cart" size={96} />
          <p>Nothing on the list right now.</p>
        </div>
      ) : (
        <div className="fw-bgroc__cols">
          {list.map((s) => (
            <section
              key={s.category.id}
              className="fw-bgroc__sec"
              aria-labelledby={`bgroc-${s.category.id}`}
            >
              <h3 id={`bgroc-${s.category.id}`}>
                <Icon name={s.category.icon as IconName} size={40} />
                <span>{s.category.name}</span>
                <span className="fw-bgroc__n">{s.items.length}</span>
              </h3>
              <ul>
                {s.items.map((item) => {
                  const amount = itemAmount(item);
                  const meals = forMeals(item);
                  const askers = [
                    ...new Set(
                      item.reasons
                        .filter((r) => r.kind === 'ask' && r.memberId)
                        .map((r) => r.memberId!),
                    ),
                  ]
                    .map((id) => people.get(id))
                    .filter((m): m is BoardMember => !!m);
                  return (
                    <li key={item.id} className="fw-bgroc__it">
                      <Icon name={pictureOf(item.name, s.category) as IconName} size={40} />
                      <span className="fw-bgroc__nm">
                        {item.name}
                        {amount ? <span className="fw-bgroc__amt"> {amount}</span> : null}
                      </span>
                      {meals ? (
                        <span className="fw-bgroc__wy">
                          <Icon name="utensils" size={28} />
                          For {meals}
                        </span>
                      ) : null}
                      {askers.map((m) => (
                        <span key={m.id} className="fw-bgroc__wy">
                          <Avatar
                            name={m.displayName}
                            avatarKey={m.avatarKey}
                            color={m.color}
                            size={32}
                            decorative
                          />
                          {m.displayName} asked
                        </span>
                      ))}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
