'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { PACK_ECONOMICS, PACK_TIERS, PLATFORM } from '@pullvault/shared/constants';
import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';

import { PlatformHealthB5 } from './PlatformHealthB5';

// ---------- Types mirroring the API responses (kept thin on purpose) ----------

type EconomicsData = {
  packEVByTier: Record<
    string,
    { tierName: string; evPerPackUSD: string; evPerCardUSD: string; houseMarginUSD: string }
  >;
  tradeFeeRevenueUSD: string;
  auctionFeeRevenueUSD: string;
};

type SimulationRow = {
  tierCode: string;
  trials: number;
  pricePerPackUsd: string;
  avgPackEvUsd: string;
  closedFormEvUsd: string;
  p10PackEvUsd: string;
  p50PackEvUsd: string;
  p90PackEvUsd: string;
  avgMarginPct: string;
  winRate: number;
  totalRevenueUsd: string;
  totalPayoutEvUsd: string;
  projectedHousePnlUsd: string;
  marginBuckets: Array<{ fromPct: string; toPct: string; count: number }>;
  rarityHitRate: Record<string, number>;
};

type SimulateResponse = {
  context: { generatedAt: string; catalogCardCount: number };
  results: SimulationRow[];
  warnings: Array<{ tierCode: string; severity: 'warn' | 'error'; message: string }>;
};

type SolverWarning = { code: string; message: string };

type SolveResponse = {
  tierCode: string;
  current: { weights: Record<string, number>; evPerPackUsd: string; marginPct: string };
  recommended: {
    weights: Record<string, number>;
    evPerPackUsd: string;
    marginPct: string;
    converged: boolean;
    reason: string;
    notes: string;
    winRateIterations?: number;
    verificationWinRate?: number;
    warnings?: SolverWarning[];
  };
  targets: {
    marginPct: number;
    minMarginPct: number;
    winRateFloor: number;
    winRateCeiling: number;
  };
  verification: SimulationRow;
};

type RebalanceLogEntry = {
  tierCode: string;
  tierName: string;
  pricePerPackUsd: string;
  cardsPerPack: number;
  rebalancedAt: string;
  reason: string | null;
  previousWeights: Record<string, number>;
  previousMarginPct: string | null;
  newMarginPct: string | null;
  currentWeights: Record<string, number>;
};

// ---------- Page ----------

export default function AdminEconomicsPage() {
  const [data, setData] = useState<EconomicsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/economics', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (json.ok) setData(json.data as EconomicsData);
        else setError(json.error?.message ?? 'Failed to load economics');
      })
      .catch(() => setError('Failed to load economics'));
  }, []);

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Admin</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            Platform economics
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Platform-level economics and integrity health. For B1 weight simulation/solver workflows,
            use the dedicated <span className="font-mono">Open B1 Demo Lab -&gt;</span>.
          </p>
        </div>

        <DarkFeatureBand tone="green" className="rounded-lg border border-cardBorder">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
              <div>
                <div className="text-featureHeading font-semibold">Revenue streams (real)</div>
                <div className="text-bodyLarge text-canvas/85 mt-2">
                  Trade fee:{' '}
                  <span className="font-semibold">
                    {toMoneyString(money(PLATFORM.TRADE_FEE_RATE))}
                  </span>{' '}
                  rate • Auction fee:{' '}
                  <span className="font-semibold">
                    {toMoneyString(money(PLATFORM.AUCTION_FEE_RATE))}
                  </span>{' '}
                  rate
                </div>
              </div>
              <div className="flex gap-3">
                <Link href="/admin/economics/b1-lab">
                  <ButtonPillOutline>Open B1 Demo Lab -&gt;</ButtonPillOutline>
                </Link>
                <Link href="/admin/catalog">
                  <ButtonPrimary>Refresh catalog</ButtonPrimary>
                </Link>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <RevenueCard
                label="Trade platform fee revenue"
                value={data?.tradeFeeRevenueUSD ?? '0.00'}
              />
              <RevenueCard
                label="Auction platform fee revenue"
                value={data?.auctionFeeRevenueUSD ?? '0.00'}
              />
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
            <MonoLabel>EV per tier (closed form)</MonoLabel>
            <div className="text-micro text-mutedSlate">
              Computed from `cards.market_price_usd` + tier rarity weights
            </div>
          </div>

          <ResearchTable>
            {PACK_TIERS.map((tier) => {
              const row = data?.packEVByTier?.[tier.code];
              const evPerPackUSD = row?.evPerPackUSD ?? '0.00';
              const evPerCardUSD = toMoneyString(
                money(evPerPackUSD).dividedBy(tier.cardsPerPack),
              );
              const marginUSD = row?.houseMarginUSD ?? '0.00';
              return (
                <ResearchTableRow
                  key={tier.code}
                  left={
                    <span className="text-body font-semibold text-ink">{tier.name}</span>
                  }
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

        <PlatformHealthB5 />
        <AuctionHealthPanel />
      </div>
    </section>
  );
}

function RevenueCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-canvas/15 bg-canvas/5 p-5">
      <div className="text-micro text-canvas/70">{label}</div>
      <div className="mt-2 font-display text-sectionHeading tracking-tight leading-none">
        {value}
      </div>
    </div>
  );
}

