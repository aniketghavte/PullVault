import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="space-y-10">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">
          Pull<span className="text-vault-accent">Vault</span>
        </h1>
        <nav className="flex gap-4 text-sm text-gray-300">
          <Link href="/drops">Drops</Link>
          <Link href="/marketplace">Marketplace</Link>
          <Link href="/auctions">Auctions</Link>
          <Link href="/portfolio">Portfolio</Link>
          <Link href="/admin/economics">Admin</Link>
        </nav>
      </header>

      <section className="rounded-2xl border border-vault-border bg-vault-surface p-8 backdrop-blur">
        <h2 className="text-2xl font-semibold">Buy a pack. Rip it open. Build a collection.</h2>
        <p className="mt-3 max-w-2xl text-gray-400">
          Compete for limited pack drops, see real Pokemon TCG market values, trade with other
          collectors, and battle for cards in live auctions with anti-snipe protection.
        </p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/drops"
            className="rounded-lg bg-vault-accent px-5 py-2.5 font-semibold text-vault-bg hover:brightness-110"
          >
            See upcoming drops
          </Link>
          <Link
            href="/auctions"
            className="rounded-lg border border-vault-border px-5 py-2.5 hover:bg-vault-card"
          >
            Browse live auctions
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { t: 'Pack Drops', d: 'Limited inventory at scheduled times. First come, first served.' },
          { t: 'Live Auctions', d: 'Server-authoritative timer. Anti-snipe extensions.' },
          { t: 'Atomic Trades', d: 'Card and money move together, or not at all.' },
        ].map((c) => (
          <div key={c.t} className="rounded-xl border border-vault-border bg-vault-card p-5">
            <h3 className="font-semibold">{c.t}</h3>
            <p className="mt-1 text-sm text-gray-400">{c.d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
