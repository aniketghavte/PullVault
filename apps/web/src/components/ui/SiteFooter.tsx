import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mt-20 w-full bg-nearBlack text-canvas">
      <div className="mx-auto w-full max-w-7xl px-4 py-14">
        <div className="grid gap-10 md:grid-cols-3 md:gap-12">
          <div className="space-y-4">
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

          <div className="space-y-4">
            <div className="text-micro font-semibold text-canvas/90">Explore</div>
            <div className="flex flex-col gap-2 text-body">
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

          <div className="space-y-4">
            <div className="text-micro font-semibold text-canvas/90">Project</div>
            <div className="flex flex-col gap-2 text-body">
              <a
                href="https://github.com/aniketghavte/PullVault/"
                target="_blank"
                rel="noreferrer"
                className="text-canvas/80 hover:text-canvas underline underline-offset-4 decoration-canvas/20"
              >
                GitHub
              </a>
              <Link
                href="/architecture"
                className="text-canvas/80 hover:text-canvas underline underline-offset-4 decoration-canvas/20"
              >
                Architecture
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

