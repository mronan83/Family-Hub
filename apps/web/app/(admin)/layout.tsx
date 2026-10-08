import { SystemThemeController, themeBootScript } from '@familywise/ui';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The admin app: its own manifest (standalone, any orientation, Home Screen on iPhone), admin type
// scale, and Day or Evening following the device's dark mode.
export const metadata: Metadata = {
  manifest: '/admin.webmanifest',
  appleWebApp: { capable: true, title: 'FamilyWise', statusBarStyle: 'default' },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin">
      <script dangerouslySetInnerHTML={{ __html: themeBootScript('admin') }} />
      <SystemThemeController />
      {children}
    </div>
  );
}
