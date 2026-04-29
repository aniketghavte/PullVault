'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { useMockStore } from '@/lib/mock/store';
import { useServerClock } from '@/lib/mock/clock';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';
import Image from 'next/image';
import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export default function AuctionsPage() {
  useServerClock({ syncMockEngine: true });
  const auctions = useMockStore((s) => s.auctions);

  const rows = useMemo(() => {
    const now = Date.now();
    const sorted = [...auctions].sort((a, b) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime());
    return sorted.map((a) => {
      const endMs = new Date(a.endAt).getTime();
      const leftMs = endMs - now;
      const endLabel = a.status === 'settled' ? 'Settled' : `Ends in ${formatMmSs(leftMs)}`;
      return { a, leftMs, endLabel };
    });
  }, [auctions]);

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Auctions</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Live rooms, server-authoritative timers.</h1>
          <p className="text-bodyLarge text-ink/70">
            Place bids, watch extensions, and see state settle deterministically in the mock engine.
          </p>
        </div>

        <ResearchTable>
          {rows.map(({ a, endLabel }) => (
            <Link
              key={a.auctionId}
              href={`/auctions/${a.auctionId}`}
              className="block"
            >
              <ResearchTableRow
                left={
                  <div className="flex items-center gap-4">
                    <div className="relative h-14 w-14 rounded-sm overflow-hidden border border-cardBorder bg-stone">
                      <Image src={a.card.imageUrl} alt={a.card.name} fill className="object-cover" />
                    </div>
                    <div className="space-y-1">
                      <div className="text-body font-semibold text-ink">{a.card.name}</div>
                      <div className="text-micro text-mutedSlate">{a.card.set}</div>
                    </div>
                  </div>
                }
                center={
                  <div className="space-y-2">
                    <div className="text-body font-semibold text-ink/90">
                      {a.status === 'live' || a.status === 'extended' ? 'Live' : 'Settled'}
                    </div>
                    <div className="text-micro text-mutedSlate">
                      High bid: {formatUSD(a.currentHighBidUSD)}
                    </div>
                  </div>
                }
                right={<MonoLabel>{endLabel}</MonoLabel>}
              />
            </Link>
          ))}
        </ResearchTable>
      </div>
    </section>
  );
}

