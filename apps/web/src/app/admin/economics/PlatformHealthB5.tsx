'use client';

import { useCallback, useEffect, useState } from 'react';

import { formatUSD } from '@pullvault/shared/money';

import { MetricCard } from '@/components/admin/MetricCard';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';

type FraudData = {
  rateLimitHits: Record<string, unknown>[];
  rateLimitTimeline: Record<string, unknown>[];
  botSignalBreakdown: Record<string, unknown>[];
  suspiciousAccounts: Record<string, unknown>;
  topSuspiciousAccounts: Record<string, unknown>[];
  generatedAt: string;
};

type EconomicHealthData = {
  actualMargins: Record<string, unknown>[];
  revenueByStream: Record<string, unknown>[];
  dailyRevenue: Record<string, unknown>[];
  projectedMonthlyRevenue: number;
  alerts: Array<{ tier: string; margin: number; severity: 'critical' | 'warning'; message: string }>;
  targetMargin: number;
  generatedAt: string;
};

type AuditData = {
  totalCardsAnalyzed: number;
  actualDistribution: Array<{
    rarity: string;
    actualCount: number;
    expectedCount: number;
  }>;
  chiSquared: number;
  degreesOfFreedom: number;
  pValue: number;
  fair: boolean;
  interpretation: string;
  verificationPageUses: number;
};

type UserHealthData = {
  dropEngagement: Record<string, unknown>[];
  auctionParticipation: Record<string, unknown>;
  retention: Record<string, unknown>;
  userActivity: Record<string, unknown>;
  portfolioStats: Record<string, unknown>;
  generatedAt: string;
};

function num(r: unknown): number {
  const n = Number(r);
  return Number.isFinite(n) ? n : 0;
}

