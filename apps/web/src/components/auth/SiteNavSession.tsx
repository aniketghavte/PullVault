'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';
import { getSocket } from '@/lib/socket-client';

type Props = {
  /** From server `supabase.auth.getUser()` — never trust client-supplied identities for authz. */
  sessionEmail: string | null;
};

export function SiteNavSession({ sessionEmail }: Props) {
  const router = useRouter();
  const [availableBalance, setAvailableBalance] = useState<string | null>(null);
  const [cards, setCards] = useState<Array<{ cardId: string; marketPriceUSD: string; status: string }>>([]);

  const fetchPortfolio = useCallback(() => {
    if (!sessionEmail) return;
    fetch('/api/portfolio')
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data) {
          setAvailableBalance(json.data.availableBalanceUSD ?? '0.00');
          setCards(json.data.portfolio || []);
        }
      })
      .catch((err) => console.error('Failed to load balances:', err));
  }, [sessionEmail]);

  useEffect(() => {
    fetchPortfolio();
  }, [fetchPortfolio]);

  useEffect(() => {
    if (!sessionEmail) return;

    const socket = getSocket();
    if (!socket) return;

    // The server emits 'portfolio:invalidate' when balances or card inventory changes
    socket.on('portfolio:invalidate', fetchPortfolio);

    // Live price ticks — update card values without full refetch
    const handleTick = (payload: { ts?: string; cards?: Array<{ cardId: string; priceUSD: string }> }) => {
      const ticks = Array.isArray(payload?.cards) ? payload.cards : [];
      if (ticks.length === 0) return;

      const pricesByCardId = new Map<string, string>();
      for (const tick of ticks) {
        if (!tick?.cardId || !tick?.priceUSD) continue;
        pricesByCardId.set(tick.cardId, tick.priceUSD);
      }
      if (pricesByCardId.size === 0) return;

      setCards((prev) =>
        prev.map((c) => {
          const nextPrice = pricesByCardId.get(c.cardId);
          return nextPrice ? { ...c, marketPriceUSD: nextPrice } : c;
        })
      );
    };
    socket.on('price:tick', handleTick);

    return () => {
      socket.off('portfolio:invalidate', fetchPortfolio);
      socket.off('price:tick', handleTick);
    };
  }, [sessionEmail, fetchPortfolio]);

  const cardValue = useMemo(() => {
    if (cards.length === 0) return '0.00';
    const heldCards = cards.filter((c) => c.status === 'held');
    const total = heldCards.reduce((acc, c) => acc.plus(money(c.marketPriceUSD)), money(0));
    return toMoneyString(total);
  }, [cards]);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.refresh();
    router.push('/');
  }

  if (!sessionEmail) {
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/login"
          className="text-micro text-nearBlack/80 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
        >
          Sign in
        </Link>
        <Link
          href="/signup"
          className="text-micro text-nearBlack/70 hover:text-nearBlack hidden sm:inline underline decoration-nearBlack/15 underline-offset-4"
        >
          Sign up
        </Link>
        <ButtonPrimary href="/drops">Start trading</ButtonPrimary>
      </div>
    );
  }

  const shortLabel = sessionEmail.includes('@')
    ? sessionEmail.split('@')[0]!.slice(0, 24)
    : sessionEmail.slice(0, 24);

  return (
    <div className="flex items-center gap-4">
      {availableBalance !== null && cardValue !== null && (
        <div className="hidden md:flex flex-col items-end text-micro mr-2">
          <div className="text-mutedSlate">
            Cards: <span className="font-semibold text-ink">{formatUSD(cardValue)}</span>
          </div>
          <div className="text-mutedSlate">
            Available: <span className="font-semibold text-deepEnterpriseGreen">{formatUSD(availableBalance)}</span>
          </div>
        </div>
      )}

      <span
        title={sessionEmail ?? undefined}
        className="text-micro font-medium text-nearBlack max-w-[140px] truncate md:max-w-[200px]"
      >
        {shortLabel}
      </span>
      <button
        type="button"
        onClick={() => void handleSignOut()}
        className="text-micro text-nearBlack/70 hover:text-nearBlack underline decoration-nearBlack/20 underline-offset-4"
      >
        Sign out
      </button>
    </div>
  );
}
