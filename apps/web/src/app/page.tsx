'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AnnouncementBar } from '../components/ui/AnnouncementBar';
import { AgentConsoleCard } from '../components/ui/AgentConsoleCard';
import { CapabilityCard } from '../components/ui/CapabilityCard';
import { DarkFeatureBand } from '../components/ui/DarkFeatureBand';
import { HeroPhotoCard } from '../components/ui/HeroPhotoCard';
import { ProductCard } from '../components/ui/ProductCard';
import { TrustLogoStrip } from '../components/ui/TrustLogoStrip';
import { ButtonPrimary } from '../components/ui/ButtonPrimary';

export default function HomePage() {
  const [techDetails] = useState([
    {
      title: 'Core stack',
      body: 'Next.js 14 + TypeScript monorepo (apps/web, apps/realtime, packages/db, packages/shared), Supabase Postgres/Auth, Redis pub-sub, and Socket.io.',
    },
    {
      title: 'Data model',
      body: 'cards + card_prices for valuation, pack_drops + pack_purchases for supply/reveal, user_cards + listings + auctions for trading, and ledger_entries for monetary truth.',
    },
    {
      title: 'Realtime topology',
      body: 'Web publishes post-commit events to Redis channels; realtime subscribers fan-out to socket rooms. UI reconciles from API and receives live ticks via price:tick.',
    },
    {
      title: 'Correctness rules',
      body: 'Money uses decimal.js strings, write paths run in DB transactions with row/guard locking, and ledger rows are written in the same transaction as balance/card state changes.',
    },
  ]);

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
                    Agent console live
                  </div>
                  <h2 className="font-display text-sectionHeading leading-tight tracking-tight">
                    Pack ripping, trade safety, live bidding.
                  </h2>
                  <p className="text-bodyLarge text-ink/70">
                    This platform runs end-to-end on real backend flows so every click maps to
                    persisted data and realtime events.
                  </p>
                </div>

                <div className="mt-10">
                  <AgentConsoleCard title="PackVault Console" status={{ label: 'LIVE', tone: 'green' }} badges={['Drop countdown', 'Reveal sequence', 'Auction timer']}>
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
                <div className="text-monoLabel uppercase tracking-[0.28px] text-mutedSlate">
                  Technical details
                </div>
                <div className="mt-4 space-y-3">
                  {techDetails.map((item) => (
                    <ProductCard key={item.title} title={item.title} subtitle={item.body} />
                  ))}
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
              description="A listing buy executes as an atomic transfer: card and money move together."
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
                Timers are server-authoritative and stream live updates. Display is never guessed.
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
                Portfolio value comes from live market prices and updates through realtime ticks.
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
                Every step is backed by real APIs, database writes, and realtime events.
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4">
              <Link href="/drops" className="rounded-pill bg-nearBlack px-8 py-3 text-button font-semibold text-canvas hover:bg-black transition-colors text-center whitespace-nowrap">
                Buy your first pack
              </Link>
              <Link href="/portfolio" className="rounded-pill border border-nearBlack/15 bg-transparent px-8 py-3 text-button font-semibold text-nearBlack hover:bg-nearBlack/[0.03] transition-colors text-center whitespace-nowrap">
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
      Real cards, real prices.
    </div>
  );
}