// ---------- Simulator ----------

function SimulatorPanel() {
  const [trials, setTrials] = useState<number>(PACK_ECONOMICS.DEFAULT_SIM_TRIALS);
  const [tierCode, setTierCode] = useState<string>('');
  const [seed, setSeed] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = { trials };
      if (tierCode) body.tierCode = tierCode;
      if (seed.trim() !== '') {
        const n = Number(seed);
        if (Number.isFinite(n) && n >= 0) body.seed = Math.floor(n);
      }
      const res = await fetch('/api/admin/simulate-packs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Simulation failed');
      setResult(json.data as SimulateResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setBusy(false);
    }
  }, [trials, tierCode, seed]);

  return (
    <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <MonoLabel>Live simulator</MonoLabel>
          <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
            Monte-Carlo pack openings
          </h2>
          <p className="text-bodyLarge text-ink/70">
            Runs N virtual openings against the real catalog price feed using the active rarity
            weights. Returns win rate, margin distribution, and projected P&amp;L.
          </p>
        </div>
        <div className="text-micro text-mutedSlate text-right">
          target margin {(PACK_ECONOMICS.TARGET_MARGIN_PCT * 100).toFixed(0)}% • win-rate floor{' '}
          {(PACK_ECONOMICS.WIN_RATE_FLOOR * 100).toFixed(0)}%
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="space-y-1 text-micro">
          <span className="text-mutedSlate">Trials</span>
          <input
            type="number"
            min={100}
            max={PACK_ECONOMICS.MAX_SIM_TRIALS}
            step={1000}
            value={trials}
            onChange={(e) => setTrials(Number(e.target.value) || PACK_ECONOMICS.DEFAULT_SIM_TRIALS)}
            className="w-full rounded-sm border border-cardBorder bg-canvas px-3 py-2 font-mono text-body"
          />
        </label>
        <label className="space-y-1 text-micro">
          <span className="text-mutedSlate">Tier (blank = all)</span>
          <select
            value={tierCode}
            onChange={(e) => setTierCode(e.target.value)}
            className="w-full rounded-sm border border-cardBorder bg-canvas px-3 py-2 text-body"
          >
            <option value="">All active tiers</option>
            {PACK_TIERS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-micro">
          <span className="text-mutedSlate">Seed (optional)</span>
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="reproducible runs"
            className="w-full rounded-sm border border-cardBorder bg-canvas px-3 py-2 font-mono text-body"
          />
        </label>
        <div className="flex items-end">
          <ButtonPrimary onClick={() => void run()} disabled={busy}>
            {busy ? 'Simulating…' : 'Run simulation'}
          </ButtonPrimary>
        </div>
      </div>

      {err ? (
        <div className="rounded-sm border border-coral/40 bg-coral/10 px-4 py-3 text-body">
          {err}
        </div>
      ) : null}

      {result ? <SimulatorResultBlock result={result} /> : null}
    </div>
  );
}

