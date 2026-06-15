"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { IndexQuote } from "@/lib/market";

function fmtNum(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Compact live NSE/BSE index ticker for the dashboard. Auto-refreshes. */
export default function IndicesStrip() {
  const [indices, setIndices] = useState<IndexQuote[] | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/market");
        if (!res.ok) return;
        const data = await res.json();
        if (alive) setIndices(data.indices);
      } catch {
        /* keep last values */
      }
    }
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!indices) {
    return <div className="h-[68px] animate-pulse rounded-2xl border border-border bg-surface" />;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {indices.map((i) => {
        const up = (i.changePct ?? 0) >= 0;
        return (
          <Link
            key={i.name}
            href={`/index/${i.slug}`}
            className="group rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/50 hover:bg-surface-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted group-hover:text-ink">{i.name}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">{i.exchange}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-sm font-semibold">{fmtNum(i.price)}</span>
              <span className={`flex items-center gap-0.5 font-mono text-xs ${up ? "text-gain" : "text-loss"}`}>
                {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {i.changePct === null ? "—" : `${up ? "+" : ""}${i.changePct.toFixed(2)}%`}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
