// Board boot and pairing surface (06 §9): always Evening, stacked reversed logo, one short line.
import { Logo } from './Logo';

export function BootSplash({ message = 'Getting your day ready' }: { message?: string }) {
  return (
    <main className="fw-splash theme-evening">
      <Logo lockup="stacked" width={320} />
      <h1 className="fw-splash__message">{message}</h1>
    </main>
  );
}
