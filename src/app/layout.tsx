import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Dr. Susheel's Advanced Dental Clinic - Patient Management System",
  description: 'Clinical Patient Management & Dental Records Console',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#f8fafc] text-[#151a22] antialiased">
        {children}
      </body>
    </html>
  );
}
