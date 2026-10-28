import { Avatar, type AvatarKey, Icon, type IconName, type MemberColor } from '@familywise/ui';
import type { ReactNode } from 'react';
import { brandOf, type GroceryBrand } from '@/lib/grocery-brands';
import {
  type GroceryItem,
  type GroceryStore,
  itemAmount,
  type Person,
  type Section,
  whyLines,
} from '@/lib/groceries';

// [MEAL-18][MEAL-23] One grocery row's words, shared by the list and Select (WP-104): its name and
// amount, then its store and why it is on the list.

export function Why({ item, people }: { item: GroceryItem; people: readonly Person[] }) {
  const lines = whyLines(item, people);
  if (lines.length === 0) return null;
  return (
    <>
      {lines.map((w, i) => (
        <span key={i} className="fw-groc__why">
          {i > 0 ? (
            <span aria-hidden className="fw-groc__dot">
              ·
            </span>
          ) : null}
          {w.kind === 'meal' ? (
            <>
              <Icon name="utensils" size={15} />
              {w.label}
            </>
          ) : w.kind === 'ask' ? (
            <>
              {w.member ? (
                <Avatar
                  name={w.member.name}
                  avatarKey={w.member.avatarKey as AvatarKey | null}
                  color={w.member.color as MemberColor}
                  size={20}
                  decorative
                />
              ) : null}
              {w.member?.name ?? 'A child'} asked
            </>
          ) : w.kind === 'staple' ? (
            <>
              <Icon name="repeat" size={15} />
              Staple
            </>
          ) : (
            w.who
          )}
        </span>
      ))}
    </>
  );
}

export function StoreTag({ store }: { store: GroceryStore | undefined }) {
  if (!store) return null;
  return (
    <span className="fw-groc__store">
      <Icon name="store" size={13} />
      {store.name}
    </span>
  );
}

/** The row's name, [MEAL-29] its brand ("Milk · Kirkland") and its amount, then its store and why. */
export function ItemWords({
  item,
  stores,
  brands,
  people,
}: {
  item: GroceryItem;
  stores: readonly GroceryStore[];
  brands: readonly GroceryBrand[];
  people: readonly Person[];
}) {
  const amount = itemAmount(item);
  const brand = brandOf(item.brandId, brands);
  const store = stores.find((s) => s.id === item.storeId);
  const why = whyLines(item, people);
  return (
    <span className="fw-groc__words">
      <span className="fw-groc__l1">
        <strong>
          {item.name}
          {brand ? <span className="fw-groc__brandname"> · {brand}</span> : null}
        </strong>
        {amount ? <span className="fw-groc__amt">{amount}</span> : null}
      </span>
      {store || why.length > 0 ? (
        <span className="fw-groc__l2">
          <StoreTag store={store} />
          <Why item={item} people={people} />
        </span>
      ) : null}
    </span>
  );
}

/** A category's heading over its rows: its icon, name and count, and what goes on its right. */
export function SectionHead({ section, children }: { section: Section; children?: ReactNode }) {
  return (
    <div className="fw-groc__sech">
      <Icon name={section.category.icon as IconName} size={18} />
      <h3 id={`cat-${section.category.id}`}>{section.category.name}</h3>
      <span className="fw-groc__n">{section.items.length}</span>
      <span className="fw-groc__grow" />
      {children}
    </div>
  );
}
