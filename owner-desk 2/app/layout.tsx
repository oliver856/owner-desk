import './globals.css';
import type { Metadata, Viewport } from 'next';
import { themeMode } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Apex Owner Desk',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
  appleWebApp: { capable: true, title: 'Apex Desk', statusBarStyle: 'default' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = await themeMode();
  return (
    <html lang="en" data-theme={mode === 'system' ? undefined : mode}>
      <body>{children}</body>
    </html>
  );
}
