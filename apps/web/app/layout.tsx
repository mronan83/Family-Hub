import '@familywise/ui/ui.css';
import { BRAND_COLORS } from '@familywise/ui';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { preload } from 'react-dom';
import { ServiceWorker } from './service-worker';

// App identity (06 §9). Icons, fonts, manifests and the service worker are built from brand/ into
// public/ by packages/ui/scripts/brand.mjs before dev and build.
export const metadata: Metadata = {
  title: { default: 'FamilyWise', template: '%s · FamilyWise' },
  description: 'The family board for chores, rewards, and the week ahead.',
  applicationName: 'FamilyWise',
  icons: {
    icon: [
      { url: '/icons/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/favicon.ico', sizes: '48x48' },
    ],
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: BRAND_COLORS.primary },
    { media: '(prefers-color-scheme: dark)', color: BRAND_COLORS.eveningBackground },
  ],
};

const FIRST_PAINT_FONTS = [
  'nunito-latin-700-normal',
  'nunito-latin-800-normal',
  'inter-latin-400-normal',
];

export default function RootLayout({ children }: { children: ReactNode }) {
  for (const font of FIRST_PAINT_FONTS) {
    preload(`/brand/fonts/${font}.woff2`, { as: 'font', type: 'font/woff2', crossOrigin: '' });
  }
  return (
    // The theme boot scripts set data-theme before hydration.
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Served from /brand with stable URLs so the service worker can precache the fonts. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/brand/fonts.css" precedence="default" />
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
