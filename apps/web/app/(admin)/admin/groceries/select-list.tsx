'use client';

import { Button, Icon, type IconName } from '@familywise/ui';
import { useState } from 'react';
import type { GroceryBrand } from '@/lib/grocery-brands';
import type { GroceryCategory, GroceryStore, Person, Section } from '@/lib/groceries';
import { moveGroceries, removeGroceries, setGroceriesStore } from './actions';
import { ItemWords, SectionHead } from './rows';

/**
 * [MEAL-23] Select (D-138 (3)): the boxes select instead of tick; Move to… (or a new category),
 * Store… and Remove act on every item selected at once; Remove asks first. Done goes back to ticking.
 */
export function SelectList({
  sections,
  categories,
  stores,
  brands,
  people,
  initial,
  storeFilter,
  initialPanel = null,
}: {
  sections: readonly Section[];
  categories: readonly GroceryCategory[];
  stores: readonly GroceryStore[];
  brands: readonly GroceryBrand[];
  people: readonly Person[];
  initial: readonly string[];
  storeFilter: string;
  initialPanel?: 'move' | null;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set(initial));
  const [panel, setPanel] = useState<'move' | 'store' | 'remove' | null>(initialPanel);
  const toggle = (id: string) =>
    setChosen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const n = chosen.size;
  const counts = new Map(sections.map((s) => [s.category.id, s.items.length]));
  const hidden = (
    <>
      {[...chosen].map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      <input type="hidden" name="store" value={storeFilter} />
    </>
  );
  const what = `${n} item${n === 1 ? '' : 's'}`;

  return (
    <div className="fw-groc__select">
      <div className="fw-groc__selbar" role="region" aria-label="Selected">
        <strong aria-live="polite">{n} selected</strong>
        <span className="fw-groc__grow" />
        <Button
          variant="secondary"
          icon="chevron-right"
          disabled={n === 0}
          aria-expanded={panel === 'move'}
          onClick={() => setPanel(panel === 'move' ? null : 'move')}
        >
          Move to…
        </Button>
        <Button
          variant="secondary"
          icon="store"
          disabled={n === 0}
          aria-expanded={panel === 'store'}
          onClick={() => setPanel(panel === 'store' ? null : 'store')}
        >
          Store…
        </Button>
        <Button
          variant="ghost"
          icon="trash"
          disabled={n === 0}
          aria-expanded={panel === 'remove'}
          onClick={() => setPanel(panel === 'remove' ? null : 'remove')}
        >
          Remove
        </Button>
        {panel === 'move' && n > 0 ? (
          <form action={moveGroceries} className="fw-groc__panel" aria-label={`Move ${what} to`}>
            {hidden}
            <p className="fw-groc__panel-h">Move {what} to</p>
            {categories.map((c) => (
              <label key={c.id} className="fw-choice fw-groc__opt">
                <input type="radio" name="categoryId" value={c.id} required />
                <Icon name={c.icon as IconName} size={18} />
                <span className="fw-groc__grow">{c.name}</span>
                <span className="fw-muted">{counts.get(c.id) ?? 0}</span>
              </label>
            ))}
            <label className="fw-field">
              <span className="fw-field__label">New category…</span>
              <input
                className="fw-input"
                name="newCategory"
                maxLength={40}
                autoComplete="off"
                placeholder="Like Fruit"
                onInput={(e) => {
                  const radios = e.currentTarget.form?.querySelectorAll<HTMLInputElement>(
                    'input[name="categoryId"]',
                  );
                  radios?.forEach((r) => {
                    r.required = !e.currentTarget.value.trim();
                    if (e.currentTarget.value.trim()) r.checked = false;
                  });
                }}
              />
            </label>
            <Button type="submit" icon="check">
              Move {what}
            </Button>
          </form>
        ) : null}
        {panel === 'store' && n > 0 ? (
          <form
            action={setGroceriesStore}
            className="fw-groc__panel"
            aria-label={`Store for ${what}`}
          >
            {hidden}
            <p className="fw-groc__panel-h">Where to get {what}</p>
            {[{ id: '', name: 'Any store' }, ...stores].map((s) => (
              <label key={s.id || 'any'} className="fw-choice fw-groc__opt">
                <input type="radio" name="storeId" value={s.id} required />
                <span className="fw-groc__grow">{s.name}</span>
              </label>
            ))}
            <Button type="submit" icon="check">
              Set the store
            </Button>
          </form>
        ) : null}
        {panel === 'remove' && n > 0 ? (
          <form action={removeGroceries} className="fw-groc__panel" aria-label={`Remove ${what}`}>
            {hidden}
            <p className="fw-groc__panel-h">
              Take {what} off the list? They aren’t counted as bought.
            </p>
            <div className="fw-actions">
              <Button type="submit" variant="danger" icon="trash">
                Remove {what}
              </Button>
              <Button variant="ghost" onClick={() => setPanel(null)}>
                Keep them
              </Button>
            </div>
          </form>
        ) : null}
      </div>
      {sections.map((s) => (
        <section key={s.category.id} aria-labelledby={`cat-${s.category.id}`}>
          <SectionHead section={s} />
          <ul className="fw-groc__rows">
            {s.items.map((item) => {
              const on = chosen.has(item.id);
              return (
                <li key={item.id} className={`fw-groc__row${on ? ' fw-groc__row--sel' : ''}`}>
                  <label className="fw-groc__tick">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(item.id)}
                      aria-label={`Select ${item.name}`}
                    />
                  </label>
                  <ItemWords item={item} stores={stores} brands={brands} people={people} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
