import Link from 'next/link';

import { ButtonPrimary } from './ButtonPrimary';

export function SiteNav() {
  return (
    <header className="w-full border-b border-hairline bg-canvas/95 backdrop-blur">
      <div className="mx-auto w-full px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-nearBlack font-display text-bodyLarge font-semibold">
          Pull<span className="text-coral">Vault</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-micro">
          <Link href="/drops" className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4">
            Drops
          </Link>
          <Link href="/marketplace" className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4">
            Marketplace
          </Link>
          <Link href="/auctions" className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4">
            Auctions
          </Link>
          <Link href="/portfolio" className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4">
            Portfolio
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <Link href="/login" className="text-micro text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4">
            Sign in
          </Link>
          <ButtonPrimary href="/drops">Start trading</ButtonPrimary>
        </div>
      </div>
    </header>
  );
}

