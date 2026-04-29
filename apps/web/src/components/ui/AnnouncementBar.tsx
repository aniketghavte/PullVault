'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

function getTechnicalNote(pathname: string) {
  if (pathname.startsWith('/drops')) {
    return 'Drops: Atomic Postgres transaction handles balance debits and inventory decrements to prevent overselling under extreme concurrency.';
  }
  if (pathname.startsWith('/packs')) {
    return 'Reveal: Pack contents are securely drawn server-side at purchase time. Displays real TCGPlayer market values.';
  }
  if (pathname.startsWith('/portfolio')) {
    return 'Portfolio: Live valuations update instantly via Socket.io price:tick events pushed by the backend price engine.';
  }
  if (pathname.startsWith('/marketplace')) {
    return 'Marketplace: Trades use atomic SQL transactions (FOR UPDATE). Moving money and card ownership cannot fall out of sync.';
  }
  if (pathname.startsWith('/auctions')) {
    return 'Auctions: Realtime WebSocket rooms with server-authoritative timers. Bids use row-level locks and auto-extend for anti-snipe.';
  }
  if (pathname.startsWith('/admin/economics')) {
    return 'Economics: Real pack EV calculated vs live prices. Revenue is queried directly from double-entry ledger fee receipts.';
  }
  
  // Default for home or other pages
  return 'PullVault: Built with Next.js, Postgres (Drizzle), Redis, BullMQ, and Socket.io for realtime concurrency.';
}

export function AnnouncementBar({ className }: { className?: string }) {
  const [open, setOpen] = useState(true);
  const pathname = usePathname();
  
  if (!open) return null;

  const note = getTechnicalNote(pathname || '/');

  return (
    <div
      className={cn(
        'w-full bg-nearBlack text-canvas',
        'h-auto min-h-9 py-2 flex items-center justify-center',
        className,
      )}
    >
      <div className="flex items-start sm:items-center gap-3 px-4 w-full">
        <div className="flex-1 text-center text-micro leading-snug">
          <span className="font-semibold text-coral uppercase tracking-wider mr-2 text-[10px]">Developer Note</span>
          {note}
        </div>

        <button
          type="button"
          aria-label="Close announcement"
          onClick={() => setOpen(false)}
          className="rounded-sm px-2 py-0.5 text-canvas/80 hover:text-canvas shrink-0"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
