'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo, useState, useEffect } from 'react';

import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';
import { formatUSD } from '@pullvault/shared/money';

function useLiveClock(intervalMs = 250) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

interface AuctionRow {
  auctionId: string;
  sellerHandle: string;
  startingBidUSD: string;
  currentHighBidUSD: string | null;
  endAt: string;
  extensions: number;
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

export default function AuctionsPage() {
  const nowMs = useLiveClock();
  const [auctions, setAuctions] = useState<AuctionRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auctions')
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data.auctions) {
          setAuctions(json.data.auctions);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const sorted = [...auctions].sort(
      (a, b) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime(),
    );
    return sorted.map((a) => {
      const endMs = new Date(a.endAt).getTime();
      const leftMs = endMs - nowMs;
      const endLabel = a.status === 'settled' ? 'Settled' : `Ends in ${formatMmSs(leftMs)}`;
      return { a, leftMs, endLabel };
    });
  }, [auctions, nowMs]);

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-7xl">
          <MonoLabel>Loading auctions...</MonoLabel>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Auctions</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Live rooms, server-authoritative timers.</h1>
          <p className="text-bodyLarge text-ink/70">
            Place bids, watch extensions, and see state settle deterministically.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-cardBorder bg-paleBlueWash p-8 text-bodyLarge text-ink/70">
            No active auctions. Start one from your portfolio.
          </div>
        ) : (
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
                        High bid: {a.currentHighBidUSD ? formatUSD(a.currentHighBidUSD) : formatUSD(a.startingBidUSD)}
                      </div>
                    </div>
                  }
                  right={<MonoLabel>{endLabel}</MonoLabel>}
                />
              </Link>
            ))}
          </ResearchTable>
        )}
      </div>
    </section>
  );
}
