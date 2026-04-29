'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';

import { BlogFilterChip } from '@/components/ui/BlogFilterChip';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';

type RarityFilter = 'all' | 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';

interface MarketplaceListing {
  listingId: string;
  userCardId: string;
  sellerId: string;
  sellerHandle: string;
  priceUSD: string;
  status: string;
  card: {
    id: string;
    name: string;
    set: string;
    rarity: string;
    imageUrl: string;
    marketPriceUSD: string;
  };
}

export default function MarketplacePage() {
  const [listings, setListings] = useState<MarketplaceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(res => res.json())
      .then(json => {
        if (json.ok && json.data.user) {
          setMeId(json.data.user.id);
        }
      });
  }, []);

  useEffect(() => {
    fetch('/api/listings')
      .then(res => res.json())
      .then(json => {
        if (json.ok && json.data.listings) {
          setListings(json.data.listings);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const [rarity, setRarity] = useState<RarityFilter>('all');

  const filtered = useMemo(() => {
    if (rarity === 'all') return listings;
    return listings.filter((l) => l.card.rarity === rarity);
  }, [listings, rarity]);

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-7xl">
          <MonoLabel>Loading marketplace...</MonoLabel>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Marketplace</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Trade for value.</h1>
          <p className="text-bodyLarge text-ink/70">
            Active listings from other collectors. Buy and sell securely.
          </p>
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <BlogFilterChip active={rarity === 'all'} onClick={() => setRarity('all')}>
            All
          </BlogFilterChip>
          <BlogFilterChip active={rarity === 'common'} onClick={() => setRarity('common')}>
            Common
          </BlogFilterChip>
          <BlogFilterChip active={rarity === 'uncommon'} onClick={() => setRarity('uncommon')}>
            Uncommon
          </BlogFilterChip>
          <BlogFilterChip active={rarity === 'rare'} onClick={() => setRarity('rare')}>
            Rare
          </BlogFilterChip>
          <BlogFilterChip active={rarity === 'ultra_rare'} onClick={() => setRarity('ultra_rare')}>
            Ultra
          </BlogFilterChip>
          <BlogFilterChip active={rarity === 'secret_rare'} onClick={() => setRarity('secret_rare')}>
            Secret
          </BlogFilterChip>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {filtered.map((listing) => {
            const card = listing.card;
            const sellerOwns = listing.sellerId === meId;
            const ask = money(listing.priceUSD);
            const market = money(card.marketPriceUSD);
            const delta = ask.minus(market);
            const tone =
              delta.gt(0) ? 'text-errorRed' : delta.lt(0) ? 'text-deepEnterpriseGreen' : 'text-mutedSlate';
            return (
              <div key={listing.listingId} className="rounded-lg border border-cardBorder bg-canvas overflow-hidden">
                <div className="relative h-40 w-full bg-stone">
                  <Image src={card.imageUrl} alt={card.name} fill className="object-cover" />
                </div>
                <div className="p-6 space-y-4">
                  <div>
                    <div className="text-featureHeading font-semibold text-ink">{card.name}</div>
                    <div className="text-micro text-mutedSlate">
                      {card.set} • {card.rarity.replace('_', ' ')}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-micro text-mutedSlate">Asking</div>
                      <div className="text-micro font-semibold text-ink">{formatUSD(listing.priceUSD)}</div>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div className="text-micro text-mutedSlate">Market</div>
                      <div className="text-micro font-semibold text-ink">{formatUSD(card.marketPriceUSD)}</div>
                    </div>
                    <div className={`text-micro font-semibold ${tone}`}>
                      {delta.gt(0) ? '+' : ''}
                      {formatUSD(toMoneyString(delta))}
                      <span className="text-micro text-mutedSlate font-normal"> vs market</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <Link href={`/marketplace/${listing.listingId}`} className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                      View
                    </Link>
                    {sellerOwns ? (
                      <ButtonPillOutline disabled>Yours</ButtonPillOutline>
                    ) : (
                      <ButtonPrimary href={`/marketplace/${listing.listingId}`} className="px-5 justify-center">
                        Buy
                      </ButtonPrimary>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-cardBorder bg-paleBlueWash p-8 text-bodyLarge text-ink/70">
            No active listings for this filter.
          </div>
        ) : null}
      </div>
    </section>
  );
}

