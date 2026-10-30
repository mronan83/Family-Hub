'use client';

import { Avatar, type AvatarKey, Icon, Logo, type MemberColor } from '@familywise/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NAV_GROUPS } from '@/lib/admin-nav';
import { signOut } from './actions';

/** Who is signed in, as the menu shows them; null before they are linked to someone in the family. */
export interface NavWho {
  name: string;
  avatarKey: AvatarKey | null;
  color: MemberColor;
}

/** How many check-offs wait for a parent, to see; the button or link it is on says it in words. */
function Count({ n }: { n: number }) {
  return (
    <span className="fw-shell__count" aria-hidden>
      {n}
    </span>
  );
}

/**
 * [NFR-15][US-107] The admin app's one menu (WP-51, D-81). On a laptop it stays down the left of
 * every page; on a phone a Menu button opens it over the page, and Close or Escape shuts it. Today
 * carries how many check-offs wait for a parent.
 */
export function AdminNav({
  current,
  waiting,
  asks = 0,
  who,
}: {
  /** The menu item to mark (a page Settings holds marks Settings). */
  current: string;
  waiting: number;
  /** [MEAL-22] Grocery asks waiting for a parent, counted on Groceries (WP-107). */
  asks?: number;
  who: NavWho | null;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      menu.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const count = waiting > 0 ? waiting : null;
  const total = waiting + asks > 0 ? waiting + asks : null;
  // Today counts check-offs and lunch changes; Groceries the grocery asks.
  const countOf = (href: string) =>
    href === '/admin/today' ? count : href === '/admin/groceries' && asks > 0 ? asks : null;

  return (
    <header className="fw-shell">
      <div className="fw-shell__top">
        <Logo width={136} />
        <button
          ref={menu}
          type="button"
          className="fw-shell__menu"
          aria-expanded={open}
          aria-controls="admin-menu"
          aria-label={total ? `Menu, ${total} waiting for you` : undefined}
          onClick={() => setOpen(true)}
        >
          <Icon name="menu" size={22} />
          Menu
          {total ? <Count n={total} /> : null}
        </button>
      </div>
      <nav
        id="admin-menu"
        aria-label="Admin"
        className="fw-shell__nav"
        data-open={open || undefined}
      >
        <div className="fw-shell__head">
          <Logo width={168} />
          <button
            ref={close}
            type="button"
            className="fw-shell__close"
            onClick={() => {
              setOpen(false);
              menu.current?.focus();
            }}
          >
            <Icon name="close" size={22} />
            Close
          </button>
        </div>
        {NAV_GROUPS.map((g) => (
          <div key={g.label} className="fw-shell__group" role="group" aria-label={g.label}>
            <p className="fw-shell__label" aria-hidden>
              {g.label}
            </p>
            <ul className="fw-shell__list" data-pages={g.pages.length}>
              {g.pages.map((p) => (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    className="fw-shell__link"
                    aria-current={p.href === current ? 'page' : undefined}
                    aria-label={
                      countOf(p.href) ? `${p.label}, ${countOf(p.href)} waiting for you` : undefined
                    }
                    onClick={() => setOpen(false)}
                  >
                    <Icon name={p.icon} size={22} />
                    <span className="fw-shell__text">{p.label}</span>
                    {countOf(p.href) ? <Count n={countOf(p.href)!} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="fw-shell__foot">
          <Link href="/help" className="fw-shell__link">
            <Icon name="book-open" size={22} />
            <span className="fw-shell__text">Help</span>
          </Link>
          <div className="fw-shell__who">
            {who ? (
              <>
                <Avatar
                  name={who.name}
                  avatarKey={who.avatarKey}
                  color={who.color}
                  size={36}
                  decorative
                />
                <span className="fw-shell__name">{who.name}</span>
              </>
            ) : (
              <span className="fw-shell__name" />
            )}
            <form action={signOut}>
              <button type="submit" className="fw-shell__out">
                <Icon name="logout" size={20} />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </nav>
    </header>
  );
}
