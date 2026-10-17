'use client';
// [NFR-16][D-127] A file picker drawn by the app (WP-100): a button and the chosen file's name, in place
// of the browser's own "Choose File · No file chosen", which iPhone Safari draws unstyled. The input is
// the form field, visually hidden inside the label, so a tap on the button opens the picker.
import { useState } from 'react';

export interface FileFieldProps {
  label: string;
  name: string;
  accept?: string;
  /** The button's words, e.g. "Choose a photo". */
  button: string;
  /** What shows before a file is chosen, e.g. "No photo chosen". */
  empty: string;
  help?: string;
}

export function FileField({ label, name, accept, button, empty, help }: FileFieldProps) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <div className="fw-field fw-file">
      <span className="fw-field__label" aria-hidden="true">
        {label}
      </span>
      <label className="fw-file__pick">
        <input
          type="file"
          name={name}
          accept={accept}
          aria-label={label}
          className="fw-visually-hidden"
          onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
        />
        <span className="fw-btn fw-btn--secondary" aria-hidden="true">
          {button}
        </span>
        <span className="fw-file__name" aria-live="polite">
          {file ?? empty}
        </span>
      </label>
      {help ? <span className="fw-field__help">{help}</span> : null}
    </div>
  );
}
