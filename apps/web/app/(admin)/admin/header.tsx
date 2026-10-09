import { Button, Logo } from '@familywise/ui';
import Link from 'next/link';
import { signOut } from './actions';

const LINKS = [
  { href: '/admin', label: 'Home' },
  { href: '/admin/members', label: 'Members' },
] as const;

/** The admin app's header: logo, sections, sign out. `current` marks the page you are on. */
export function AdminHeader({ current }: { current: (typeof LINKS)[number]['href'] }) {
  return (
    <header className="fw-bar">
      <Logo />
      <nav aria-label="Admin" className="fw-actions">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.href === current ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <form action={signOut}>
        <Button type="submit" variant="ghost" icon="logout">
          Sign out
        </Button>
      </form>
    </header>
  );
}