function RateLimitSparkline({ rows }: { rows: Record<string, unknown>[] }) {
  const max = Math.max(...rows.map((r) => num(r.hit_count)), 1);
  const w = 240;
  const h = 48;
  const barW = rows.length > 0 ? Math.max(2, w / rows.length - 1) : 2;
  return (
    <div className="mt-2">
      <div className="text-micro text-mutedSlate mb-1">Rate limit hits by hour (24h)</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md h-14">
        {rows.map((r, i) => {
          const hits = num(r.hit_count);
          const bh = Math.max(2, (hits / max) * (h - 4));
          const x = (i / Math.max(rows.length, 1)) * (w - barW);
          return (
            <rect
              key={`${String(r.hour)}_${i}`}
              x={x}
              y={h - bh}
              width={barW}
              height={bh}
              className="fill-deepEnterpriseGreen/80"
              rx={1}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function PlatformHealthB5() {
  const [fraud, setFraud] = useState<FraudData | null>(null);
  const [health, setHealth] = useState<EconomicHealthData | null>(null);
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [userHealth, setUserHealth] = useState<UserHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const fetchOpts = { cache: 'no-store' as const, credentials: 'include' as const };
      const [fraudRes, healthRes, auditRes, userHealthRes] = await Promise.all([
        fetch('/api/admin/fraud-metrics', fetchOpts),
        fetch('/api/admin/economic-health', fetchOpts),
        fetch('/api/audit/packs', fetchOpts),
        fetch('/api/admin/user-health', fetchOpts),
      ]);

      if (!fraudRes.ok || !healthRes.ok || !auditRes.ok || !userHealthRes.ok) {
        throw new Error('One or more dashboard requests failed');
      }

      const [fraudJson, healthJson, auditJson, userJson] = await Promise.all([
        fraudRes.json(),
        healthRes.json(),
        auditRes.json(),
        userHealthRes.json(),
      ]);

      if (!fraudJson.ok || !healthJson.ok || !userJson.ok) {
        throw new Error(fraudJson.error?.message ?? healthJson.error?.message ?? 'Dashboard load failed');
      }

      const auditPayload = (auditJson?.data ?? auditJson) as AuditData | null;
      if (!auditPayload || typeof auditPayload.totalCardsAnalyzed !== 'number') {
        throw new Error('Fairness audit payload missing');
      }

      setFraud(fraudJson.data as FraudData);
      setHealth(healthJson.data as EconomicHealthData);
      setAudit(auditPayload);
      setUserHealth(userJson.data as UserHealthData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load platform health');
      setFraud(null);
      setHealth(null);
      setAudit(null);
      setUserHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const totalRateLimitHits =
    fraud?.rateLimitHits.reduce((s, r) => s + num(r.hit_count), 0) ?? 0;

  return (
    <div className="space-y-10 rounded-lg border border-dashed border-cardBorder bg-canvas/30 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <MonoLabel>B5 — Extended platform health</MonoLabel>
          <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
            Fraud, economics, fairness &amp; engagement
          </h2>
          <p className="text-bodyLarge text-ink/70 mt-1">
            Aggregates B2 bot signals, rolling pack margins, B4 provably-fair audit stats, and user
            activity. Data loads in parallel on each refresh.
          </p>
        </div>
        <ButtonPillOutline type="button" onClick={() => setTick((t) => t + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh dashboard'}
        </ButtonPillOutline>
      </div>

      {err ? (
        <div className="rounded-lg border border-coral/40 bg-coral/10 p-4 text-body text-ink">{err}</div>
      ) : null}

      {loading && !fraud ? (
        <div className="text-body text-mutedSlate">Loading B5 panels…</div>
      ) : null}

      {/* Section 1 — Fraud */}
      {fraud ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sectionHeading">Fraud &amp; bot activity</h3>
            <span className="text-micro text-mutedSlate">
              Data as of {new Date(fraud.generatedAt).toLocaleString()}
            </span>
          </div>
          <p className="text-micro text-mutedSlate">Rate limits: last 24h • Bot signals: last 7 days</p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Rate limit hits (24h)"
              value={totalRateLimitHits}
              note="429 responses logged"
              alert={totalRateLimitHits > 500}
            />
            <MetricCard
              label="Flagged accounts"
              value={num(fraud.suspiciousAccounts.flagged_count)}
              note="Bot score &gt; 60"
              alert={num(fraud.suspiciousAccounts.pending_review_count) > 10}
            />
            <MetricCard
              label="Watch list"
              value={num(fraud.suspiciousAccounts.watch_list_count)}
              note="Bot score 31–60"
            />
            <MetricCard
              label="Avg bot score"
              value={num(fraud.suspiciousAccounts.avg_bot_score).toFixed(1)}
              note="All rows in suspicious_accounts"
            />
          </div>

          {fraud.rateLimitTimeline.length > 0 ? (
            <RateLimitSparkline rows={fraud.rateLimitTimeline} />
          ) : null}

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Rate limit hits by endpoint (24h)</h4>
            <div className="overflow-x-auto rounded-lg border border-cardBorder">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                  <tr>
                    <th className="p-3">Endpoint</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Hits</th>
                  </tr>
                </thead>
                <tbody>
                  {fraud.rateLimitHits.map((r) => (
                    <tr key={`${String(r.endpoint)}-${String(r.limit_type)}`} className="border-t border-cardBorder">
                      <td className="p-3 font-mono text-xs">{String(r.endpoint)}</td>
                      <td className="p-3">{String(r.limit_type)}</td>
                      <td className="p-3 tabular-nums">{String(r.hit_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Bot signals (7 days)</h4>
            <div className="overflow-x-auto rounded-lg border border-cardBorder">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                  <tr>
                    <th className="p-3">Signal</th>
                    <th className="p-3">Occurrences</th>
                    <th className="p-3">Unique users</th>
                  </tr>
                </thead>
                <tbody>
                  {fraud.botSignalBreakdown.map((r) => (
                    <tr key={String(r.signal_type)} className="border-t border-cardBorder">
                      <td className="p-3">{String(r.signal_type)}</td>
                      <td className="p-3 tabular-nums">{String(r.signal_count)}</td>
                      <td className="p-3 tabular-nums">{String(r.unique_users)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">
              High-score accounts (pending review:{' '}
              {String(fraud.suspiciousAccounts.pending_review_count ?? '0')})
            </h4>
            <div className="overflow-x-auto rounded-lg border border-cardBorder">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                  <tr>
                    <th className="p-3">User</th>
                    <th className="p-3">Bot score</th>
                    <th className="p-3">Signals</th>
                    <th className="p-3">Flagged</th>
                    <th className="p-3">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {fraud.topSuspiciousAccounts.map((r) => (
                    <tr
                      key={String(r.user_id)}
                      className={
                        num(r.bot_score) > 60 ? 'border-t border-cardBorder bg-coral/5' : 'border-t border-cardBorder'
                      }
                    >
                      <td className="p-3 font-mono text-xs">{String(r.username)}</td>
                      <td className="p-3 tabular-nums">{String(r.bot_score)}</td>
                      <td className="p-3 tabular-nums">{String(r.signal_count)}</td>
                      <td className="p-3">
                        {r.flagged_at ? new Date(String(r.flagged_at)).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-3">{r.reviewed_at ? 'Yes' : 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* Section 2 — Economic health */}
      {health ? (
        <section className="space-y-4 pt-6 border-t border-cardBorder">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sectionHeading">Economic health</h3>
            <span className="text-micro text-mutedSlate">
              Data as of {new Date(health.generatedAt).toLocaleString()}
            </span>
          </div>
          <p className="text-micro text-mutedSlate">
            Rolling 24h actual margins vs {(health.targetMargin * 100).toFixed(0)}% target
          </p>

          {health.alerts.length > 0 ? (
            <div className="space-y-2">
              {health.alerts.map((a) => (
                <div
                  key={a.tier}
                  className={
                    a.severity === 'critical'
                      ? 'rounded-lg border border-coral/50 bg-coral/10 px-4 py-3 text-body'
                      : 'rounded-lg border border-yellow-600/40 bg-yellow-500/10 px-4 py-3 text-body'
                  }
                >
                  {a.message}
                </div>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-cardBorder">
            <table className="min-w-full text-sm">
              <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                <tr>
                  <th className="p-3">Tier</th>
                  <th className="p-3">Packs (24h)</th>
                  <th className="p-3">Actual margin</th>
                  <th className="p-3">Target</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last rebalanced</th>
                </tr>
              </thead>
              <tbody>
                {health.actualMargins.map((row) => {
                  const code = String(row.tier_code);
                  const margin = num(row.actual_margin);
                  const status =
                    margin < 0.05 ? 'critical' : margin > 0.45 ? 'warning' : margin >= 0.12 && margin <= 0.18 ? 'healthy' : 'acceptable';
                  return (
                    <tr key={code} className="border-t border-cardBorder">
                      <td className="p-3 font-semibold">{String(row.tier_name)}</td>
                      <td className="p-3 tabular-nums">{String(row.packs_sold)}</td>
                      <td className="p-3 tabular-nums">{(margin * 100).toFixed(1)}%</td>
                      <td className="p-3 tabular-nums">{(health.targetMargin * 100).toFixed(1)}%</td>
                      <td className="p-3">
                        <span
                          className={
                            status === 'healthy'
                              ? 'text-deepEnterpriseGreen font-semibold'
                              : status === 'critical'
                                ? 'text-coral font-semibold'
                                : status === 'warning'
                                  ? 'text-yellow-700 font-semibold'
                                  : 'text-ink/80'
                          }
                        >
                          {status}
                        </span>
                      </td>
                      <td className="p-3 text-micro">
                        {row.rebalanced_at
                          ? `${new Date(String(row.rebalanced_at)).toLocaleDateString()}${row.rebalanced_reason ? ` (${String(row.rebalanced_reason)})` : ''}`
                          : 'Never'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Revenue by stream (30 days)</h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {health.revenueByStream.map((r) => (
                <MetricCard
                  key={String(r.kind)}
                  label={String(r.kind).replace(/_/g, ' ')}
                  value={formatUSD(String(r.total_amount))}
                  note={`${String(r.transaction_count)} tx`}
                />
              ))}
            </div>
            <div className="mt-4 max-w-md">
              <MetricCard
                label="Projected monthly revenue"
                value={formatUSD(health.projectedMonthlyRevenue)}
                note="Extrapolated from 7-day platform inflows"
              />
            </div>
          </div>
        </section>
      ) : null}

      {/* Section 3 — Fairness */}
      {audit ? (
        <section className="space-y-4 pt-6 border-t border-cardBorder">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sectionHeading">Fairness audit</h3>
          </div>
          <p className="text-micro text-mutedSlate">{audit.interpretation}</p>

          <div
            className={
              audit.fair
                ? 'rounded-lg border border-deepEnterpriseGreen/40 bg-deepEnterpriseGreen/10 px-4 py-3 font-semibold text-deepEnterpriseGreen'
                : 'rounded-lg border border-coral/50 bg-coral/10 px-4 py-3 font-semibold text-coral'
            }
          >
            {audit.fair
              ? 'FAIR — rarity mix is consistent with advertised weights (chi-squared view).'
              : 'DEVIATION — observed distribution differs significantly from expected under advertised weights.'}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Cards analyzed"
              value={audit.totalCardsAnalyzed.toLocaleString()}
              note="From last 1k opened packs (all tiers)"
            />
            <MetricCard
              label="Chi-squared"
              value={audit.chiSquared.toFixed(3)}
              note={`df=${audit.degreesOfFreedom} • critical ≈ 9.488 @ α=0.05`}
              alert={audit.degreesOfFreedom === 4 && audit.chiSquared > 9.488}
            />
            <MetricCard label="P-value" value={audit.pValue.toFixed(4)} note="Higher suggests consistency with H₀" alert={audit.pValue < 0.05} />
            <MetricCard
              label="Verification page uses"
              value={audit.verificationPageUses}
              note="Rows with verified_at set"
            />
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Observed vs expected (per-card, pooled)</h4>
            <div className="overflow-x-auto rounded-lg border border-cardBorder">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                  <tr>
                    <th className="p-3">Rarity</th>
                    <th className="p-3">Observed</th>
                    <th className="p-3">Observed %</th>
                    <th className="p-3">Expected %</th>
                    <th className="p-3">Δ (pp)</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.actualDistribution.map((r) => {
                    const obsPct =
                      audit.totalCardsAnalyzed > 0 ? (r.actualCount / audit.totalCardsAnalyzed) * 100 : 0;
                    const expPct =
                      audit.totalCardsAnalyzed > 0 ? (r.expectedCount / audit.totalCardsAnalyzed) * 100 : 0;
                    return (
                      <tr key={r.rarity} className="border-t border-cardBorder">
                        <td className="p-3">{r.rarity.replace('_', ' ')}</td>
                        <td className="p-3 tabular-nums">{r.actualCount}</td>
                        <td className="p-3 tabular-nums">{obsPct.toFixed(2)}%</td>
                        <td className="p-3 tabular-nums">{expPct.toFixed(2)}%</td>
                        <td className="p-3 tabular-nums">{(obsPct - expPct).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* Section 4 — User health */}
      {userHealth ? (
        <section className="space-y-4 pt-6 border-t border-cardBorder">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-sectionHeading">User health</h3>
            <span className="text-micro text-mutedSlate">
              Data as of {new Date(userHealth.generatedAt).toLocaleString()}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Active buyers (7d)"
              value={num(userHealth.userActivity.active_buyers)}
              note={`${num(userHealth.userActivity.new_buyers)} new • ${num(userHealth.userActivity.returning_buyers)} returning`}
            />
            <MetricCard
              label="D7 retention (proxy)"
              value={`${num(userHealth.retention.d7_retention_pct)}%`}
              note={`${userHealth.retention.returned_count ?? 0} of ${userHealth.retention.cohort_size ?? 0} cohort`}
              alert={num(userHealth.retention.d7_retention_pct) < 20}
            />
            <MetricCard
              label="Avg bidders / auction"
              value={num(userHealth.auctionParticipation.avg_bidders_per_auction).toFixed(1)}
              note={`${userHealth.auctionParticipation.competitive_auctions ?? 0} competitive (3+)`}
              alert={num(userHealth.auctionParticipation.avg_bidders_per_auction) < 1.5}
            />
            <MetricCard
              label="Avg portfolio value"
              value={formatUSD(String(userHealth.portfolioStats.avg_portfolio_value ?? 0))}
              note={`${userHealth.portfolioStats.users_with_cards ?? 0} users with held cards`}
            />
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Recent drop engagement (7d)</h4>
            <div className="overflow-x-auto rounded-lg border border-cardBorder">
              <table className="min-w-full text-sm">
                <thead className="bg-canvas/80 text-left text-micro text-mutedSlate">
                  <tr>
                    <th className="p-3">Tier</th>
                    <th className="p-3">Scheduled</th>
                    <th className="p-3">Sell-through</th>
                    <th className="p-3">Buyers</th>
                    <th className="p-3">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {userHealth.dropEngagement.map((r) => {
                    const sellThrough = num(r.sell_through_pct);
                    const h = sellThrough >= 80 ? 'strong' : sellThrough >= 50 ? 'moderate' : 'weak';
                    return (
                      <tr key={String(r.id)} className="border-t border-cardBorder">
                        <td className="p-3">{String(r.tier_name)}</td>
                        <td className="p-3">{new Date(String(r.scheduled_at)).toLocaleDateString()}</td>
                        <td className="p-3 font-semibold">{sellThrough}%</td>
                        <td className="p-3 tabular-nums">{String(r.unique_buyers)}</td>
                        <td className="p-3">{h}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="text-featureHeading font-semibold mb-2">Auction participation (30d, settled)</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard
                label="Settled auctions"
                value={num(userHealth.auctionParticipation.total_auctions)}
              />
              <MetricCard
                label="No-bid auctions"
                value={num(userHealth.auctionParticipation.no_bid_auctions)}
                note="Zero distinct bidders"
                alert={
                  num(userHealth.auctionParticipation.total_auctions) > 0 &&
                  num(userHealth.auctionParticipation.no_bid_auctions) >
                    num(userHealth.auctionParticipation.total_auctions) * 0.3
                }
              />
              <MetricCard
                label="Competitive auctions"
                value={num(userHealth.auctionParticipation.competitive_auctions)}
                note="3+ distinct bidders"
              />
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
