'use client';

import { useRouter } from 'next/navigation';

/**
 * [CHR-21] More filters' Tag (Q1): applied as it is picked, by going to the page with that tag (each
 * option carries its address), so there is no Filter button.
 */
export function TagPicker({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string; href: string }[];
}) {
  const router = useRouter();
  return (
    <label className="fw-field">
      <span className="fw-field__label">Tag</span>
      <select
        className="fw-input"
        value={value}
        onChange={(e) => {
          const to = options.find((o) => o.value === e.target.value);
          if (to) router.push(to.href, { scroll: false });
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
