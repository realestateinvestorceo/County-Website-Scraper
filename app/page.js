import ScrapeForm from '@/components/ScrapeForm';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          Probate Scraper
        </h1>
        <p className="mt-2 text-gray-600">
          Search NY Surrogate Court probate petitions, extract decedent and
          executor information, and filter by estate value.
        </p>
      </div>

      {/* Main Form + Results */}
      <ScrapeForm />
    </main>
  );
}
