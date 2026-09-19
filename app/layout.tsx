import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vulpine Cabinet AutoBidder',
  description: 'Production convergence App Router migration for cabinet estimating workflows.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
