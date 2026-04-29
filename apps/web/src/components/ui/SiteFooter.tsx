import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="w-full bg-nearBlack text-canvas mt-20">
      <div className="mx-auto w-full px-4 py-14">
        <div className="grid gap-10 md:grid-cols-3">
          <div className="space-y-4 md:col-span-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-coral/30 px-4 py-2 text-micro text-coral">
              AI moves fast
            </div>
            <h3 className="font-display text-sectionHeading text-canvas">
              Real cards, real prices.
            </h3>
            <p className="text-mutedSlate text-body">
              PullVault helps collectors track live market values, trade safely, and compete in
              auctions with server-authoritative timers.
            </p>
          </div>

          <div className="space-y-3 md:col-span-1">
            <div className="text-micro font-semibold text-canvas/90">Explore</div>
            <div className="space-y-2 text-body">
              <Link href="/drops" className="text-canvas/80 hover:text-canvas underline underline-offset-4 decoration-canvas/20">
                Pack drops
              </Link>
              <Link href="/marketplace" className="text-canvas/80 hover:text-canvas underline underline-offset-4 decoration-canvas/20">
                Marketplace
              </Link>
              <Link href="/auctions" className="text-canvas/80 hover:text-canvas underline underline-offset-4 decoration-canvas/20">
                Live auctions
              </Link>
            </div>
          </div>

          <div className="space-y-4 md:col-span-1">
            <div className="text-micro font-semibold text-canvas/90">Newsletter</div>
            <form className="flex items-center gap-2">
              <input
                type="email"
                placeholder="Email address"
                className="w-full rounded-pill border border-canvas/15 bg-transparent px-5 py-3 text-body outline-none"
              />
              <button
                type="button"
                className="rounded-pill bg-coral px-4 py-3 text-body font-semibold text-nearBlack"
              >
                →
              </button>
            </form>
            <p className="text-mutedSlate text-micro">
              No spam. Unsubscribe any time.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

