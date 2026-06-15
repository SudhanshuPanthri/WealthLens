"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PnlSummary } from "@/lib/pnl";
import type { LedgerRow } from "@/app/api/transactions/route";
import { formatINR, formatPct, formatQty, pnlClass } from "@/lib/format";
import TransactionsImport from "@/components/TransactionsImport";

const POLL_MS = 30_000;

export default function TransactionsView({
  initialSummary,
  initialLedger,
  initialCount,
}: {
  initialSummary: PnlSummary;
  initialLedger: LedgerRow[];
  initialCount: number;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [ledger, setLedger] = useState(initialLedger);
  const [count, setCount] = useState(initialCount);
  const [showImport, setShowImport] = useState(initialCount === 0);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/transactions");
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setSummary(data.summary);
        if (Array.isArray(data.ledger)) setLedger(data.ledger);
        if (typeof data.count === "number") setCount(data.count);
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (count === 0) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [count]);

  if (count === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Transactions &amp; P&amp;L</h1>
          <p className="mt-1 text-sm text-muted">
            Import your buy/sell history to see realized P&amp;L, XIRR, and how your invested capital
            grew over time.
          </p>
        </div>
        <TransactionsImport onDone={refresh} />
      </div>
    );
  }

  const totalReturn = summary.totalUnrealized + summary.totalRealized;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Transactions &amp; P&amp;L</h1>
          <p className="mt-1 text-sm text-muted">
            {summary.tradeCount} trades · {summary.buyCount} buys · {summary.sellCount} sells
            {summary.firstTradeDate && ` · since ${summary.firstTradeDate}`}
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
          <button
            onClick={() => setShowImport((s) => !s)}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Import trades
          </button>
        </div>
      </div>

      {showImport && <TransactionsImport onDone={refresh} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Open invested" value={formatINR(summary.totalInvested)} />
        <Stat label="Current value" value={formatINR(summary.currentValue)} />
        <Stat label="Unrealized P&L" value={formatINR(summary.totalUnrealized)} tone={summary.totalUnrealized} />
        <Stat label="Realized P&L" value={formatINR(summary.totalRealized)} tone={summary.totalRealized} />
        <Stat
          label="XIRR"
          value={summary.xirr !== null ? formatPct(summary.xirr * 100) : "—"}
          tone={summary.xirr}
          sub="annualized"
        />
      </div>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Capital deployed over time</h2>
          <span className={`font-mono text-sm ${pnlClass(totalReturn)}`}>
            Total return {formatINR(totalReturn)}
          </span>
        </div>
        <div className="mt-4 h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={summary.series} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="investedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="realizedFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#818cf8" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "var(--muted)" }}
                tickLine={false}
                axisLine={false}
                width={56}
                tickFormatter={(v: number) => `₹${Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + "L" : (v / 1000).toFixed(0) + "k"}`}
              />
              <Tooltip
                formatter={(value, name) => [formatINR(Number(value)), name === "invested" ? "Net invested" : "Realized P&L"]}
                labelStyle={{ color: "var(--muted)" }}
                contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--fg)" }}
              />
              <Legend
                formatter={(v) => (v === "invested" ? "Net invested" : "Realized P&L")}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Area type="monotone" dataKey="invested" stroke="var(--accent)" strokeWidth={2} fill="url(#investedFill)" />
              <Area type="monotone" dataKey="realized" stroke="#818cf8" strokeWidth={2} fill="url(#realizedFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-muted">
          Net invested = cumulative buy cost minus sell proceeds. Realized P&amp;L uses FIFO matching.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Positions</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 text-left">Stock</th>
                <th className="px-3 py-2.5 text-right">Open qty</th>
                <th className="px-3 py-2.5 text-right">Avg cost</th>
                <th className="px-3 py-2.5 text-right">LTP</th>
                <th className="px-3 py-2.5 text-right">Value</th>
                <th className="px-3 py-2.5 text-right">Unrealized</th>
                <th className="px-4 py-2.5 text-right">Realized</th>
              </tr>
            </thead>
            <tbody>
              {summary.positions.map((p) => (
                <tr key={`${p.symbol}-${p.exchange}`} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5">
                    <a href={`/stock/${p.symbol}?exchange=${p.exchange}`} className="font-semibold hover:text-accent">
                      {p.symbol}
                    </a>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{p.openQty > 0 ? formatQty(p.openQty) : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{p.openQty > 0 ? formatINR(p.avgCost, true) : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(p.price, true)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(p.value)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${pnlClass(p.unrealizedPnl)}`}>
                    {p.unrealizedPnl !== null ? formatINR(p.unrealizedPnl) : "—"}
                  </td>
                  <td className={`px-4 py-2.5 text-right font-mono ${pnlClass(p.realizedPnl)}`}>
                    {p.realizedPnl !== 0 ? formatINR(p.realizedPnl) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Trade ledger</h2>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 text-left">Date</th>
                <th className="px-3 py-2.5 text-left">Stock</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {ledger.slice(0, 100).map((t) => (
                <tr key={t.id} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs text-muted">{t.tradedAt}</td>
                  <td className="px-3 py-2 font-semibold">{t.symbol}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-medium ${t.type === "BUY" ? "text-gain" : "text-loss"}`}>{t.type}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatQty(t.quantity)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatINR(t.price, true)}</td>
                  <td className="px-4 py-2 text-right font-mono">{formatINR(t.quantity * t.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledger.length > 100 && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted">
              Showing latest 100 of {ledger.length} trades.
            </p>
          )}
        </div>
      </section>

      <p className="text-xs text-muted">
        FIFO realized P&amp;L and XIRR are estimates from your imported trades; they don&apos;t include
        dividends or corporate actions. Not investment advice.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: number | null;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-2 font-mono text-lg font-semibold ${tone !== undefined && tone !== null ? pnlClass(tone) : ""}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}
