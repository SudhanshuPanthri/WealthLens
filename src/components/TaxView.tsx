"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingDown, Gift, Hourglass, Info, Receipt } from "lucide-react";
import type { TaxSummary, HarvestCandidate } from "@/lib/tax";
import { formatINR, formatPct, pnlClass } from "@/lib/format";

export default function TaxView({ initial }: { initial: TaxSummary }) {
  const [summary, setSummary] = useState(initial);
  const [fy, setFy] = useState(initial.fy);
  const [loading, setLoading] = useState(false);

  async function load(targetFy: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/tax?fy=${targetFy}`);
      if (res.ok) {
        const data = await res.json();
        if (data.summary) setSummary(data.summary);
      }
    } finally {
      setLoading(false);
    }
  }

  // Refresh on FY change, and poll the current view for live unrealized figures.
  useEffect(() => {
    const id = setInterval(() => load(fy), 60_000);
    return () => clearInterval(id);
  }, [fy]);

  function changeFy(next: string) {
    setFy(next);
    load(next);
  }

  const r = summary.realized;
  const a = summary.ltcgAllowance;
  const h = summary.harvest;
  const usedPct = a.exemption > 0 ? Math.min(100, (a.used / a.exemption) * 100) : 0;

  return (
    <div className={`space-y-6 ${loading ? "opacity-60 transition-opacity" : "transition-opacity"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Capital gains &amp; tax</h1>
          <p className="mt-0.5 text-sm text-muted">
            Realized tax for the year, plus levers to legally pay less.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">FY</span>
          <select
            value={fy}
            onChange={(e) => changeFy(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          >
            {summary.availableFys.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Realized gains + estimated tax */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Short-term gain" hint="Held ≤ 12 months">
          <span className={`font-mono text-xl font-semibold ${pnlClass(r.stcgGain)}`}>
            {formatINR(r.stcgGain, true)}
          </span>
          <span className="text-xs text-muted">tax ≈ {formatINR(r.stcgTax)} @ {(summary.rules.stcgRate * 100).toFixed(0)}%</span>
        </Card>
        <Card label="Long-term gain" hint="Held > 12 months">
          <span className={`font-mono text-xl font-semibold ${pnlClass(r.ltcgGain)}`}>
            {formatINR(r.ltcgGain, true)}
          </span>
          <span className="text-xs text-muted">tax ≈ {formatINR(r.ltcgTax)} @ {(summary.rules.ltcgRate * 100).toFixed(1)}%</span>
        </Card>
        <Card label="Estimated tax" hint="STCG + LTCG, this FY">
          <span className="font-mono text-xl font-semibold">{formatINR(r.totalTax)}</span>
          <span className="text-xs text-muted">{r.disposals.length} disposal(s)</span>
        </Card>
        <Card label="Unrealized" hint="If you sold everything today">
          <span className={`font-mono text-xl font-semibold ${pnlClass(summary.unrealized.stcgGain + summary.unrealized.ltcgGain)}`}>
            {formatINR(summary.unrealized.stcgGain + summary.unrealized.ltcgGain, true)}
          </span>
          <span className="text-xs text-muted">
            ST {formatINR(summary.unrealized.stcgGain)} · LT {formatINR(summary.unrealized.ltcgGain)}
          </span>
        </Card>
      </div>

      {/* LTCG allowance meter */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="h-4 w-4 text-accent" /> LTCG free allowance
          </h2>
          <span className="text-sm text-muted">
            {formatINR(a.used)} of {formatINR(a.exemption)} used
          </span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent" style={{ width: `${usedPct}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted">
          {a.remaining > 0 ? (
            <>
              You can still realize <span className="font-semibold text-ink">{formatINR(a.remaining)}</span> of
              long-term gains tax-free this year.
            </>
          ) : (
            <>You&apos;ve used your full ₹1.25L long-term exemption for {fy}.</>
          )}
        </p>
      </div>

      {/* Harvesting opportunities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HarvestPanel
          icon={<TrendingDown className="h-4 w-4 text-loss" />}
          title="Tax-loss harvesting"
          empty="No open positions are in a loss right now."
          candidates={h.lossCandidates}
          headline={
            h.lossCandidates.length > 0 ? (
              <>
                Booking <span className="font-semibold text-ink">{formatINR(h.totalHarvestableLoss)}</span> of losses
                could save up to <span className="font-semibold text-gain">{formatINR(h.estLossTaxSaved)}</span> in tax.
              </>
            ) : null
          }
          renderRight={(c) => <span className="font-mono text-sm text-loss">−{formatINR(c.amount)}</span>}
        />
        <HarvestPanel
          icon={<Gift className="h-4 w-4 text-accent" />}
          title="Tax-free LTCG to book"
          empty={a.remaining > 0 ? "No long-term winners to book yet." : "Allowance already fully used."}
          candidates={h.ltcgFreeCandidates}
          headline={
            h.ltcgFreeCandidates.length > 0 ? (
              <>
                Realize up to <span className="font-semibold text-ink">{formatINR(a.remaining)}</span> of these
                long-term gains tax-free (rebuy to reset cost basis).
              </>
            ) : null
          }
          renderRight={(c) => <span className="font-mono text-sm text-gain">+{formatINR(c.amount)}</span>}
        />
        <HarvestPanel
          icon={<Hourglass className="h-4 w-4 text-accent" />}
          title="Almost long-term"
          empty="No short-term winners near the 12-month line."
          candidates={h.countdown}
          headline={
            h.countdown.length > 0 ? (
              <>Hold a little longer to drop these from {(summary.rules.stcgRate * 100).toFixed(0)}% to {(summary.rules.ltcgRate * 100).toFixed(1)}% tax.</>
            ) : null
          }
          renderRight={(c) => (
            <span className="text-right">
              <span className="block font-mono text-sm text-accent">{c.daysToLtcg}d left</span>
              <span className="block text-[11px] text-muted">save ≈ {formatINR(c.estTaxImpact)}</span>
            </span>
          )}
        />
      </div>

      {/* Realized disposals */}
      {r.disposals.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface">
          <h2 className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-muted" /> Realized disposals · {fy}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2 font-medium">Stock</th>
                  <th className="px-3 py-2 text-right font-medium">Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Buy</th>
                  <th className="px-3 py-2 text-right font-medium">Sell</th>
                  <th className="px-3 py-2 text-center font-medium">Term</th>
                  <th className="px-5 py-2 text-right font-medium">Gain</th>
                </tr>
              </thead>
              <tbody>
                {r.disposals.map((d, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2 font-medium">
                      {d.symbol}
                      <span className="ml-2 text-xs text-muted">{d.buyDate} → {d.sellDate}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{d.quantity}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{formatINR(d.buyValue)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted">{formatINR(d.sellValue)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        d.term === "LTCG" ? "bg-accent/10 text-accent" : "bg-surface-2 text-muted"
                      }`}>
                        {d.term}
                      </span>
                    </td>
                    <td className={`px-5 py-2 text-right font-mono ${pnlClass(d.gain)}`}>{formatINR(d.gain, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {summary.warnings.map((w, i) => (
        <p key={i} className="flex items-start gap-2 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0" /> {w}
        </p>
      ))}

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Estimates for listed equity / equity funds (STT-paid) under the post-Jul-2024 regime: STCG{" "}
        {(summary.rules.stcgRate * 100).toFixed(0)}%, LTCG {(summary.rules.ltcgRate * 100).toFixed(1)}% above ₹1.25L/yr.
        Debt, gold, unlisted and international holdings follow different rules and aren&apos;t modelled. Not tax advice.
      </p>
    </div>
  );
}

function Card({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1.5 flex flex-col gap-0.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function HarvestPanel({
  icon,
  title,
  empty,
  headline,
  candidates,
  renderRight,
}: {
  icon: React.ReactNode;
  title: string;
  empty: string;
  headline: React.ReactNode;
  candidates: HarvestCandidate[];
  renderRight: (c: HarvestCandidate) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">{icon} {title}</h2>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{empty}</p>
      ) : (
        <>
          {headline && <p className="mt-2 text-sm text-muted">{headline}</p>}
          <ul className="mt-3 space-y-1.5">
            {candidates.slice(0, 6).map((c) => (
              <li key={`${c.symbol}-${c.exchange}`} className="flex items-center justify-between gap-2">
                <Link
                  href={`/stock/${c.symbol}?exchange=${c.exchange}`}
                  className="truncate text-sm font-medium hover:text-accent"
                >
                  {c.symbol}
                  <span className="ml-1.5 text-xs text-muted">×{c.quantity}</span>
                </Link>
                {renderRight(c)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
