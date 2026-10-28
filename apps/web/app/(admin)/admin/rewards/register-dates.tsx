'use client';

import { Button, DatePick } from '@familywise/ui';
import { useState } from 'react';

/**
 * [PTS-08] The register's date range (WP-115): From and To, the household's own days, both kept with
 * the other filters in the address. Empty is any day. A plain GET form, so it works before hydration.
 */
export function RegisterDates({
  from,
  to,
  keep,
  action,
}: {
  from: string | null;
  to: string | null;
  /** The other filters, carried as they are. */
  keep: Record<string, string>;
  /** The register's own address. */
  action: string;
}) {
  const [start, setStart] = useState(from ?? '');
  const [end, setEnd] = useState(to ?? '');
  return (
    <form action={action} method="get" className="fw-register__dates">
      {Object.entries(keep).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="fw-filters">
        <label className="fw-field">
          <span className="fw-field__label">From</span>
          <DatePick
            type="date"
            name="from"
            label="From"
            value={start}
            initial={from ?? ''}
            onValue={setStart}
            empty="Any day"
          />
        </label>
        <label className="fw-field">
          <span className="fw-field__label">To</span>
          <DatePick
            type="date"
            name="to"
            label="To"
            value={end}
            initial={to ?? ''}
            onValue={setEnd}
            empty="Any day"
          />
        </label>
      </div>
      <div className="fw-actions">
        <Button type="submit" variant="secondary" icon="search">
          Show these days
        </Button>
      </div>
    </form>
  );
}
