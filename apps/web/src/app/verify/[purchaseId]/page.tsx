'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { verifyPurchase, type VerificationResult } from '@pullvault/shared/provably-fair';

interface PurchaseData {
  id: string;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  revealed: boolean;
  tier: {
    rarityWeights: Record<string, number>;
  };
  cards: Array<{
    drawIndex: number;
    rarity: string;
    cardId: string;
    card: { name: string; imageUrl: string };
  }>;
}

export default function VerifyPurchasePage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = use(params);
  const [purchase, setPurchase] = useState<PurchaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [testSeed, setTestSeed] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/packs/${purchaseId}/verify-data`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setPurchase(json.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchaseId]);

  const runVerification = async (seedToUse: string) => {
    if (!purchase || !seedToUse) return;
    setRunning(true);
    try {
      const verification = await verifyPurchase({
        serverSeed: seedToUse,
        serverSeedHash: purchase.serverSeedHash,
        clientSeed: purchase.clientSeed,
        purchaseId: purchase.id,
        rarityWeights: purchase.tier.rarityWeights,
        drawnCards: purchase.cards.map((c) => ({
          drawIndex: c.drawIndex,
          rarity: c.rarity,
          cardId: c.cardId,
        })),
      });
      setResult(verification);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (purchase?.serverSeed) {
      void runVerification(purchase.serverSeed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase?.serverSeed]);

  if (loading) return <section className="px-4 py-10">Loading verification data...</section>;
  if (!purchase) return <section className="px-4 py-10">Purchase not found.</section>;

  const fullyVerified = !!result && result.hashValid && result.allMatched;

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-2">
          <h1 className="font-display text-sectionDisplay tracking-tight">Provably fair verification</h1>
          <p className="text-bodyLarge text-ink/70">
            Purchase ID: <code>{purchase.id}</code>
          </p>
        </div>

        {/* SECTION 1 — Commitment */}
        <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-3">
          <h2 className="font-display text-featureHeading">SECTION 1 — Commitment</h2>
          <div>
            <div className="text-sm font-semibold">Server Seed Hash (shown at purchase)</div>
            <pre className="mt-1 rounded border border-cardBorder bg-stone/60 px-3 py-2 font-mono text-xs overflow-x-auto">
              {purchase.serverSeedHash}
            </pre>
          </div>
          <div>
            <div className="text-sm font-semibold">Server Seed (revealed after opening)</div>
            <pre className="mt-1 rounded border border-cardBorder bg-stone/60 px-3 py-2 font-mono text-xs overflow-x-auto">
              {purchase.serverSeed ?? 'Not yet revealed — open the pack first'}
            </pre>
          </div>
          <div>
            <div className="text-sm font-semibold">Client Seed</div>
            <pre className="mt-1 rounded border border-cardBorder bg-stone/60 px-3 py-2 font-mono text-xs overflow-x-auto">
              {purchase.clientSeed}
            </pre>
          </div>
        </div>

        {/* SECTION 2 — Tamper Test */}
        <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-3">
          <h2 className="font-display text-featureHeading">SECTION 2 — Tamper Test</h2>
          <label htmlFor="testSeed" className="block text-sm font-semibold">
            Enter any seed to test...
          </label>
          <input
            id="testSeed"
            className="w-full rounded border border-cardBorder px-3 py-2"
            placeholder="Enter any seed to test..."
            value={testSeed}
            onChange={(e) => setTestSeed(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-ink px-4 py-2 text-white disabled:opacity-60"
            disabled={running || testSeed.trim().length === 0}
            onClick={() => void runVerification(testSeed.trim())}
          >
            {running ? 'Verifying...' : 'Verify with this seed'}
          </button>
        </div>

        {/* SECTION 3 — Result */}
        {result ? (
          <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-4">
            <h2 className="font-display text-featureHeading">SECTION 3 — Result</h2>
            <div
              className={
                fullyVerified
                  ? 'rounded border border-deepEnterpriseGreen/35 bg-deepEnterpriseGreen/10 px-4 py-3 text-deepEnterpriseGreen'
                  : 'rounded border border-errorRed/35 bg-errorRed/10 px-4 py-3 text-errorRed'
              }
            >
              <strong>
                {fullyVerified
                  ? '✅ VERIFIED — This pack was drawn fairly'
                  : '❌ VERIFICATION FAILED'}
              </strong>
            </div>
            <div>
              Hash check:{' '}
              {result.hashValid
                ? '✅ SHA256(seed) matches commitment'
                : '❌ SHA256(seed) does not match commitment'}
            </div>
            <div>
              Card draws:{' '}
              {result.allMatched
                ? `✅ All ${result.cards.length} cards match recomputed draws`
                : '❌ One or more cards do not match recomputed draws'}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="py-2 pr-4">Draw #</th>
                    <th className="py-2 pr-4">Float</th>
                    <th className="py-2 pr-4">Rarity Drawn</th>
                    <th className="py-2 pr-4">Card Name</th>
                    <th className="py-2 pr-4">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cards.map((row) => (
                    <tr key={row.drawIndex} className="border-t border-cardBorder/60">
                      <td className="py-2 pr-4">{row.drawIndex}</td>
                      <td className="py-2 pr-4">{row.float.toFixed(6)}</td>
                      <td className="py-2 pr-4">{row.rarity}</td>
                      <td className="py-2 pr-4">{purchase.cards[row.drawIndex]?.card?.name ?? 'Unknown card'}</td>
                      <td className="py-2 pr-4">{row.matched ? '✅' : '❌'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
