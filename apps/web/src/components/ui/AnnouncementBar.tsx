'use client';

import { useState } from 'react';

import { cn } from '@/lib/cn';

export function AnnouncementBar({ className }: { className?: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <div
      className={cn(
        'w-full bg-nearBlack text-canvas',
        'h-9 flex items-center justify-center',
        className,
      )}
    >
      <div className="flex items-center gap-3 px-4 w-full">
        <div className="flex-1 text-center text-micro">
          New demo environment: mock packs, reveal, trading, and auctions.
          <a href="#"
            className="ml-2 underline decoration-canvas/40 underline-offset-4"
          >
            Learn more
          </a>
        </div>

        <button
          type="button"
          aria-label="Close announcement"
          onClick={() => setOpen(false)}
          className="rounded-sm px-2 py-1 text-canvas/80 hover:text-canvas"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

