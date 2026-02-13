import './globals.css';

export const metadata = {
  title: 'Probate Scraper - NY Surrogate Court',
  description:
    'Search NY Surrogate Court probate petitions, extract decedent/executor info, filter by estate value.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
