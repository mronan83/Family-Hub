'use client';

import { Icon } from '@familywise/ui';
import { useId, useMemo, useState } from 'react';
import {
  BRAND_MAX,
  brandKey,
  brandName,
  brandOffers,
  type GroceryBrand,
} from '@/lib/grocery-brands';

/**
 * [MEAL-29] The Brand field (WP-116, D-148): a type-ahead over the household's saved brands,
 * matching ignoring case and spacing; when nothing matches exactly, its last offer is Add "<typed>",
 * which is saved to the household's brands with the item. Empty is no brand. Up and down move
 * through the offers, Enter or a tap picks one, Escape closes them. `hint` is said under it when
 * nothing more pressing is (the item's brand last time).
 */
export function BrandField({
  brands,
  value,
  onChange,
  hint,
  name = 'brand',
  label = 'Brand',
  initialOpen = false,
}: {
  brands: readonly GroceryBrand[];
  value: string;
  onChange: (value: string) => void;
  hint?: string | null;
  name?: string;
  label?: string;
  /** For the dev page only: the offers drawn open. */
  initialOpen?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(initialOpen);
  const [active, setActive] = useState(-1);
  const offers = useMemo(() => brandOffers(value, brands), [value, brands]);
  const choices = [
    ...offers.matches.map((b) => ({ key: b.id, name: b.name, add: false })),
    ...(offers.add ? [{ key: 'add', name: offers.add, add: true }] : []),
  ];
  // Nothing to offer when the one match is the brand typed already.
  const shown =
    open && choices.length > 0 && !(choices.length === 1 && offers.exact?.name === value);
  const archived = brands.find((b) => b.archived && brandKey(b.name) === brandKey(value));
  const pick = (n: string) => {
    onChange(n);
    setOpen(false);
    setActive(-1);
  };
  const note = !value.trim()
    ? null
    : archived && !offers.exact
      ? `${archived.name} is archived. Adding brings it back.`
      : !offers.exact
        ? `${brandName(value)} is new. Adding saves it to your brands.`
        : (hint ?? null);

  return (
    <div className="fw-groc__brand">
      <label className="fw-groc__brandlabel" htmlFor={`${id}-in`}>
        {label}
      </label>
      <div className="fw-groc__combo">
        <input
          id={`${id}-in`}
          className="fw-input"
          name={name}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={shown}
          aria-controls={`${id}-list`}
          aria-activedescendant={shown && active >= 0 ? `${id}-o${active}` : undefined}
          maxLength={BRAND_MAX}
          autoComplete="off"
          autoCapitalize="words"
          placeholder="Any brand"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setOpen(true);
              const n = choices.length;
              if (n === 0) return;
              setActive((a) => (e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n));
            } else if (e.key === 'Enter' && shown && active >= 0) {
              e.preventDefault();
              pick(choices[active]!.name);
            } else if (e.key === 'Escape' && shown) {
              e.preventDefault();
              setOpen(false);
            }
          }}
        />
        {shown ? (
          <ul className="fw-groc__offers" role="listbox" id={`${id}-list`} aria-label="Brands">
            {choices.map((c, i) => (
              <li
                key={c.key}
                id={`${id}-o${i}`}
                role="option"
                aria-selected={i === active}
                className={c.add ? 'fw-groc__offer fw-groc__offer--add' : 'fw-groc__offer'}
                // Keeps the field's focus, so the tap picks rather than closing the offers.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(c.name)}
              >
                {c.add ? (
                  <>
                    <Icon name="plus" size={18} />
                    Add “{c.name}”
                  </>
                ) : (
                  <>
                    <Icon name="tag" size={18} />
                    {c.name}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {note ? <span className="fw-groc__from">{note}</span> : null}
    </div>
  );
}
