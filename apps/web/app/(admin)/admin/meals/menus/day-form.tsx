'use client';

import { Banner, Button } from '@familywise/ui';
import type { FormState } from '@/lib/auth/messages';
import { useFormAction } from '@/lib/forms';
import type { MenuDay } from '@/lib/menu/nutrislice';
import { itemsText } from '@/lib/menus';
import { saveMenuDay } from './actions';

/**
 * [MENU-03][US-802] A day's lunch typed in or changed: its items, a line each ("Section: item" puts it
 * under a section), or no lunch that day with a note. Saved, it is the parent's own: a feed never
 * replaces it. Without `day`, it asks for the date too.
 */
export function MenuDayForm({ id, label, day }: { id: string; label: string; day?: MenuDay }) {
  const [state, onSubmit, pending] = useFormAction(saveMenuDay, {} as FormState);
  return (
    <form onSubmit={onSubmit} className="fw-form" aria-label={label}>
      <input type="hidden" name="id" value={id} />
      {day ? (
        <input type="hidden" name="date" value={day.date} />
      ) : (
        <label className="fw-field">
          <span className="fw-field__label">Day</span>
          <input className="fw-input" type="date" name="date" required />
        </label>
      )}
      <label className="fw-field">
        <span className="fw-field__label">What’s for lunch</span>
        <textarea
          className="fw-input"
          name="items"
          rows={4}
          defaultValue={day ? itemsText(day.items) : ''}
          placeholder={
            'Choice of Entree: Beef tacos or Chicken wrap with tortilla chips\nFruits & Vegetables: Corn or Orange\nChoice of Milk: 1% milk or Chocolate milk'
          }
        />
        <span className="fw-field__help">
          A section a line, its name and a colon first, like Choice of Milk: 1% milk or Chocolate
          milk. Write “or” between options and “with” before a side. A line with no section is an
          item of its own.
        </span>
      </label>
      <label className="fw-choice">
        <input type="checkbox" name="noService" defaultChecked={day?.noService ?? false} />
        No lunch that day
      </label>
      <label className="fw-field">
        <span className="fw-field__label">Note (optional)</span>
        <input
          className="fw-input"
          name="note"
          maxLength={120}
          defaultValue={day?.note ?? ''}
          placeholder="Presidents’ Day"
          autoComplete="off"
        />
      </label>
      {state.message ? <Banner kind="notice">{state.message}</Banner> : null}
      <div className="fw-actions">
        <Button type="submit" variant="secondary" disabled={pending} icon="check">
          {pending ? 'Saving…' : 'Save the day'}
        </Button>
      </div>
    </form>
  );
}
