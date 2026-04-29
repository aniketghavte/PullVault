'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PACK_TIERS, PLATFORM } from '@pullvault/shared/constants';
import { money, toMoneyString } from '@pullvault/shared/money';

import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';

export default function AdminEconomicsPage() {
  const [data, setData] = useState<{
    packEVByTier: Record<
      string,
      {
        tierName: string;
        evPerPackUSD: string;
        evPerCardUSD: string;
        houseMarginUSD: string;
      }
    >;
    tradeFeeRevenueUSD: string;
    auctionFeeRevenueUSD: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/economics', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok) {
          setData(json.data);
        } else {
          setError(json.error?.message ?? 'Failed to load economics');
        }
      })
      .catch(() => setError('Failed to load economics'));
  }, []);

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Admin</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Platform economics</h1>
          <p className="text-bodyLarge text-ink/70">
            Expected value per tier + fee revenue computed from real ledger data.
          </p>
        </div>

        <DarkFeatureBand tone="green" className="rounded-lg border border-cardBorder">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="text-featureHeading font-semibold">Revenue streams (real)</div>
                <div className="text-bodyLarge text-canvas/85 mt-2">
                  Trade fee: <span className="font-semibold">{toMoneyString(money(PLATFORM.TRADE_FEE_RATE))}</span> rate
                  • Auction fee: <span className="font-semibold">{toMoneyString(money(PLATFORM.AUCTION_FEE_RATE))}</span> rate
                </div>
              </div>
              <div className="flex gap-3">
                <Link href="/admin/catalog">
                  <ButtonPrimary>Refresh catalog</ButtonPrimary>
                </Link>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <RevenueCard label="Trade platform fee revenue" value={data?.tradeFeeRevenueUSD ?? '0.00'} />
              <RevenueCard label="Auction platform fee revenue" value={data?.auctionFeeRevenueUSD ?? '0.00'} />
            </div>
            {error ? (
              <div className="rounded-lg border border-coral/40 bg-coral/10 p-4 text-body text-canvas">
                {error}
              </div>
            ) : null}
          </div>
        </DarkFeatureBand>

        <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <MonoLabel>EV per tier</MonoLabel>
            <div className="text-micro text-mutedSlate">Computed from `cards.market_price_usd` + tier rarity weights</div>
          </div>

          <ResearchTable>
            {PACK_TIERS.map((tier) => {
              const row = data?.packEVByTier?.[tier.code];
              const evPerPackUSD = row?.evPerPackUSD ?? '0.00';
              const evPerCardUSD = toMoneyString(money(evPerPackUSD).dividedBy(tier.cardsPerPack));
              const marginUSD = row?.houseMarginUSD ?? '0.00';
              return (
                <ResearchTableRow
                  key={tier.code}
                  left={<span className="text-body font-semibold text-ink">{tier.name}</span>}
                  center={<span className="text-body text-ink/80">{evPerCardUSD}/card</span>}
                  right={
                    <span className="text-body font-semibold text-ink">
                      EV/pack {evPerPackUSD} • margin {marginUSD}
                    </span>
                  }
                />
              );
            })}
          </ResearchTable>
        </div>
      </div>
    </section>
  );
}

function RevenueCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-canvas/15 bg-canvas/5 p-5">
      <div className="text-micro text-canvas/70">{label}</div>
      <div className="mt-2 font-display text-sectionHeading tracking-tight leading-none">{value}</div>
    </div>
  );
}

