import { Button, Logo } from '@familywise/ui';
import Link from 'next/link';
import { signOut } from './actions';

const LINKS = [
  { href: '/admin', label: 'Home' },
  { href: '/admin/today', label: 'Today' },
  { href: '/admin/my', label: 'My tasks' },
  { href: '/admin/reminders', label: 'Reminders' },
  { href: '/admin/chores', label: 'Chores' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/rewards', label: 'Rewards' },
  { href: '/admin/goals', label: 'Goals' },
  { href: '/admin/insights', label: 'Insights' },
  { href: '/admin/school', label: 'School' },
  { href: '/admin/devices', label: 'Boards' },
  { href: '/admin/health', label: 'Health' },
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
