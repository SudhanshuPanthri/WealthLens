"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { PortfolioMetrics } from "@/lib/metrics";
import type { FundMetrics } from "@/lib/funds";
import { formatINR, formatPct, pnlClass } from "@/lib/format";
import AllocationCharts from "@/components/AllocationCharts";
import HoldingsTable from "@/components/HoldingsTable";
import FundsTable from "@/components/FundsTable";
import IndicesStrip from "@/components/IndicesStrip";

const POLL_MS = 30_000;

interface Props {
  initialMetrics: PortfolioMetrics | null;
  initialFunds: FundMetrics | null;
}

/**
 * Live dashboard. Seeded with server-rendered metrics for instant first paint,
 * then polls /api/portfolio so holdings + prices stay current without a reload
 * or re-upload. Surfaces stocks and mutual funds in one unified net-worth view.
 */
export default function DashboardView({ initialMetrics, initialFunds }: Props) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [funds, setFunds] = useState(initialFunds);
  const [updatedAt, setUpdatedAt] = useState<string>(
    initialMetrics?.quotesAsOf ?? initialFunds?.asOf ?? new Date().toISOString(),
  );
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const data = await res.json();
        setMetrics(data.metrics ?? null);
        setFunds(data.funds ?? null);
        setUpdatedAt(data.metrics?.quotesAsOf ?? data.funds?.asOf ?? new Date().toISOString());
      }
    } catch {
      /* keep showing last good values */
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const s = metrics?.totals;
  const f = funds?.totals;
  // Combined (stocks + funds) net-worth view.
  const currentValue = (s?.currentValue ?? 0) + (f?.currentValue ?? 0);
  const invested = (s?.invested ?? 0) + (f?.invested ?? 0);
  const pnl = currentValue - invested;
  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
  const stockCount = s?.holdingsCount ?? 0;
  const fundCount = f?.count ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gain opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gain" />
              </span>
              Live
            </span>
            {stockCount > 0 && ` · ${stockCount} stock${stockCount === 1 ? "" : "s"}`}
            {fundCount > 0 && ` · ${fundCount} fund${fundCount === 1 ? "" : "s"}`}
            · updated {new Date(updatedAt).toLocaleTimeString("en-IN")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <Link href="/import" className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2">
            Import more
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Markets · NSE &amp; BSE</h2>
        <IndicesStrip />
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Net worth" value={formatINR(currentValue)} sub={fundCount > 0 && stockCount > 0 ? `${formatINR(s?.currentValue ?? 0)} stocks · ${formatINR(f?.currentValue ?? 0)} funds` : undefined} />
        <StatCard label="Invested" value={formatINR(invested)} />
        <StatCard label="Total P&L" value={formatINR(pnl)} sub={formatPct(pnlPct)} tone={pnl} />
        {s ? (
          <StatCard label="Day change" value={formatINR(s.dayChange)} sub={`${formatPct(s.dayChangePct)} · stocks`} tone={s.dayChange} />
        ) : (
          <StatCard label="Funds value" value={formatINR(f?.currentValue ?? 0)} sub={`${fundCount} scheme${fundCount === 1 ? "" : "s"}`} />
        )}
      </div>

      {metrics && (
        <>
          <AllocationCharts
            sector={metrics.sectorAllocation}
            broker={metrics.brokerAllocation}
            concentration={metrics.concentration}
          />
          <HoldingsTable holdings={metrics.holdings} />
        </>
      )}

      {funds && <FundsTable funds={funds} />}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string | false;
  tone?: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 font-mono text-xl font-semibold ${tone !== undefined ? pnlClass(tone) : ""}`}>{value}</p>
      {sub && <p className={`mt-0.5 font-mono text-sm ${tone !== undefined ? pnlClass(tone) : "text-muted"}`}>{sub}</p>}
    </div>
  );
}
