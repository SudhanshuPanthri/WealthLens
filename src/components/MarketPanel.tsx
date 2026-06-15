"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownRight, Loader2, RefreshCw } from "lucide-react";
import type { MarketSnapshot, IndexQuote, Mover, FundQuote } from "@/lib/market";

function pctColor(n: number | null | undefined) {
  if (n === null || n === undefined) return "text-muted";
  return n >= 0 ? "text-gain" : "text-loss";
}
function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
function fmtNum(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function MarketPanel() {
  const [data, setData] = useState<MarketSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/market");
      if (!res.ok) throw new Error();
      setData(await res.json());
      setError(null);
    } catch {
      setError("Live market data is unavailable right now.");
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000); // refresh each minute
    return () => clearInterval(id);
  }, []);

  if (error && !data) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-sm text-muted">{error}</div>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-border bg-surface p-12 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" /> <span className="ml-2 text-sm">Loading live markets…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {data.indices.map((i) => (
          <IndexCard key={i.name} idx={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <MoverCard title="Large cap" subtitle="Top movers today" movers={data.largeCap} />
        <MoverCard title="Mid cap" subtitle="Top movers today" movers={data.midCap} />
        <MoverCard title="Small cap" subtitle="Top movers today" movers={data.smallCap} />
      </div>

      <FundsCard funds={data.funds} />

      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <RefreshCw className="h-3 w-3" />
        Auto-refreshing · prices may be delayed · {new Date(data.asOf).toLocaleTimeString("en-IN")}
      </p>
    </div>
  );
}

function IndexCard({ idx }: { idx: IndexQuote }) {
  const up = (idx.changePct ?? 0) >= 0;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{idx.name}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{idx.exchange}</span>
      </div>
      <p className="mt-2 font-mono text-lg font-semibold">{fmtNum(idx.price)}</p>
      <p className={`flex items-center gap-1 font-mono text-xs ${pctColor(idx.changePct)}`}>
        {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {fmtNum(idx.change)} ({fmtPct(idx.changePct)})
      </p>
    </div>
  );
}

function MoverCard({ title, subtitle, movers }: { title: string; subtitle: string; movers: Mover[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted">{subtitle}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {movers.length === 0 && <li className="text-xs text-muted">No data.</li>}
        {movers.map((m) => (
          <li key={m.symbol} className="flex items-center justify-between text-sm">
            <span className="truncate font-medium">{m.symbol}</span>
            <span className="flex items-center gap-3">
              <span className="font-mono text-xs text-muted">{fmtNum(m.price)}</span>
              <span className={`w-16 text-right font-mono text-xs ${pctColor(m.changePct)}`}>
                {fmtPct(m.changePct)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FundsCard({ funds }: { funds: FundQuote[] }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">Mutual funds</h3>
      <p className="text-xs text-muted">Direct-plan NAV · approx. 1-year return</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Fund</th>
              <th className="py-1.5 pr-3">Category</th>
              <th className="py-1.5 pr-3 text-right">NAV</th>
              <th className="py-1.5 text-right">1Y</th>
            </tr>
          </thead>
          <tbody>
            {funds.length === 0 && (
              <tr>
                <td colSpan={4} className="py-2 text-xs text-muted">
                  Fund data is unavailable right now.
                </td>
              </tr>
            )}
            {funds.map((f) => (
              <tr key={f.name} className="border-t border-border/50">
                <td className="max-w-[18rem] truncate py-2 pr-3 font-medium">{f.name}</td>
                <td className="py-2 pr-3 text-xs text-muted">{f.category}</td>
                <td className="py-2 pr-3 text-right font-mono text-xs">{fmtNum(f.nav)}</td>
                <td className={`py-2 text-right font-mono text-xs ${pctColor(f.return1y)}`}>
                  {fmtPct(f.return1y)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
