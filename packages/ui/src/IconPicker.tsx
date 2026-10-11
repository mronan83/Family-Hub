'use client';
// One icon picker for chores, tasks, tags, rewards and goals (WP-46, D-70): every icon a family might
// want, grouped (Home, Kitchen and food, School and learning, …), with a search over each icon's name
// and words. The radios are the form field, so it works before the script loads, and an icon hidden by
// the search or a group stays chosen. The app's own controls (chevrons, close, menu) are never
// offered, but an icon chosen before still shows, first, as chosen.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ICON_GROUPS, ICON_INDEX } from './generated/icon-index';
import type { IconName } from './generated/icons';
import { Icon, iconLabel } from './Icon';

export interface IconPickerProps {
  /** The form field's name. */
  name?: string;
  legend: string;
  /** The icon chosen now; null for none (only with `optional`). */
  selected: IconName | null;
  /** The group shown first, e.g. 'home' for chores and 'rewards' for rewards. */
  start?: string;
  /** Offers "No icon", submitted as an empty value. */
  optional?: boolean;
}

/** Lowercase words of a search, e.g. "Feed the DOG" → ["feed", "the", "dog"]. */
function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when every word of the search starts a word of the icon's name, its words or its group. */
export function iconMatches(name: IconName, group: string, query: string): boolean {
  const want = words(query);
  if (!want.length) return true;
  const have = [iconLabel(name), name, group, ...ICON_INDEX[name].keywords].flatMap(words);
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

export function IconPicker({ name = 'icon', legend, selected, start, optional }: IconPickerProps) {
  const [chosen, setChosen] = useState<IconName | null>(selected);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => {
    const first = ICON_GROUPS.filter((g) => g.key === start);
    return [...first, ...ICON_GROUPS.filter((g) => g.key !== start)];
  }, [start]);
  const offered = useMemo(() => new Set(groups.flatMap((g) => g.icons)), [groups]);
  const earlier = selected && !offered.has(selected) ? selected : null;

  // Bring the chosen icon into view inside the grid, without moving the page.
  useEffect(() => {
    const box = grid.current;
    const item = box?.querySelector<HTMLElement>('input:checked')?.closest('label');
    if (box && item) box.scrollTop = item.offsetTop - box.clientHeight / 3;
  }, []);

  const searching = words(query).length > 0;
  const shown = groups.map((g) => ({
    ...g,
    visible: g.icons.filter(
      (n) => (searching || !group || group === g.key) && iconMatches(n, g.label, query),
    ),
  }));
  const count = shown.reduce((n, g) => n + g.visible.length, 0);

  const radio = (icon: IconName, hidden = false) => (
    <label
      key={icon}
      className="fw-picker__item fw-picker__item--icon"
      title={iconLabel(icon)}
      hidden={hidden}
    >
      <input
        type="radio"
        name={name}
        value={icon}
        defaultChecked={selected === icon}
        onChange={() => setChosen(icon)}
        aria-label={iconLabel(icon)}
        className="fw-visually-hidden"
      />
      <Icon name={icon} size={28} />
    </label>
  );

  return (
    <fieldset className="fw-field fw-fieldset fw-iconpick">
      <legend className="fw-field__label">{legend}</legend>
      <p className="fw-iconpick__chosen" aria-live="polite">
        {chosen ? (
          <>
            <Icon name={chosen} size={28} />
            <span>Chosen: {iconLabel(chosen)}</span>
          </>
        ) : (
          <span>No icon chosen</span>
        )}
      </p>
      <input
        type="search"
        className="fw-input"
        placeholder="Find an icon, like bed or dog"
        aria-label="Find an icon"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter in the search box would send the whole form.
          if (e.key === 'Enter') e.preventDefault();
        }}
      />
      <div className="fw-iconpick__groups" role="group" aria-label="Icon groups">
        <button
          type="button"
          className="fw-iconpick__group"
          aria-pressed={!group && !searching}
          onClick={() => {
            setGroup(null);
            setQuery('');
          }}
        >
          All
        </button>
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            className="fw-iconpick__group"
            aria-pressed={group === g.key && !searching}
            onClick={() => {
              setGroup(g.key);
              setQuery('');
              if (grid.current) grid.current.scrollTop = 0;
            }}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="fw-iconpick__grid" ref={grid}>
        {optional || earlier ? (
          <div className="fw-picker" hidden={searching}>
            {optional ? (
              <label className="fw-picker__item">
                <input
                  type="radio"
                  name={name}
                  value=""
                  defaultChecked={!selected}
                  onChange={() => setChosen(null)}
                  className="fw-visually-hidden"
                />
                <span>No icon</span>
              </label>
            ) : null}
            {earlier ? radio(earlier) : null}
          </div>
        ) : null}
        {shown.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} hidden={!g.visible.length}>
            <p className="fw-iconpick__heading" aria-hidden="true">
              {g.label}
            </p>
            <div className="fw-picker fw-iconpick__icons">
              {g.icons.map((icon) => radio(icon, !g.visible.includes(icon)))}
            </div>
          </div>
        ))}
        {searching && !count ? (
          <p className="fw-muted">No icon matches “{query.trim()}”. Try another word.</p>
        ) : null}
      </div>
    </fieldset>
  );
}
