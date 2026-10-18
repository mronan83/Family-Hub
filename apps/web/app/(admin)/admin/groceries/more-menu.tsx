'use client';

import { Icon } from '@familywise/ui';
import { type ReactNode, useEffect, useRef } from 'react';

/**
 * [MEAL-18] An item's ⋯ (WP-104): the browser's own <details>, closed once a choice in it is made,
 * on Escape, or on a tap anywhere else, so it never stays open over the list.
 */
export function MoreMenu({
  label,
  open,
  children,
}: {
  label: string;
  open?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !d.contains(e.target as Node))
        d.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);
  return (
    <details ref={ref} className="fw-groc__more" open={open || undefined}>
      <summary className="fw-groc__morebtn" aria-label={label}>
        <Icon name="more" />
      </summary>
      <div
        className="fw-groc__menu"
        onClick={(e) => {
          // After the choice has done its work: the link's navigation or the form's submit.
          if ((e.target as Element).closest('a, button'))
            setTimeout(() => {
              if (ref.current) ref.current.open = false;
            });
        }}
      >
        {children}
      </div>
    </details>
  );
}
