import { Logo } from '@familywise/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadHelp } from '@/lib/help';
import { HelpDiagrams } from './diagrams';

export const metadata: Metadata = {
  title: 'Help',
  description: 'How to set up and use FamilyWise: the user guide and manual.',
};

// Built once, from docs/07-user-guide.md, when the app is built (D-72).
export const dynamic = 'force-static';

/**
 * [D-72] Help: the user guide and manual, in the app. Open to anyone, signed in or not, so a parent
 * setting up a household can read it before they have an account; it holds the made-up demo family
 * only. The admin menu, sign-in and setup link here.
 */
export default function HelpPage() {
  const { version, html } = loadHelp();
  return (
    <main className="fw-page fw-help">
      <header className="fw-bar">
        <Logo />
        <Link href="/admin" className="fw-help__back">
          Back to FamilyWise
        </Link>
      </header>
      <h1>Help</h1>
      <p className="fw-muted">
        The FamilyWise user guide and manual{version ? `, version ${version}` : ''}. Part A walks
        through each task; Part B is the reference for every page and screen.
      </p>
      <article className="fw-help__body" dangerouslySetInnerHTML={{ __html: html }} />
      <HelpDiagrams />
    </main>
  );
}
