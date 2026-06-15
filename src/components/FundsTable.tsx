"use client";

import { Landmark } from "lucide-react";
import type { FundMetrics } from "@/lib/funds";
import { formatINR, formatPct, formatQty, pnlClass } from "@/lib/format";

export default function FundsTable({ funds }: { funds: FundMetrics }) {
  const { totals } = funds;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Landmark className="h-4 w-4 text-accent" /> Mutual funds
        </h2>
        <p className="text-sm text-muted">
          {formatINR(totals.currentValue)} value ·{" "}
          <span className={`font-mono ${pnlClass(totals.pnl)}`}>
            {formatINR(totals.pnl)} ({formatPct(totals.pnlPct)})
          </span>
          {totals.pricedCount < totals.count && ` · priced ${totals.pricedCount}/${totals.count}`}
        </p>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="px-3 py-2.5 text-left font-medium">Scheme</th>
                <th className="px-3 py-2.5 text-right font-medium">Units</th>
                <th className="px-3 py-2.5 text-right font-medium">Avg NAV</th>
                <th className="px-3 py-2.5 text-right font-medium">NAV</th>
                <th className="px-3 py-2.5 text-right font-medium">Invested</th>
                <th className="px-3 py-2.5 text-right font-medium">Value</th>
                <th className="px-3 py-2.5 text-right font-medium">P&amp;L</th>
                <th className="px-3 py-2.5 text-right font-medium">Weight</th>
              </tr>
            </thead>
            <tbody>
              {funds.funds.map((f, i) => (
                <tr key={`${f.isin ?? f.schemeName}-${f.folio ?? i}`} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5">
                    <div className="max-w-80 truncate font-medium">{f.schemeName}</div>
                    <div className="text-xs text-muted">
                      {[f.amc, f.category, f.folio ? `Folio ${f.folio}` : null].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatQty(f.units)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(f.avgNav, true)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{f.nav !== null ? formatINR(f.nav, true) : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(f.invested)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatINR(f.value ?? f.invested)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono ${pnlClass(f.pnl)}`}>
                    <div>{f.pnl !== null ? formatINR(f.pnl) : "—"}</div>
                    <div className="text-xs">{formatPct(f.pnlPct)}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    {f.weightPct !== null ? `${f.weightPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
