'use client';

import { DatePick } from '@familywise/ui';
import { useState } from 'react';

/**
 * [CHR-24][NFR-16] Done on time…'s **Earlier** time, written as the app writes times ("3:30 pm",
 * DatePick, D-128) in place of the browser's own field, which Safari draws as "3:30:00 PM". Its
 * latest is the chore's due time; the action and the database refuse anything later.
 */
export function OnTimeTime({
  name,
  label,
  initial,
}: {
  name: string;
  label: string;
  initial: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <DatePick
      type="time"
      className="fw-pick--clock fw-ontime__time"
      name={name}
      label={label}
      initial={initial}
      value={value}
      onValue={setValue}
    />
  );
}
