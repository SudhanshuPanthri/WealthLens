"use client";

import { useState } from "react";
import { ArrowUpDown } from "lucide-react";
import type { EnrichedHolding } from "@/lib/metrics";
import { formatINR, formatPct, formatQty, pnlClass, BROKER_LABELS } from "@/lib/format";

type SortKey = "value" | "pnlPct" | "weightPct" | "dayChangePct" | "symbol";

export default function HoldingsTable({ holdings }: { holdings: EnrichedHolding[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("value");
  const [asc, setAsc] = useState(false);

  const sorted = [...holdings].sort((a, b) => {
    if (sortKey === "symbol") {
      return asc ? a.symbol.localeCompare(b.symbol) : b.symbol.localeCompare(a.symbol);
    }
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    return asc ? av - bv : bv - av;
  });

  function toggle(key: SortKey) {
    if (key === sortKey) setAsc(!asc);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  const Th = ({ label, k, align = "right" }: { label: string; k?: SortKey; align?: "left" | "right" }) => (
    <th
      className={`whitespace-nowrap px-3 py-2.5 text-${align} text-xs font-medium uppercase tracking-wide text-muted ${k ? "cursor-pointer select-none hover:text-ink" : ""}`}
      onClick={k ? () => toggle(k) : undefined}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {k && <ArrowUpDown className="h-3 w-3" />}
      </span>
    </th>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <Th label="Stock" k="symbol" align="left" />
              <Th label="Qty" />
              <Th label="Avg price" />
              <Th label="LTP" />
              <Th label="Value" k="value" />
              <Th label="P&L" k="pnlPct" />
              <Th label="Day" k="dayChangePct" />
              <Th label="Weight" k="weightPct" />
              <Th label="Broker" align="left" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((h) => (
              <tr key={`${h.broker}-${h.symbol}`} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                <td className="px-3 py-2.5">
                  <a href={`/stock/${h.symbol}?exchange=${h.exchange}`} className="block">
                    <div className="font-semibold hover:text-accent">{h.symbol}</div>
                    <div className="max-w-48 truncate text-xs text-muted">
                      {h.name ?? h.sector ?? ""}
                    </div>
                  </a>
                </td>
                <td className="px-3 py-2.5 text-right font-mono">{formatQty(h.quantity)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(h.avgPrice, true)}</td>
                <td className="px-3 py-2.5 text-right font-mono">{h.price !== null ? formatINR(h.price, true) : "—"}</td>
                <td className="px-3 py-2.5 text-right font-mono">{formatINR(h.value ?? h.invested)}</td>
                <td className={`px-3 py-2.5 text-right font-mono ${pnlClass(h.pnl)}`}>
                  <div>{formatINR(h.pnl)}</div>
                  <div className="text-xs">{formatPct(h.pnlPct)}</div>
                </td>
                <td className={`px-3 py-2.5 text-right font-mono ${pnlClass(h.dayChangePct)}`}>
                  {formatPct(h.dayChangePct)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono">
                  {h.weightPct !== null ? `${h.weightPct.toFixed(1)}%` : "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
                    {BROKER_LABELS[h.broker] ?? h.broker}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
