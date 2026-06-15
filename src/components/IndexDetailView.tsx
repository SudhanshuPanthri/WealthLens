"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { IndexDetail } from "@/lib/market";
import { formatPct, pnlClass } from "@/lib/format";
import PriceChart from "@/components/PriceChart";

const RANGES = ["1M", "6M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

function fmtNum(n: number | null | undefined, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default function IndexDetailView({ initial }: { initial: IndexDetail }) {
  const [detail, setDetail] = useState(initial);
  const [range, setRange] = useState<Range>("1Y");
  const [loadingChart, setLoadingChart] = useState(false);

  async function changeRange(r: Range) {
    if (r === range) return;
    setRange(r);
    setLoadingChart(true);
    try {
      const res = await fetch(`/api/index/${detail.slug}?range=${r}`);
      if (res.ok) {
        const data = await res.json();
        if (data.detail) setDetail(data.detail);
      }
    } finally {
      setLoadingChart(false);
    }
  }

  const up = (detail.changePct ?? 0) >= 0;

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{detail.name}</h1>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{detail.exchange}</span>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-mono text-muted">{detail.symbol}</span>
        </div>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold">{fmtNum(detail.price)}</span>
          <span className={`flex items-center gap-1 font-mono text-sm ${up ? "text-gain" : "text-loss"}`}>
            {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {detail.change !== null && `${up ? "+" : ""}${detail.change.toFixed(2)} `}
            ({formatPct(detail.changePct)})
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex items-center justify-end gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => changeRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                r === range ? "bg-accent text-bg" : "text-muted hover:bg-surface-2"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <div className={loadingChart ? "opacity-50 transition-opacity" : "transition-opacity"}>
          <PriceChart data={detail.chart} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Prev. close" value={fmtNum(detail.prevClose)} />
        <Stat label="Day high" value={fmtNum(detail.dayHigh)} />
        <Stat label="Day low" value={fmtNum(detail.dayLow)} />
        <Stat label="52-week high" value={fmtNum(detail.yearHigh)} />
        <Stat label="52-week low" value={fmtNum(detail.yearLow)} />
        <Stat
          label="From 52w high"
          value={
            detail.yearHigh && detail.price
              ? formatPct(((detail.price - detail.yearHigh) / detail.yearHigh) * 100)
              : "—"
          }
          tone={detail.yearHigh && detail.price ? detail.price - detail.yearHigh : undefined}
        />
      </div>

      <p className="text-xs text-muted">
        Live data via Yahoo Finance · may be delayed. Not investment advice.
      </p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1.5 font-mono text-base font-semibold ${tone !== undefined ? pnlClass(tone) : ""}`}>
        {value}
      </p>
    </div>
  );
}
