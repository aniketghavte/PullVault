import Link from 'next/link';

import { SiteNavSession } from '@/components/auth/SiteNavSession';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function SiteNav() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sessionEmail = user?.email ?? null;

  return (
    <header className="w-full border-b border-hairline bg-canvas/95 backdrop-blur">
      <div className="mx-auto w-full px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-nearBlack font-display text-bodyLarge font-semibold shrink-0">
          Pull<span className="text-coral">Vault</span>
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-micro flex-1 justify-center">
          <Link
            href="/drops"
            className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
          >
            Drops
          </Link>
          <Link
            href="/marketplace"
            className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
          >
            Marketplace
          </Link>
          <Link
            href="/auctions"
            className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
          >
            Auctions
          </Link>
          <Link
            href="/portfolio"
            className="text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
          >
            Portfolio
          </Link>
        </nav>

        <div className="shrink-0">
          <SiteNavSession sessionEmail={sessionEmail} />
        </div>
      </div>
    </header>
  );
}
