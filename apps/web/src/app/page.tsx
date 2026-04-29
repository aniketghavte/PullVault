'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { mockApi } from '@/lib/mock/api';
import type { Drop } from '@/lib/mock/types';

import { AnnouncementBar } from '../components/ui/AnnouncementBar';
import { AgentConsoleCard } from '../components/ui/AgentConsoleCard';
import { CapabilityCard } from '../components/ui/CapabilityCard';
import { DarkFeatureBand } from '../components/ui/DarkFeatureBand';
import { HeroPhotoCard } from '../components/ui/HeroPhotoCard';
import { ProductCard } from '../components/ui/ProductCard';
import { TrustLogoStrip } from '../components/ui/TrustLogoStrip';
import { ButtonPrimary } from '../components/ui/ButtonPrimary';

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export default function HomePage() {
  const [drops, setDrops] = useState<Drop[]>([]);
  const now = Date.now();

  useEffect(() => {
    mockApi.drops.list().then((res) => {
      if (res.ok) setDrops(res.data);
    });
  }, []);

  const nextDrops = useMemo(() => {
    const sorted = [...drops].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    return sorted.slice(0, 3);
  }, [drops]);

  return (
    <main className="w-full">
      <section className="px-4 pt-14 pb-10">
        <div className="mx-auto w-full max-w-7xl">
          <div className="text-center space-y-6">
            <div className="font-display text-hero leading-none tracking-tight">
              Pull<span className="text-coral">Vault</span>
            </div>
            <p className="mx-auto max-w-2xl text-bodyLarge text-ink/70">
              Buy packs, reveal cards with real market value, trade with atomic safety, and watch
              live auctions with anti-snipe protection.
            </p>
            <div className="flex justify-center gap-4 pt-2">
              <Link href="/drops" className="rounded-pill bg-nearBlack px-8 py-3 text-button font-semibold text-canvas hover:bg-black transition-colors">
                Explore drops
              </Link>
              <Link href="/auctions" className="rounded-pill border border-nearBlack/15 bg-transparent px-8 py-3 text-button font-semibold text-nearBlack hover:bg-nearBlack/[0.03] transition-colors">
                Browse auctions
              </Link>
            </div>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-2 items-stretch">
            <HeroPhotoCard className="min-h-[420px]">
              <div className="p-8 h-full flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
                    Agent console mock
                  </div>
                  <h2 className="font-display text-sectionHeading leading-tight tracking-tight">
                    Pack ripping, trade safety, live bidding.
                  </h2>
                  <p className="text-bodyLarge text-ink/70">
                    This environment is simulated end-to-end so you can click through every
                    user flow before we wire the real backend.
                  </p>
                </div>

                <div className="mt-10">
                  <AgentConsoleCard title="PackVault Console" status={{ label: 'LIVE (mock)', tone: 'green' }} badges={['Drop countdown', 'Reveal sequence', 'Auction timer']}>
                    <div className="space-y-2 text-bodyLarge text-canvas/90">
                      <div className="flex gap-3">
                        <span className="text-mutedSlate">Next action</span>
                        <span className="font-semibold">Buy a pack → reveal</span>
                      </div>
                      <div className="rounded-md border border-canvas/10 bg-canvas/5 p-3 text-body">
                        You’ll see commons first, rares last — with portfolio valuation updating
                        as cards are revealed.
                      </div>
                    </div>
                  </AgentConsoleCard>
                </div>
              </div>
            </HeroPhotoCard>

            <div className="space-y-6">
              <div className="rounded-lg border border-cardBorder bg-canvas p-8">
                <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">Drops this week</div>
                <div className="mt-4 space-y-3">
                  {nextDrops.map((d) => {
                    const scheduledMs = new Date(d.scheduledAt).getTime();
                    const left = scheduledMs - now;
                    const timeLabel = d.status === 'scheduled' ? formatMmSs(left) : d.status === 'live' ? 'Live' : 'Sold out';
                    return (
                      <ProductCard
                        key={d.dropId}
                        title={d.tierName}
                        subtitle={`${d.priceUSD} pack price • ${d.remaining}/${d.totalInventory} remaining`}
                      >
                        <div className="flex items-center justify-between gap-4 pt-2">
                          <div className="text-micro font-semibold text-mutedSlate">{timeLabel}</div>
                          <Link href={`/drops/${d.dropId}`} className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                            View
                          </Link>
                        </div>
                      </ProductCard>
                    );
                  })}
                </div>
              </div>

              <TrustLogoStrip className="pt-2" />
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-10">
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid gap-6 md:grid-cols-3">
            <CapabilityCard
              title="Pack drops"
              description="Limited inventory at scheduled times. Instant resolution: sold out is clear."
              href="/drops"
              linkLabel="See how it works"
            />
            <CapabilityCard
              title="Live auctions"
              description="Real-time competitive bidding with server-authoritative timers and anti-snipe extensions."
              href="/auctions"
              linkLabel="Enter an auction"
            />
            <CapabilityCard
              title="Atomic trades"
              description="A listing buy is simulated as an atomic transfer: card and money move together."
              href="/marketplace"
              linkLabel="Browse listings"
            />
          </div>
        </div>
      </section>

      <DarkFeatureBand tone="green">
        <div className="space-y-6 py-2">
          <div className="font-display text-sectionDisplay leading-none tracking-tight">
            Built for tension.
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-lg border border-cardBorder bg-white/40 p-6">
              <div className="text-featureHeading font-semibold">Countdown UX</div>
              <p className="mt-2 text-bodyLarge text-ink/70">
                Timers tick via a simulated server clock. Display is never guessed.
              </p>
            </div>
            <div className="rounded-lg border border-cardBorder bg-white/40 p-6">
              <div className="text-featureHeading font-semibold">Reveal flow</div>
              <p className="mt-2 text-bodyLarge text-ink/70">
                Cards reveal one at a time: commons first, rares last.
              </p>
            </div>
            <div className="rounded-lg border border-cardBorder bg-white/40 p-6">
              <div className="text-featureHeading font-semibold">Market valuation</div>
              <p className="mt-2 text-bodyLarge text-ink/70">
                Portfolio value uses the same catalog snapshot used for draws.
              </p>
            </div>
          </div>
        </div>
      </DarkFeatureBand>

      <section className="px-4 pt-14 pb-24">
        <div className="mx-auto w-full max-w-7xl rounded-lg border border-hairline bg-paleBlueWash p-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-3">
              <MonoInvite />
              <p className="text-bodyLarge text-ink/70">
                Start with a pack purchase, then follow the card into portfolio, marketplace, and auctions.
                Everything here is simulated UI backed by a mock state engine.
              </p>
            </div>
            <div className="flex gap-4">
              <Link href="/drops" className="rounded-pill bg-nearBlack px-8 py-3 text-button font-semibold text-canvas hover:bg-black transition-colors">
                Buy your first pack
              </Link>
              <Link href="/portfolio" className="rounded-pill border border-nearBlack/15 bg-transparent px-8 py-3 text-button font-semibold text-nearBlack hover:bg-nearBlack/[0.03] transition-colors">
                View portfolio
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function MonoInvite() {
  return (
    <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
      Real cards, real prices (simulated).
    </div>
  );
}
