"use client";

import { useEffect, useState } from "react";
import { Wallet, TrendingDown, Percent, ArrowDownRight, Info } from "lucide-react";
import type { FeeSummary, FeeFund } from "@/lib/fees";
import { formatINR, formatPct } from "@/lib/format";

export default function FeesView() {
  const [summary, setSummary] = useState<FeeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/fees")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.summary) setSummary(d.summary);
        else setError(d.error ?? "Could not load fees.");
      })
      .catch(() => alive && setError("Could not load fees."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Fund fees</h1>
        <p className="mt-0.5 text-sm text-muted">
          What expense ratios cost you each year — and where switching to a Direct plan would save money.
        </p>
      </div>

      {error ? (
        <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">{error}</p>
      ) : !summary ? (
        <Skeleton />
      ) : (
        <Loaded summary={summary} />
      )}
    </div>
  );
}

function Loaded({ summary }: { summary: FeeSummary }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Wallet className="h-4 w-4 text-accent" />} label="Annual fee drag">
          <span className="font-mono text-xl font-semibold text-loss">{formatINR(summary.totalAnnualFee)}</span>
          <span className="text-xs text-muted">on {formatINR(summary.totalValue)} invested</span>
        </Card>
        <Card icon={<Percent className="h-4 w-4 text-accent" />} label="Weighted avg TER">
          <span className="font-mono text-xl font-semibold">{formatPct(summary.weightedTerPct, false)}</span>
          <span className="text-xs text-muted">across {summary.funds.length} fund(s)</span>
        </Card>
        <Card icon={<TrendingDown className="h-4 w-4 text-accent" />} label="Regular plans">
          <span className="font-mono text-xl font-semibold">{summary.regularCount}</span>
          <span className="text-xs text-muted">payer of distributor commission</span>
        </Card>
        <Card icon={<ArrowDownRight className="h-4 w-4 text-gain" />} label="Direct-switch saving">
          <span className="font-mono text-xl font-semibold text-gain">{formatINR(summary.switchableAnnualSaving)}/yr</span>
          <span className="text-xs text-muted">≈ {formatINR(summary.switchableProjectedSaving)} over {summary.projectionYears}y</span>
        </Card>
      </div>

      {summary.switchableAnnualSaving > 0 && (
        <div className="rounded-2xl border border-accent/30 bg-accent-soft p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ArrowDownRight className="h-4 w-4 text-gain" /> You&apos;re leaving money on the table
          </h2>
          <p className="mt-2 text-sm text-muted">
            You hold <span className="font-semibold text-ink">{summary.regularCount}</span> Regular-plan fund(s).
            Switching each to its <span className="font-semibold text-ink">Direct</span> plan — same fund, same
            manager, no distributor cut — would save about{" "}
            <span className="font-semibold text-gain">{formatINR(summary.switchableAnnualSaving)}</span> a year, roughly{" "}
            <span className="font-semibold text-gain">{formatINR(summary.switchableProjectedSaving)}</span> over{" "}
            {summary.projectionYears} years.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface">
        <h2 className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
          <Wallet className="h-4 w-4 text-muted" /> Fee by fund
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">Fund</th>
                <th className="px-3 py-2 text-center font-medium">Plan</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
                <th className="px-3 py-2 text-right font-medium">TER</th>
                <th className="px-3 py-2 text-right font-medium">Annual fee</th>
                <th className="px-5 py-2 text-right font-medium">Save (Direct)</th>
              </tr>
            </thead>
            <tbody>
              {summary.funds.map((f, i) => (
                <FundRow key={i} f={f} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Expense ratios are <strong>category-based estimates</strong> (no free API gives exact Indian TERs) — check
        each scheme&apos;s factsheet for the precise figure. The Regular-vs-Direct gap is the actionable part: a
        Direct plan is the identical fund without the distributor commission. Plan is inferred from the scheme name;
        funds without &ldquo;Direct&rdquo; are treated as Regular. Projection assumes today&apos;s value, ignoring growth.
        Rows marked <span className="font-mono">*</span> use your invested amount because the live NAV couldn&apos;t be resolved.
      </p>
    </>
  );
}

function FundRow({ f }: { f: FeeFund }) {
  return (
    <tr className="border-b border-border/50 last:border-0">
      <td className="px-5 py-2 font-medium">
        <span className="block max-w-[18rem] truncate">{f.schemeName}</span>
        <span className="text-xs capitalize text-muted">{f.category}</span>
      </td>
      <td className="px-3 py-2 text-center">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            f.plan === "Direct" ? "bg-success-soft text-gain" : "bg-danger-soft text-loss"
          }`}
        >
          {f.plan}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-muted">
        {formatINR(f.base)}
        {!f.liveValued && <span className="ml-1 text-[10px] text-muted">*</span>}
      </td>
      <td className="px-3 py-2 text-right font-mono text-muted">~{f.terPct.toFixed(2)}%</td>
      <td className="px-3 py-2 text-right font-mono text-loss">{formatINR(f.annualFee)}</td>
      <td className="px-5 py-2 text-right font-mono">
        {f.annualSaving > 0 ? (
          <span className="text-gain">{formatINR(f.annualSaving)}/yr</span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function Card({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {icon} {label}
      </p>
      <div className="mt-1.5 flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-2xl border border-border bg-surface p-4">
            <div className="skeleton h-3 w-24 rounded" />
            <div className="skeleton mt-3 h-6 w-20 rounded" />
          </div>
        ))}
      </div>
      <div className="skeleton h-64 w-full rounded-2xl" />
    </div>
  );
}
