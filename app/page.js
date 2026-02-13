import ScrapeForm from '@/components/ScrapeForm';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">
            Probate Scraper
          </h1>
          <p className="mt-2 text-gray-600">
            Search NY Surrogate Court probate petitions, extract decedent and
            executor information, and filter by estate value.
          </p>
        </div>
        <a
          href="/logs"
          className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
        >
          Diagnostics &amp; Logs
        </a>
      </div>

      {/* Main Form + Results */}
      <ScrapeForm />
    </main>
  );
}
