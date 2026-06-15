"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import type { PortfolioMetrics } from "@/lib/metrics";
import { formatINR, formatPct, pnlClass } from "@/lib/format";
import AllocationCharts from "@/components/AllocationCharts";
import HoldingsTable from "@/components/HoldingsTable";
import IndicesStrip from "@/components/IndicesStrip";

const POLL_MS = 30_000;

/**
 * Live dashboard. Seeded with server-rendered metrics for instant first paint,
 * then polls /api/portfolio so holdings + prices stay current without a reload
 * or re-upload. Holdings themselves persist in the DB until the next import.
 */
export default function DashboardView({ initialMetrics }: { initialMetrics: PortfolioMetrics }) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [updatedAt, setUpdatedAt] = useState<string>(initialMetrics.quotesAsOf);
  const [refreshing, setRefreshing] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/portfolio");
      if (res.ok) {
        const data = await res.json();
        if (data.metrics) {
          setMetrics(data.metrics);
          setUpdatedAt(data.metrics.quotesAsOf);
        }
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

  const { totals } = metrics;

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
            · {totals.holdingsCount} holdings
            {totals.pricedCount < totals.holdingsCount && ` · priced ${totals.pricedCount}`}
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
        <StatCard label="Current value" value={formatINR(totals.currentValue)} />
        <StatCard label="Invested" value={formatINR(totals.invested)} />
        <StatCard label="Total P&L" value={formatINR(totals.pnl)} sub={formatPct(totals.pnlPct)} tone={totals.pnl} />
        <StatCard
          label="Day change"
          value={formatINR(totals.dayChange)}
          sub={formatPct(totals.dayChangePct)}
          tone={totals.dayChange}
        />
      </div>

      <AllocationCharts
        sector={metrics.sectorAllocation}
        broker={metrics.brokerAllocation}
        concentration={metrics.concentration}
      />

      <HoldingsTable holdings={metrics.holdings} />
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
  sub?: string;
  tone?: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 font-mono text-xl font-semibold ${tone !== undefined ? pnlClass(tone) : ""}`}>{value}</p>
      {sub && <p className={`mt-0.5 font-mono text-sm ${pnlClass(tone)}`}>{sub}</p>}
    </div>
  );
}
