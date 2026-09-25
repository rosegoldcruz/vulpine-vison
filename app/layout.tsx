import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vulpine Cabinet Brain',
  description: 'Controlled cabinet estimating, plan evidence, review, QA, and backoffice operations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
