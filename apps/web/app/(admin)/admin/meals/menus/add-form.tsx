'use client';

import { Banner, Button } from '@familywise/ui';
import { useState } from 'react';
import { useFormAction } from '@/lib/forms';
import type { School } from '@/lib/menu/nutrislice';
import type { MenuAdapter } from '@/lib/menus';
import { addMenu, type AddMenuState } from './actions';

/**
 * [MENU-01][MENU-02][US-801] Add a school menu: from the school's Nutrislice menus (find the
 * district's schools, then pick the school and its menu; adding fetches its next four weeks at once),
 * from a file, or typed in day by day. `found` starts the picker with schools already found (the dev
 * page and the guide's picture).
 */
export function AddMenuForm({ found }: { found?: { district: string; schools: School[] } }) {
  const [state, onSubmit, pending] = useFormAction(addMenu, (found ?? {}) as AddMenuState);
  const [adapter, setAdapter] = useState<MenuAdapter>('nutrislice');
  const [feed, setFeed] = useState('');
  const schools = state.schools ?? [];
  const district = state.district ?? '';
  const [schoolSlug, menuSlug] = feed.split('/');
  const school = schools.find((s) => s.slug === schoolSlug);
  const menu = school?.menuTypes.find((t) => t.slug === menuSlug);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label="Add a school menu">
      <label className="fw-field">
        <span className="fw-field__label">Name</span>
        <input
          className="fw-input"
          name="name"
          maxLength={40}
          required
          placeholder="Maple Elementary"
          defaultValue={school?.name ?? ''}
          key={school?.slug ?? 'name'}
          autoComplete="off"
        />
      </label>
      <fieldset className="fw-field fw-fieldset">
        <legend className="fw-field__label">Where the menu comes from</legend>
        {(
          [
            [
              'nutrislice',
              'The school’s Nutrislice menus',
              'Fetched every morning, four weeks ahead.',
            ],
            ['csv', 'A file', 'A spreadsheet saved as CSV: a row per item, with its date.'],
            ['manual', 'Typed in', 'You write each day’s lunch.'],
          ] as const
        ).map(([value, label, help]) => (
          <label key={value} className="fw-choice">
            <input
              type="radio"
              name="adapter"
              value={value}
              checked={adapter === value}
              onChange={() => setAdapter(value)}
            />
            <span>
              {label} <span className="fw-muted">· {help}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {adapter === 'nutrislice' ? (
        <div className="fw-menu-picker">
          <label className="fw-field">
            <span className="fw-field__label">Your district on Nutrislice</span>
            <input
              className="fw-input"
              name="districtInput"
              defaultValue={district}
              placeholder="example, from example.nutrislice.com"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="fw-field__help">
              Open your school’s lunch menu: its address starts with your district’s name, as in
              example.nutrislice.com. Type that name, or paste the whole address.
            </span>
          </label>
          <div className="fw-actions">
            <Button
              type="submit"
              name="intent"
              value="find"
              variant="secondary"
              disabled={pending}
              icon="search"
            >
              {pending ? 'Finding…' : 'Find the schools'}
            </Button>
          </div>
          {schools.length > 0 ? (
            <label className="fw-field">
              <span className="fw-field__label">School and menu</span>
              <select
                className="fw-input"
                name="feed"
                required
                value={feed}
                onChange={(e) => setFeed(e.target.value)}
              >
                <option value="" disabled>
                  Choose the school
                </option>
                {schools.map((s) => (
                  <optgroup key={s.slug} label={s.name}>
                    {s.menuTypes.map((t) => (
                      <option key={t.slug} value={`${s.slug}/${t.slug}`}>
                        {`${s.name} · ${t.name}`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : null}
          <input type="hidden" name="district" value={district} />
          <input type="hidden" name="schoolName" value={school?.name ?? ''} />
          <input type="hidden" name="menuName" value={menu?.name ?? ''} />
        </div>
      ) : null}

      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button
          type="submit"
          name="intent"
          value="add"
          disabled={pending || (adapter === 'nutrislice' && !menu)}
          icon="utensils"
        >
          {pending
            ? adapter === 'nutrislice'
              ? 'Adding and fetching…'
              : 'Adding…'
            : 'Add the menu'}
        </Button>
      </div>
    </form>
  );
}
