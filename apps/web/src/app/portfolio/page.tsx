'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useServerClock } from '@/lib/mock/clock';
import { useMockStore } from '@/lib/mock/store';
import { formatUSD, money, toMoneyString, sub } from '@pullvault/shared/money';

import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';

type SortMode = 'newest' | 'highest' | 'gainer';

function rarityRank(r: string) {
  switch (r) {
    case 'common':
      return 0;
    case 'uncommon':
      return 1;
    case 'rare':
      return 2;
    case 'ultra_rare':
      return 3;
    case 'secret_rare':
      return 4;
    default:
      return 99;
  }
}

export default function PortfolioPage() {
  useServerClock();
  const userCards = useMockStore((s) => s.userCards);
  const meId = useMockStore((s) => s.me.id);
  const [sort, setSort] = useState<SortMode>('highest');

  const cards = useMemo(
    () => userCards.filter((uc) => uc.ownerId === meId && uc.status === 'held'),
    [userCards, meId],
  );

  const totalValueUSD = useMemo(() => {
    return toMoneyString(cards.reduce((acc, c) => acc.plus(money(c.marketPriceUSD)), money(0)));
  }, [cards]);

  const unrealizedPnlUSD = useMemo(() => {
    return toMoneyString(
      cards.reduce((acc, c) => acc.plus(money(c.marketPriceUSD).minus(money(c.acquiredPriceUSD))), money(0)),
    );
  }, [cards]);

  const filteredSorted = useMemo(() => {
    const list = [...cards];
    if (sort === 'highest') {
      list.sort((a, b) => money(b.marketPriceUSD).minus(money(a.marketPriceUSD)).toNumber());
    } else if (sort === 'gainer') {
      list.sort((a, b) => money(b.marketPriceUSD).minus(b.acquiredPriceUSD).minus(money(a.marketPriceUSD).minus(a.acquiredPriceUSD)).toNumber());
    } else {
      list.sort((a, b) => new Date(b.acquiredAt).getTime() - new Date(a.acquiredAt).getTime());
    }
    return list;
  }, [cards, sort]);

  const byRarity = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of cards) map[c.rarity] = (map[c.rarity] ?? 0) + 1;
    return map;
  }, [cards]);

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
          <div className="space-y-3">
            <MonoLabel>Your portfolio</MonoLabel>
            <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Card net worth</h1>
            <p className="text-bodyLarge text-ink/70">
              Live valuation from the mock catalog. Actions update state instantly.
            </p>
          </div>

          <div className="rounded-lg border border-cardBorder bg-paleGreenWash p-6 w-full lg:w-auto">
            <div className="text-micro text-mutedSlate">Total value</div>
            <div className="mt-2 font-display text-sectionHeading">{formatUSD(totalValueUSD)}</div>
            <div className={`mt-1 text-micro ${money(unrealizedPnlUSD).gt(0) ? 'text-deepEnterpriseGreen' : money(unrealizedPnlUSD).lt(0) ? 'text-errorRed' : 'text-mutedSlate'}`}>
              24h delta (mock P&L): {money(unrealizedPnlUSD).gt(0) ? '+' : ''}
              {formatUSD(unrealizedPnlUSD)}
            </div>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex flex-wrap gap-3">
              <SortButton active={sort === 'newest'} onClick={() => setSort('newest')}>
                Newest
              </SortButton>
              <SortButton active={sort === 'highest'} onClick={() => setSort('highest')}>
                Highest value
              </SortButton>
              <SortButton active={sort === 'gainer'} onClick={() => setSort('gainer')}>
                Biggest gainer
              </SortButton>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-4">
              {filteredSorted.map((c) => {
                const pnl = money(c.marketPriceUSD).minus(c.acquiredPriceUSD);
                const pnlTone =
                  pnl.gt(0) ? 'text-deepEnterpriseGreen' : pnl.lt(0) ? 'text-errorRed' : 'text-mutedSlate';
                return (
                  <div key={c.userCardId} className="rounded-lg border border-cardBorder bg-canvas overflow-hidden">
                    <div className="relative h-36 w-full bg-stone">
                      <Image src={c.imageUrl} alt={c.name} fill className="object-cover" />
                    </div>
                    <div className="p-5 space-y-3">
                      <div className="space-y-1">
                        <div className="text-featureHeading font-semibold text-ink">{c.name}</div>
                        <div className="text-micro text-mutedSlate">
                          {c.set} • {c.rarity.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-micro text-mutedSlate">Market</div>
                        <div className="text-micro font-semibold text-ink">{formatUSD(c.marketPriceUSD)}</div>
                      </div>
                      <div className={`text-micro font-semibold ${pnlTone}`}>
                        {pnl.gt(0) ? '+' : ''}
                        {formatUSD(toMoneyString(pnl))}
                      </div>
                      <div>
                        <Link
                          href={`/portfolio/${c.userCardId}`}
                          className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                        >
                          View details
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-cardBorder bg-canvas p-6">
              <MonoLabel>Rarity breakdown</MonoLabel>
              <div className="mt-4 space-y-3">
                {Object.entries(byRarity).length === 0 ? (
                  <div className="text-bodyLarge text-ink/70">No cards yet.</div>
                ) : (
                  Object.entries(byRarity)
                    .sort((a, b) => rarityRank(b[0]) - rarityRank(a[0]))
                    .map(([rarity, count]) => (
                      <div key={rarity} className="flex items-center justify-between gap-4">
                        <div className="text-micro text-mutedSlate">{rarity.replace('_', ' ')}</div>
                        <div className="text-micro font-semibold text-ink">{count}</div>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-cardBorder bg-paleBlueWash p-6">
              <div className="text-featureHeading font-semibold">Next actions</div>
              <p className="mt-2 text-bodyLarge text-ink/70">
                Pick a card to list for sale or start a live auction. The mock state engine enforces
                card status rules.
              </p>
              <div className="pt-4">
                <Link href="/marketplace" className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                  Go to marketplace
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function SortButton({ active, children, onClick }: { active: boolean; children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill border px-5 py-2.5 text-button font-semibold transition-colors ${
        active ? 'border-coral bg-coral text-nearBlack' : 'border-nearBlack/15 bg-transparent text-nearBlack/80 hover:border-nearBlack/30 hover:bg-nearBlack/[0.03]'
      }`}
    >
      {children}
    </button>
  );
}

