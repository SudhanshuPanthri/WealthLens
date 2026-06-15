"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Layers, GitMerge, Info, TrendingUp, Trophy } from "lucide-react";
import type { CrossBrokerAnalytics, MergedPosition, NiftyBenchmark } from "@/lib/analytics";
import type { AllocationSlice } from "@/lib/metrics";
import { formatINR, formatPct, pnlClass, BROKER_LABELS } from "@/lib/format";

const COLORS = [
  "#f59e0b", "#818cf8", "#f472b6", "#34d399", "#60a5fa",
  "#fb923c", "#a78bfa", "#facc15", "#2dd4bf", "#4fd1c5",
  "#f87171", "#94a3b8",
];

interface Props {
  initialCrossBroker: CrossBrokerAnalytics;
  initialBenchmark: NiftyBenchmark;
}

export default function AnalyticsView({ initialCrossBroker, initialBenchmark }: Props) {
  const [cb, setCb] = useState(initialCrossBroker);
  const [bm, setBm] = useState(initialBenchmark);

  // Poll for live prices (mirrors the other live pages).
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/analytics");
        if (res.ok) {
          const data = await res.json();
          if (data.crossBroker) setCb(data.crossBroker);
          if (data.benchmark) setBm(data.benchmark);
        }
      } catch {
        // transient; keep last good data
      }
    };
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const c = cb.concentration;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cross-broker analytics</h1>
        <p className="mt-0.5 text-sm text-muted">
          Your true picture across every broker — merged exposure, market-cap mix, and how you
          stack up against the Nifty 50.
        </p>
      </div>

      {/* Nifty 50 benchmark */}
      <BenchmarkCard bm={bm} />

      {cb.totals.positionCount > 0 && (
        <>
          {/* Cross-broker exposure */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="text-sm font-semibold">True concentration</h2>
              <p className="mt-1 text-xs text-muted">
                {cb.totals.rowCount} holding rows across {cb.totals.brokerCount} broker
                {cb.totals.brokerCount === 1 ? "" : "s"} → {cb.totals.positionCount} real
                position{cb.totals.positionCount === 1 ? "" : "s"}.
              </p>
              <dl className="mt-4 space-y-3">
                <Meter label="Largest position" pct={c.top1Pct} warnAt={10} />
                <Meter label="Top 3 positions" pct={c.top3Pct} warnAt={35} />
                <Meter label="Top 5 positions" pct={c.top5Pct} warnAt={50} />
              </dl>
              <p className="mt-4 text-xs text-muted">
                Herfindahl index:{" "}
                <span className={`font-mono ${c.hhi > 1500 ? "text-warn" : "text-ink"}`}>{c.hhi}</span>{" "}
                {c.hhi > 2500 ? "(highly concentrated)" : c.hhi > 1500 ? "(concentrated)" : "(diversified)"}
              </p>
            </div>

            <MultiBrokerCard positions={cb.multiBroker} totalValue={cb.totals.value} />
          </div>

          {/* Allocation */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Donut title="By market cap" slices={cb.capAllocation} />
            <Donut title="By sector" slices={cb.sectorAllocation} />
          </div>

          {/* Merged positions */}
          <PositionsTable positions={cb.positions} />
        </>
      )}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        The benchmark replays your actual buy/sell cashflows into the Nifty 50 at each trade
        date&apos;s close — a money-weighted (XIRR) comparison, not a buy-and-hold one. Market
        data may be delayed. Not investment advice.
      </p>
    </div>
  );
}

