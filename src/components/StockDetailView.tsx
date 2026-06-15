"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, ArrowDownRight, Star, Loader2 } from "lucide-react";
import type { StockDetail } from "@/lib/quotes";
import { formatINR, formatPct, formatCroreINR, pnlClass } from "@/lib/format";
import PriceChart from "@/components/PriceChart";

const RANGES = ["1M", "6M", "1Y", "5Y"] as const;
type Range = (typeof RANGES)[number];

export default function StockDetailView({
  initial,
  initiallyWatched,
}: {
  initial: StockDetail;
  initiallyWatched: boolean;
}) {
  const [detail, setDetail] = useState(initial);
  const [range, setRange] = useState<Range>("1Y");
  const [loadingChart, setLoadingChart] = useState(false);
  const [watched, setWatched] = useState(initiallyWatched);
  const [busy, setBusy] = useState(false);

  async function changeRange(r: Range) {
    if (r === range) return;
    setRange(r);
    setLoadingChart(true);
    try {
      const res = await fetch(`/api/stock/${detail.symbol}?exchange=${detail.exchange}&range=${r}`);
      if (res.ok) {
        const data = await res.json();
        if (data.detail) setDetail(data.detail);
      }
    } finally {
      setLoadingChart(false);
    }
  }

  async function toggleWatch() {
    setBusy(true);
    try {
      if (watched) {
        await fetch(`/api/watchlist?symbol=${detail.symbol}&exchange=${detail.exchange}`, {
          method: "DELETE",
        });
        setWatched(false);
      } else {
        await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: detail.symbol, exchange: detail.exchange, name: detail.name }),
        });
        setWatched(true);
      }
    } finally {
      setBusy(false);
    }
  }

  const up = (detail.dayChange ?? 0) >= 0;
  const changeAbs =
    detail.price !== null && detail.prevClose !== null ? detail.price - detail.prevClose : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <button
          onClick={toggleWatch}
          disabled={busy}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-60 ${
            watched
              ? "border-accent/50 bg-accent/10 text-accent"
              : "border-border hover:bg-surface-2"
          }`}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Star className={`h-4 w-4 ${watched ? "fill-accent" : ""}`} />
          )}
          {watched ? "In watchlist" : "Add to watchlist"}
        </button>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{detail.symbol}</h1>
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">{detail.exchange}</span>
        </div>
        <p className="mt-0.5 text-sm text-muted">{detail.name ?? detail.sector ?? ""}</p>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-mono text-3xl font-semibold">{formatINR(detail.price, true)}</span>
          <span className={`flex items-center gap-1 font-mono text-sm ${up ? "text-gain" : "text-loss"}`}>
            {up ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
            {changeAbs !== null && `${up ? "+" : ""}${changeAbs.toFixed(2)} `}
            ({formatPct(detail.dayChange)})
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Market cap" value={formatCroreINR(detail.marketCap)} />
        <Stat label="P/E (TTM)" value={detail.trailingPE !== null ? detail.trailingPE.toFixed(2) : "—"} />
        <Stat label="52-week high" value={formatINR(detail.high52, true)} />
        <Stat label="52-week low" value={formatINR(detail.low52, true)} />
        <Stat label="Prev. close" value={formatINR(detail.prevClose, true)} />
        <Stat label="Sector" value={detail.sector ?? "—"} />
        <Stat label="Industry" value={detail.industry ?? "—"} small />
        <Stat
          label="From 52w high"
          value={
            detail.high52 && detail.price
              ? formatPct(((detail.price - detail.high52) / detail.high52) * 100)
              : "—"
          }
          tone={detail.high52 && detail.price ? detail.price - detail.high52 : undefined}
        />
      </div>

      {detail.description && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="text-sm font-semibold">About</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{detail.description}</p>
        </div>
      )}

      <p className="text-xs text-muted">
        Live data via Yahoo Finance · may be delayed. Not investment advice.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  small,
}: {
  label: string;
  value: string;
  tone?: number;
  small?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p
        className={`mt-1.5 font-mono font-semibold ${small ? "text-sm" : "text-base"} ${
          tone !== undefined ? pnlClass(tone) : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