function SimulatorResultBlock({ result }: { result: SimulateResponse }) {
  return (
    <div className="space-y-4">
      <div className="text-micro text-mutedSlate">
        catalog: {result.context.catalogCardCount.toLocaleString()} cards • generated{' '}
        {new Date(result.context.generatedAt).toLocaleTimeString()}
      </div>

      {result.warnings.length > 0 ? (
        <div className="space-y-2">
          {result.warnings.map((w, i) => (
            <div
              key={`${w.tierCode}-${i}`}
              className={
                w.severity === 'error'
                  ? 'rounded-sm border border-coral/60 bg-coral/15 px-4 py-3 text-body'
                  : 'rounded-sm border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-body'
              }
            >
              <span className="font-mono text-micro mr-2 uppercase">{w.severity}</span>
              <span className="font-semibold mr-1">{w.tierCode}:</span>
              {w.message}
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {result.results.map((r) => (
          <SimResultCard key={r.tierCode} row={r} />
        ))}
      </div>
    </div>
  );
}

function SimResultCard({ row }: { row: SimulationRow }) {
  const winRatePct = row.winRate * 100;
  const marginPct = Number(row.avgMarginPct) * 100;
  const healthy =
    marginPct >= PACK_ECONOMICS.MIN_MARGIN_PCT * 100 &&
    winRatePct >= PACK_ECONOMICS.WIN_RATE_FLOOR * 100 &&
    winRatePct <= PACK_ECONOMICS.WIN_RATE_CEILING * 100;
  return (
    <div className="rounded-lg border border-cardBorder bg-canvas/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-micro text-mutedSlate uppercase">{row.tierCode}</div>
          <div className="font-display text-sectionHeading leading-none mt-1">
            {row.trials.toLocaleString()} packs
          </div>
        </div>
        <span
          className={
            'font-mono text-micro rounded-pill px-3 py-1 ' +
            (healthy
              ? 'bg-deepEnterpriseGreen/15 text-deepEnterpriseGreen'
              : 'bg-coral/15 text-coral')
          }
        >
          {healthy ? 'within target' : 'out of target'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-body">
        <Stat label="Win rate" value={`${winRatePct.toFixed(2)}%`} />
        <Stat label="Avg margin" value={`${marginPct.toFixed(2)}%`} />
        <Stat label="Avg pack EV" value={formatUSD(row.avgPackEvUsd)} />
        <Stat label="Pack price" value={formatUSD(row.pricePerPackUsd)} />
        <Stat label="p10 EV" value={formatUSD(row.p10PackEvUsd)} />
        <Stat label="p90 EV" value={formatUSD(row.p90PackEvUsd)} />
        <Stat label="Revenue" value={formatUSD(row.totalRevenueUsd)} />
        <Stat
          label="Projected P&L"
          value={formatUSD(row.projectedHousePnlUsd)}
          tone={Number(row.projectedHousePnlUsd) >= 0 ? 'green' : 'red'}
        />
      </div>

      <MarginHistogram buckets={row.marginBuckets} />
      <RarityHitGrid hits={row.rarityHitRate} />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red';
}) {
  const cls =
    tone === 'green'
      ? 'text-deepEnterpriseGreen'
      : tone === 'red'
        ? 'text-coral'
        : 'text-ink';
  return (
    <div>
      <div className="text-micro text-mutedSlate">{label}</div>
      <div className={`font-mono text-body font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function MarginHistogram({
  buckets,
}: {
  buckets: SimulationRow['marginBuckets'];
}) {
  const total = buckets.reduce((a, b) => a + b.count, 0) || 1;
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div className="space-y-1">
      <div className="text-micro text-mutedSlate">Per-pack margin distribution</div>
      <div className="flex items-end gap-1 h-20">
        {buckets.map((b, i) => {
          const h = Math.max(2, Math.round((b.count / max) * 80));
          const lo = Number(b.fromPct);
          const hi = Number(b.toPct);
          const negative = hi <= 0;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center justify-end"
              title={`${(lo * 100).toFixed(0)}%..${(hi * 100).toFixed(0)}% margin: ${b.count} (${((b.count / total) * 100).toFixed(1)}%)`}
            >
              <div
                style={{ height: `${h}px` }}
                className={
                  negative ? 'w-full bg-coral/70 rounded-t-sm' : 'w-full bg-deepEnterpriseGreen/70 rounded-t-sm'
                }
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-micro text-mutedSlate font-mono">
        <span>-50%</span>
        <span>0%</span>
        <span>+15%</span>
        <span>+100%</span>
      </div>
    </div>
  );
}

function RarityHitGrid({ hits }: { hits: SimulationRow['rarityHitRate'] }) {
  const entries = useMemo(
    () =>
      Object.entries(hits).sort((a, b) => b[1] - a[1]).map(([rarity, rate]) => ({
        rarity,
        rate,
      })),
    [hits],
  );
  return (
    <div className="space-y-1">
      <div className="text-micro text-mutedSlate">Empirical rarity hit rate</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-micro font-mono">
        {entries.map((e) => (
          <div key={e.rarity} className="flex justify-between">
            <span>{e.rarity.replace('_', ' ')}</span>
            <span className="text-ink/80">{(e.rate * 100).toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Solver ----------

function SolverPanel() {
  const [tierCode, setTierCode] = useState<string>(PACK_TIERS[0]?.code ?? '');
  const [target, setTarget] = useState<number>(
    Math.round(PACK_ECONOMICS.TARGET_MARGIN_PCT * 100),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SolveResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/solve-weights', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tierCode,
          targetMarginPct: target / 100,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error?.message ?? 'Solver failed');
      setResult(json.data as SolveResponse);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Solver failed');
    } finally {
      setBusy(false);
    }
  }, [tierCode, target]);

  return (
    <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <MonoLabel>Weight solver</MonoLabel>
          <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
            Backward-solve rarity weights
          </h2>
          <p className="text-bodyLarge text-ink/70">
            Given a target house margin, recompute rarity weights using `common` as the lever.
            Result is verified by Monte-Carlo before display. This view does not persist
            changes; review and promote separately.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1 text-micro">
          <span className="text-mutedSlate">Tier</span>
          <select
            value={tierCode}
            onChange={(e) => setTierCode(e.target.value)}
            className="w-full rounded-sm border border-cardBorder bg-canvas px-3 py-2 text-body"
          >
            {PACK_TIERS.map((t) => (
              <option key={t.code} value={t.code}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-micro">
          <span className="text-mutedSlate">
            Target margin: {target}% (floor {(PACK_ECONOMICS.MIN_MARGIN_PCT * 100).toFixed(0)}%)
          </span>
          <input
            type="range"
            min={Math.round(PACK_ECONOMICS.MIN_MARGIN_PCT * 100)}
            max={50}
            value={target}
            onChange={(e) => setTarget(Number(e.target.value))}
            className="w-full"
          />
        </label>
        <div className="flex items-end">
          <ButtonPillOutline onClick={() => void run()} disabled={busy}>
            {busy ? 'Solving…' : 'Solve weights'}
          </ButtonPillOutline>
        </div>
      </div>

      {err ? (
        <div className="rounded-sm border border-coral/40 bg-coral/10 px-4 py-3 text-body">
          {err}
        </div>
      ) : null}

      {result ? <SolverResultBlock result={result} /> : null}
    </div>
  );
}

function SolverResultBlock({ result }: { result: SolveResponse }) {
  const targetPct = result.targets.marginPct * 100;
  const recommendedMargin = Number(result.recommended.marginPct) * 100;
  const verifiedWinRate = result.verification.winRate * 100;
  const verifiedMargin = Number(result.verification.avgMarginPct) * 100;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-cardBorder bg-canvas/60 p-5 space-y-3">
        <div className="font-mono text-micro text-mutedSlate uppercase">current</div>
        <div className="text-body">
          EV/pack <span className="font-mono">{formatUSD(result.current.evPerPackUsd)}</span>
        </div>
        <div className="text-body">
          margin{' '}
          <span className="font-mono">
            {(Number(result.current.marginPct) * 100).toFixed(2)}%
          </span>
        </div>
        <WeightTable weights={result.current.weights} />
      </div>

      <div className="rounded-lg border border-deepEnterpriseGreen/30 bg-deepEnterpriseGreen/5 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-micro text-deepEnterpriseGreen uppercase">
            recommended @ {targetPct.toFixed(0)}% target
          </div>
          <span
            className={
              'font-mono text-micro rounded-pill px-2 py-0.5 ' +
              (result.recommended.converged
                ? 'bg-deepEnterpriseGreen/15 text-deepEnterpriseGreen'
                : 'bg-yellow-500/15 text-yellow-700')
            }
          >
            {result.recommended.reason}
          </span>
        </div>
        <div className="text-body">
          EV/pack{' '}
          <span className="font-mono">{formatUSD(result.recommended.evPerPackUsd)}</span>
        </div>
        <div className="text-body">
          margin <span className="font-mono">{recommendedMargin.toFixed(2)}%</span>
        </div>
        <WeightTable weights={result.recommended.weights} />
        {result.recommended.notes ? (
          <div className="text-micro text-mutedSlate italic">{result.recommended.notes}</div>
        ) : null}
        {typeof result.recommended.winRateIterations === 'number' ? (
          <div className="text-micro text-mutedSlate">
            Win-rate loop ran{' '}
            <span className="font-mono font-semibold">
              {result.recommended.winRateIterations}
            </span>{' '}
            adjustment iteration(s)
            {typeof result.recommended.verificationWinRate === 'number'
              ? ` → in-loop win rate ${(result.recommended.verificationWinRate * 100).toFixed(1)}%`
              : null}
          </div>
        ) : null}
        {result.recommended.warnings && result.recommended.warnings.length > 0 ? (
          <div className="space-y-2 pt-1">
            {result.recommended.warnings.map((w, i) => (
              <div
                key={`${w.code}-${i}`}
                className="rounded-sm border border-coral/40 bg-coral/10 px-3 py-2 text-micro"
              >
                <span className="font-mono text-[10px] uppercase mr-2">{w.code}</span>
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="border-t border-hairline pt-3 text-micro text-mutedSlate space-y-1">
          <div>
            verified ({result.verification.trials.toLocaleString()} packs):
            margin <span className="font-mono">{verifiedMargin.toFixed(2)}%</span> • win rate{' '}
            <span
              className={
                'font-mono ' +
                (result.verification.winRate >= result.targets.winRateFloor
                  ? 'text-deepEnterpriseGreen font-semibold'
                  : 'text-coral font-semibold')
              }
            >
              {verifiedWinRate.toFixed(2)}%
            </span>{' '}
            (floor {(result.targets.winRateFloor * 100).toFixed(0)}%)
          </div>
          <div>
            projected P&amp;L{' '}
            <span className="font-mono">
              {formatUSD(result.verification.projectedHousePnlUsd)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function WeightTable({ weights }: { weights: Record<string, number> }) {
  const order = ['common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare'];
  const entries = order
    .filter((r) => r in weights)
    .map((r) => [r, weights[r] ?? 0] as const);
  for (const [k, v] of Object.entries(weights)) {
    if (!order.includes(k)) entries.push([k, v]);
  }
  return (
    <div className="font-mono text-micro space-y-1">
      {entries.map(([rarity, w]) => (
        <div key={rarity} className="flex justify-between">
          <span className="text-mutedSlate">{rarity.replace('_', ' ')}</span>
          <span>{(w * 100).toFixed(2)}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Auto-rebalance log (B1 Fix 2) ----------

function RebalanceLogPanel() {
  const [entries, setEntries] = useState<RebalanceLogEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    fetch('/api/admin/rebalance-log', { cache: 'no-store' })
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (!json.ok) {
          setErr(json.error?.message ?? 'Failed to load rebalance log');
          return;
        }
        setEntries((json.data?.entries ?? []) as RebalanceLogEntry[]);
      })
      .catch(() => {
        if (!cancelled) setErr('Failed to load rebalance log');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <MonoLabel>Auto-rebalance log</MonoLabel>
          <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
            Price-refresh safety net
          </h2>
          <p className="text-bodyLarge text-ink/70">
            BullMQ worker re-solves weights whenever a tier's margin drifts outside the
            emergency band after a price refresh. Nothing here means margins are healthy.
          </p>
        </div>
        <ButtonPillOutline onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh log
        </ButtonPillOutline>
      </div>

      {err ? (
        <div className="rounded-sm border border-coral/40 bg-coral/10 px-4 py-3 text-body">
          {err}
        </div>
      ) : null}

      {entries === null ? (
        <div className="text-micro text-mutedSlate">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="rounded-sm border border-dashed border-cardBorder bg-canvas/60 p-5 text-bodyLarge text-mutedSlate">
          No auto-rebalances yet. Run the BullMQ price-refresh worker with prices that
          drift a tier outside the emergency band to trigger one.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-micro text-mutedSlate uppercase border-b border-hairline">
                <th className="text-left py-2 pr-4">Tier</th>
                <th className="text-right py-2 pr-4">Previous margin</th>
                <th className="text-right py-2 pr-4">New margin</th>
                <th className="text-left py-2 pr-4">Reason</th>
                <th className="text-left py-2">When</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={`${e.tierCode}-${e.rebalancedAt}`} className="border-b border-hairline">
                  <td className="py-3 pr-4 font-semibold">{e.tierName}</td>
                  <td className="py-3 pr-4 text-right font-mono text-coral">
                    {e.previousMarginPct
                      ? `${(Number(e.previousMarginPct) * 100).toFixed(2)}%`
                      : '—'}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-deepEnterpriseGreen">
                    {e.newMarginPct
                      ? `${(Number(e.newMarginPct) * 100).toFixed(2)}%`
                      : '—'}
                  </td>
                  <td className="py-3 pr-4 font-mono text-micro">{e.reason ?? '—'}</td>
                  <td className="py-3 font-mono text-micro text-mutedSlate">
                    {formatRelative(e.rebalancedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hour(s) ago`;
  const d = Math.round(hr / 24);
  return `${d} day(s) ago`;
}

// ---------- B3 — Auction health + flagged activity ----------

type AuctionAnalytics = {
  windowDays: number;
  avgPriceToMarketRatio: number;
  snipeRate: number;
  flagRate: number;
  avgParticipation: number;
  totalAuctions: number;
  sealedAuctionsCount: number;
  pendingFlagsCount: number;
};

type FlaggedActivityRow = {
  id: string;
  type: string;
  referenceId: string | null;
  reason: string;
  severity: 'low' | 'medium' | 'high' | string;
  metadata: Record<string, unknown> | null;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  createdAt: string;
};

function AuctionHealthPanel() {
  const [analytics, setAnalytics] = useState<AuctionAnalytics | null>(null);
  const [flags, setFlags] = useState<FlaggedActivityRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    Promise.all([
      fetch('/api/admin/auction-analytics', { cache: 'no-store', credentials: 'include' }).then((r) =>
        r.json(),
      ),
      fetch('/api/admin/flagged-activity?reviewed=false&limit=50', {
        cache: 'no-store',
        credentials: 'include',
      }).then((r) => r.json()),
    ])
      .then(([a, f]) => {
        if (cancelled) return;
        if (a.ok) setAnalytics(a.data as AuctionAnalytics);
        if (f.ok) setFlags((f.data.flags ?? []) as FlaggedActivityRow[]);
        const parts: string[] = [];
        if (!a.ok) parts.push(a.error?.message ?? 'Failed to load auction analytics');
        if (!f.ok) parts.push(f.error?.message ?? 'Failed to load flagged activity');
        if (parts.length) setErr(parts.join(' · '));
      })
      .catch(() => {
        if (!cancelled) setErr('Failed to load auction analytics');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const markReviewed = useCallback(
    async (id: string) => {
      setReviewingId(id);
      try {
        const res = await fetch('/api/admin/flagged-activity', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error?.message ?? 'Review failed');
        setRefreshKey((k) => k + 1);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Review failed');
      } finally {
        setReviewingId(null);
      }
    },
    [],
  );

  return (
    <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <MonoLabel>Auction integrity</MonoLabel>
          <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
            Auction health (last {analytics?.windowDays ?? 30} days)
          </h2>
          <p className="text-bodyLarge text-ink/70">
            Wash-trade detector runs hourly; sealed-bid phase triggers after 3 extensions.
            Flag queue below surfaces suspected collusion for manual review.
          </p>
        </div>
        <ButtonPillOutline onClick={() => setRefreshKey((k) => k + 1)}>
          Refresh
        </ButtonPillOutline>
      </div>

      {err ? (
        <div className="rounded-sm border border-coral/40 bg-coral/10 px-4 py-3 text-body">
          {err}
        </div>
      ) : null}

      {analytics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Price / market ratio"
            value={`${(analytics.avgPriceToMarketRatio * 100).toFixed(1)}%`}
            note="Healthy ~80-120%"
            tone={
              analytics.avgPriceToMarketRatio >= 0.8 && analytics.avgPriceToMarketRatio <= 1.2
                ? 'green'
                : 'red'
            }
          />
          <MetricCard
            label="Snipe rate"
            value={`${(analytics.snipeRate * 100).toFixed(1)}%`}
            note="% of auctions with extensions"
          />
          <MetricCard
            label="Flag rate"
            value={`${(analytics.flagRate * 100).toFixed(1)}%`}
            note="% flagged for review"
            tone={analytics.flagRate > 0.1 ? 'red' : 'green'}
          />
          <MetricCard
            label="Avg bidders / auction"
            value={analytics.avgParticipation.toFixed(1)}
            note="Higher = healthier competition"
          />
          <MetricCard
            label="Total auctions"
            value={analytics.totalAuctions.toLocaleString()}
            note="Settled in window"
          />
          <MetricCard
            label="Sealed-phase auctions"
            value={analytics.sealedAuctionsCount.toLocaleString()}
            note="≥ 3 extensions"
          />
          <MetricCard
            label="Pending flags"
            value={analytics.pendingFlagsCount.toLocaleString()}
            note="Unreviewed across all types"
            tone={analytics.pendingFlagsCount > 0 ? 'red' : 'green'}
          />
        </div>
      ) : (
        <div className="text-micro text-mutedSlate">Loading auction analytics…</div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-featureHeading font-semibold">
            Flagged activity ({flags?.length ?? 0} pending)
          </h3>
        </div>

        {flags === null ? (
          <div className="text-micro text-mutedSlate">Loading flag queue…</div>
        ) : flags.length === 0 ? (
          <div className="rounded-sm border border-dashed border-cardBorder bg-canvas/60 p-5 text-bodyLarge text-mutedSlate">
            No pending flags. Anything suspicious will show up here within an hour of
            landing in the database.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-micro text-mutedSlate uppercase border-b border-hairline">
                  <th className="text-left py-2 pr-4">Type</th>
                  <th className="text-left py-2 pr-4">Severity</th>
                  <th className="text-left py-2 pr-4">Reason</th>
                  <th className="text-left py-2 pr-4">When</th>
                  <th className="text-right py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {flags.map((f) => (
                  <tr key={f.id} className="border-b border-hairline align-top">
                    <td className="py-3 pr-4 font-mono text-micro">{f.type}</td>
                    <td className="py-3 pr-4 font-mono text-micro">
                      <span
                        className={
                          'rounded-pill px-2 py-0.5 ' +
                          (f.severity === 'high'
                            ? 'bg-coral/15 text-coral'
                            : f.severity === 'low'
                              ? 'bg-deepEnterpriseGreen/15 text-deepEnterpriseGreen'
                              : 'bg-yellow-500/15 text-yellow-700')
                        }
                      >
                        {f.severity}
                      </span>
                    </td>
                    <td className="py-3 pr-4 max-w-[40ch]">{f.reason}</td>
                    <td className="py-3 pr-4 font-mono text-micro text-mutedSlate whitespace-nowrap">
                      {formatRelative(f.createdAt)}
                    </td>
                    <td className="py-3 text-right">
                      <ButtonPillOutline
                        onClick={() => void markReviewed(f.id)}
                        disabled={reviewingId === f.id}
                      >
                        {reviewingId === f.id ? 'Reviewing…' : 'Mark reviewed'}
                      </ButtonPillOutline>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'green' | 'red';
}) {
  const toneCls =
    tone === 'green'
      ? 'text-deepEnterpriseGreen'
      : tone === 'red'
        ? 'text-coral'
        : 'text-ink';
  return (
    <div className="rounded-lg border border-cardBorder bg-canvas/60 p-4">
      <div className="text-micro text-mutedSlate">{label}</div>
      <div className={`mt-1 font-display text-featureHeading leading-none ${toneCls}`}>
        {value}
      </div>
      {note ? <div className="mt-1 text-micro text-mutedSlate">{note}</div> : null}
    </div>
  );
}




