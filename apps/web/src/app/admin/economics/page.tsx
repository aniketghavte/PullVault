'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { PACK_TIERS, PLATFORM } from '@pullvault/shared/constants';
import { money, toMoneyString } from '@pullvault/shared/money';

import { mockApi } from '@/lib/mock/api';

import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';

export default function AdminEconomicsPage() {
  const [summary, setSummary] = useState<null | Awaited<ReturnType<typeof mockApi.economics.summary>>>(null);

  useEffect(() => {
    mockApi.economics.summary().then((res) => {
      if (res.ok) setSummary(res);
    });
  }, []);

  const data = summary?.ok ? summary.data : null;

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Admin</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Platform economics</h1>
          <p className="text-bodyLarge text-ink/70">
            Expected value per tier + simulated fee revenue from the mock ledger.
          </p>
        </div>

        <DarkFeatureBand tone="green" className="rounded-lg border border-cardBorder">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="text-featureHeading font-semibold">Revenue streams (mock)</div>
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
          </div>
        </DarkFeatureBand>

        <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <MonoLabel>EV per tier</MonoLabel>
            <div className="text-micro text-mutedSlate">Computed from current mock catalog snapshot</div>
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

