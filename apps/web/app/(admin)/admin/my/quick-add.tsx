'use client';

import { Button } from '@familywise/ui';
import { useFormStatus } from 'react-dom';
import { quickAdd } from '../today/actions';

function Add() {
  // Off while saving, so a double tap adds one task.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" icon="plus" disabled={pending}>
      Add
    </Button>
  );
}

/** [CHR-14][US-316] Quick add: type a title, and it is a task for me today. */
export function QuickAdd() {
  return (
    <form action={quickAdd} className="fw-form" aria-label="Quick add">
      <label className="fw-field">
        <span className="fw-field__label">Add a task for today</span>
        <input
          className="fw-input"
          name="title"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Pick up the dry cleaning"
        />
      </label>
      <div className="fw-actions">
        <Add />
      </div>
    </form>
  );
}
