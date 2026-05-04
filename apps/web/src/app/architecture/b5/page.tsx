import type { Metadata } from 'next';
import Link from 'next/link';

import { DocArticle, DocCallout } from '@/components/architecture/DocArticle';
import { MermaidDiagram } from '@/components/architecture/MermaidDiagram';

export const metadata: Metadata = {
  title: 'B5 · Platform health dashboard',
  description:
    'Admin economics page extensions: fraud metrics, economic health alerts, fairness audit reuse, and user engagement KPIs.',
};

export default function ArchitectureB5Page() {
  return (
    <DocArticle
      title="B5 — Extended platform health dashboard"
      subtitle="One admin surface (/admin/economics) pulls fraud pressure, margin reality, statistical pack fairness, and user engagement in parallel — with refresh controls and data-as-of timestamps."
    >
      <section>
        <h2>Goal</h2>
        <p>
          B1–B4 generate telemetry (rate limits, rebalances, audit stats, verification stamps). B5 aggregates
          those signals for operators: abuse pressure, economic drift from targets, confidence in randomness,
          and cohort engagement — without logging into multiple tools.
        </p>
      </section>

      <section>
        <h2>Architecture</h2>
        <p>
          Client component <code>PlatformHealthB5.tsx</code> calls{' '}
          <code>Promise.all([…])</code> against four endpoints on load and when you click refresh:
        </p>
        <ul>
          <li>
            <code>GET /api/admin/fraud-metrics</code> — last-24h rate-limit counts (by endpoint / limit type),
            hourly timeline for sparkline, 7-day bot signal mix, suspicious-account summary, top accounts by
            score.
          </li>
          <li>
            <code>GET /api/admin/economic-health</code> — rolling margins vs tier price from realized pack
            contents, ledger revenue streams, short revenue trend, projections; alert bands vs healthy margin
            range.
          </li>
          <li>
            <code>GET /api/audit/packs</code> — same public fairness payload B4 exposes (chi-squared / p-value
            over recent opens, verification-page usage).
          </li>
          <li>
            <code>GET /api/admin/user-health</code> — drop sell-through, auction participation / no-bid rates,
            retention proxy, new vs returning buyers, portfolio value stats.
          </li>
        </ul>
        <p>
          Each route uses authenticated <code>requireUser()</code> except the audit endpoint (already public).
          Heavy lifting is SQL via Drizzle <code>db.execute</code> with typed row shaping.
        </p>
      </section>

      <section>
        <h2>UI building blocks</h2>
        <p>
          <code>MetricCard</code> standardizes label, primary value, footnote, and alert styling so panels stay
          visually consistent. Alerts highlight threshold breaches (e.g. too many rate-limit hits, margin outside
          band, low p-value on fairness).
        </p>
      </section>

      <section>
        <h2>How to see it</h2>
        <p>
          Sign in as an admin user and open{' '}
          <Link href="/admin/economics" className="font-medium text-actionBlue underline underline-offset-2">
            /admin/economics
          </Link>
          . Scroll to the B5 sections below the legacy economics panels; use &quot;Refresh dashboard&quot; to
          snapshot fresh numbers after incidents or releases.
        </p>
      </section>

      <section>
        <h2>Sequence diagram</h2>
        <MermaidDiagram chart={`sequenceDiagram
  autonumber
  participant Admin as Admin UI (/admin/economics)
  participant B5 as PlatformHealthB5.tsx
  participant Fraud as /api/admin/fraud-metrics
  participant Econ as /api/admin/economic-health
  participant Audit as /api/audit/packs
  participant User as /api/admin/user-health
  participant DB as Postgres

  Admin->>B5: Open page / click Refresh dashboard
  B5->>Fraud: GET fraud metrics
  B5->>Econ: GET economic health
  B5->>Audit: GET pack fairness audit
  B5->>User: GET user health KPIs

  par Fraud panel
    Fraud->>DB: rate_limit_events + bot_signals + suspicious_accounts aggregates
    DB-->>Fraud: 24h/7d abuse metrics
    Fraud-->>B5: fraud payload
  and Economics panel
    Econ->>DB: realized margins + ledger revenue trends/projections
    DB-->>Econ: economic health payload
    Econ-->>B5: economics payload
  and Fairness panel
    Audit->>DB: recent pack outcomes + expected rarity model
    DB-->>Audit: chi-squared/p-value summary
    Audit-->>B5: fairness payload
  and User panel
    User->>DB: sell-through, participation, retention, buyer mix
    DB-->>User: engagement payload
    User-->>B5: user-health payload
  end

  B5-->>Admin: Render cards, alerts, timestamps, and refresh state`} />
      </section>

      <section>
        <h2>Files to read</h2>
        <ul>
          <li>
            <code>apps/web/src/app/api/admin/fraud-metrics/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/api/admin/economic-health/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/api/admin/user-health/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/admin/economics/PlatformHealthB5.tsx</code>
          </li>
          <li>
            <code>apps/web/src/components/admin/MetricCard.tsx</code>
          </li>
        </ul>
      </section>

      <DocCallout title="Privacy / safety">
        Admin routes expose aggregate or operational data — keep production access controlled; never embed
        service keys in the browser bundle.
      </DocCallout>
    </DocArticle>
  );
}
