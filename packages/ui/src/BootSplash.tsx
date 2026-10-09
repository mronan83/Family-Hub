// Board boot and pairing surface (06 §9): always Evening, stacked reversed logo, one short line,
// and whatever the step needs below it (the pairing keypad).
import type { ReactNode } from 'react';
import { Logo } from './Logo';

export function BootSplash({
  message = 'Getting your day ready',
  children,
}: {
  message?: string;
  children?: ReactNode;
}) {
  return (
    <main className="fw-splash theme-evening">
      <Logo lockup="stacked" width={320} />
      <h1 className="fw-splash__message">{message}</h1>
      {children}
    </main>
  );
}
