import type { Metadata } from 'next';
import { t } from '@/lib/messages';
import './globals.css';

export const metadata: Metadata = {
  title: `${t.siteName} — ${t.tagline}`,
  description: t.intro,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bs">
      <body className="bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