function BenchmarkCard({ bm }: { bm: NiftyBenchmark }) {
  if (!bm.available) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-dashed border-border bg-surface px-5 py-4 text-sm text-muted">
        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {bm.reason ?? "Benchmark unavailable."}{" "}
          <Link href="/transactions" className="font-medium text-accent hover:underline">
            Import trades
          </Link>{" "}
          to compare your returns against the Nifty 50.
        </span>
      </div>
    );
  }

  const beat = (bm.alphaPct ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-accent" /> You vs Nifty 50
          <span className="font-normal text-muted">· since {bm.firstDate}</span>
        </h2>
        {bm.alphaPct !== null && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              beat ? "bg-gain/10 text-gain" : "bg-loss/10 text-loss"
            }`}
          >
            {beat ? "Beating" : "Trailing"} the Nifty by {formatPct(Math.abs(bm.alphaPct), false)}
          </span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Your XIRR" hint="Money-weighted annual return">
          <span className={`font-mono text-xl font-semibold ${pnlClass(bm.portfolioXirr)}`}>
            {bm.portfolioXirr !== null ? formatPct(bm.portfolioXirr * 100) : "—"}
          </span>
        </Stat>
        <Stat label="Nifty 50 XIRR" hint="Same cashflows, index instead">
          <span className={`font-mono text-xl font-semibold ${pnlClass(bm.niftyXirr)}`}>
            {bm.niftyXirr !== null ? formatPct(bm.niftyXirr * 100) : "—"}
          </span>
        </Stat>
        <Stat label="Your value vs Nifty" hint="Open positions, today">
          <span className="font-mono text-xl font-semibold">{formatINR(bm.portfolioValue)}</span>
          <span className="text-xs text-muted">Nifty would be {formatINR(bm.niftyValue)}</span>
        </Stat>
      </div>
    </div>
  );
}

function MultiBrokerCard({
  positions,
  totalValue,
}: {
  positions: MergedPosition[];
  totalValue: number;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <GitMerge className="h-4 w-4 text-accent" /> Held across brokers
      </h2>
      {positions.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No stock is split across more than one broker. Once it is, your real combined exposure
          shows up here — the view a single broker app can&apos;t give you.
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            Your true exposure to these stocks, summed across the brokers that each is spread over.
          </p>
          <ul className="mt-3 space-y-2.5">
            {positions.slice(0, 6).map((p) => {
              const eff = p.value ?? p.invested;
              const pct = totalValue > 0 ? (eff / totalValue) * 100 : 0;
              return (
                <li key={p.symbol} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/stock/${p.symbol}?exchange=${p.exchange}`}
                      className="font-medium hover:text-accent"
                    >
                      {p.symbol}
                    </Link>
                    <span className="ml-2 text-xs text-muted">
                      {p.brokers
                        .map((b) => `${BROKER_LABELS[b.broker] ?? b.broker} ×${trimQty(b.quantity)}`)
                        .join(" + ")}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="block font-mono text-sm">{formatINR(eff)}</span>
                    <span className="block text-[11px] text-muted">{pct.toFixed(1)}% of portfolio</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function PositionsTable({ positions }: { positions: MergedPosition[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <h2 className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
        <Layers className="h-4 w-4 text-muted" /> Merged positions
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-5 py-2 font-medium">Stock</th>
              <th className="px-3 py-2 text-center font-medium">Cap</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Value</th>
              <th className="px-3 py-2 text-right font-medium">P&amp;L</th>
              <th className="px-5 py-2 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.symbol} className="border-b border-border/50 last:border-0">
                <td className="px-5 py-2">
                  <Link
                    href={`/stock/${p.symbol}?exchange=${p.exchange}`}
                    className="font-medium hover:text-accent"
                  >
                    {p.symbol}
                  </Link>
                  {p.brokers.length > 1 && (
                    <span className="ml-2 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      {p.brokers.length} brokers
                    </span>
                  )}
                  {p.sector && <span className="ml-2 text-xs text-muted">{p.sector}</span>}
                </td>
                <td className="px-3 py-2 text-center text-xs text-muted">
                  {p.capTier.replace(" cap", "")}
                </td>
                <td className="px-3 py-2 text-right font-mono">{trimQty(p.quantity)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatINR(p.value ?? p.invested)}</td>
                <td className={`px-3 py-2 text-right font-mono ${pnlClass(p.pnl)}`}>
                  {p.pnl !== null ? formatINR(p.pnl) : "—"}
                  {p.pnlPct !== null && (
                    <span className="ml-1 text-[11px] text-muted">{formatPct(p.pnlPct)}</span>
                  )}
                </td>
                <td className="px-5 py-2 text-right font-mono">{p.weightPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Donut({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  const top = slices.slice(0, 11);
  const rest = slices.slice(11);
  const data = rest.length
    ? [...top, { label: "Others", value: rest.reduce((s, x) => s + x.value, 0), pct: rest.reduce((s, x) => s + x.pct, 0) }]
    : top;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 flex items-center gap-4">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={42} outerRadius={70} strokeWidth={0}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatINR(Number(value))}
                contentStyle={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--fg)",
                }}
                itemStyle={{ color: "var(--fg)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {data.slice(0, 6).map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="truncate text-muted">{s.label}</span>
              <span className="ml-auto font-mono">{s.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Meter({ label, pct, warnAt }: { label: string; pct: number; warnAt: number }) {
  const over = pct > warnAt;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <dt className="text-muted">{label}</dt>
        <dd className={`font-mono ${over ? "text-warn" : ""}`}>{pct.toFixed(1)}%</dd>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

function Stat({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1.5 flex flex-col gap-0.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function trimQty(q: number): string {
  return Number.isInteger(q) ? String(q) : q.toFixed(2);
}
