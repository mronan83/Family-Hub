'use client';
// [NFR-16][D-128] A date or a time written as the approved mockups write it (WP-101): "Mon, Oct 12,
// 2026" and "6:00 pm", in place of the browser's own "10/12/2026" or "6:00 PM". It stays a real date
// or time field: the field covers the written words, see-through, so a tap opens the phone's own
// picker (iPhone Safari opens it on any tap on the field), and a click on a computer opens it too.
//
// The field's value is never its default: an iPhone's picker puts a date field back to its default,
// so a default of the saved date made the picker's clear do nothing (D-115). The server renders the
// default so a form posted before hydration still sends it; the first mount sets it as the value.
import { type Ref, useCallback, useRef, useSyncExternalStore } from 'react';
import { dateWords, timeWords } from './date-words';
import { Icon } from './Icon';

export interface DatePickProps {
  type: 'date' | 'time';
  name: string;
  /** The field's name for screen readers (its label's words). */
  label: string;
  /** What it holds now, for the written words; the parent keeps it from `onValue`. */
  value: string;
  /** What it holds when the form first shows. */
  initial: string;
  onValue?: (value: string) => void;
  required?: boolean;
  min?: string;
  /** The words shown while it is empty. */
  empty?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/** Nothing to subscribe to: useSyncExternalStore here only tells hydration from after it. */
const noChange = () => () => {};

export function DatePick({
  type,
  name,
  label,
  value,
  initial,
  onValue,
  required,
  min,
  empty = type === 'date' ? 'Choose a date' : 'Choose a time',
  inputRef,
  className,
}: DatePickProps) {
  const hydrating = useSyncExternalStore(
    noChange,
    () => false,
    () => true,
  );
  const seeded = useRef(false);
  const field = useCallback(
    (el: HTMLInputElement | null) => {
      if (el && !seeded.current) {
        seeded.current = true;
        el.value = initial;
      }
      if (typeof inputRef === 'function') inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [initial, inputRef],
  );
  const words = type === 'date' ? dateWords(value) : timeWords(value);
  return (
    <span
      className={`fw-pick${className ? ` ${className}` : ''}`}
      data-empty={words ? undefined : 'true'}
    >
      <span className="fw-input fw-pick__face" aria-hidden="true">
        <span className="fw-pick__words">{words || empty}</span>
        <Icon name={type === 'date' ? 'calendar' : 'clock'} size={20} />
      </span>
      <input
        ref={field}
        className="fw-pick__input"
        type={type}
        name={name}
        aria-label={label}
        required={required}
        min={min}
        step={type === 'time' ? 60 : undefined}
        defaultValue={hydrating ? initial : undefined}
        onChange={(e) => onValue?.(e.target.value)}
        onClick={(e) => {
          // A computer's browser opens its picker only from its own button; open it on any click.
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // Already open, or not allowed here: the field still takes typing.
          }
        }}
      />
    </span>
  );
}
