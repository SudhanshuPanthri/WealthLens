"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingDown, Gift, Hourglass, Info, Receipt, Layers, CalendarClock, Scissors, ArrowRight, ExternalLink } from "lucide-react";
import type { TaxSummary, HarvestCandidate, HarvestPlan } from "@/lib/tax";
import { formatINR, formatPct, pnlClass } from "@/lib/format";

// Official Income Tax e-filing portal.
const ITR_PORTAL = "https://www.incometax.gov.in/iec/foportal/";

export default function TaxView({ initial, reminderOptIn }: { initial: TaxSummary; reminderOptIn: boolean }) {
  const [summary, setSummary] = useState(initial);
  const [fy, setFy] = useState(initial.fy);
  const [loading, setLoading] = useState(false);
  const [optIn, setOptIn] = useState(reminderOptIn);
  const [optInSaving, setOptInSaving] = useState(false);

  async function toggleReminder(next: boolean) {
    setOptIn(next); // optimistic
    setOptInSaving(true);
    try {
      const res = await fetch("/api/settings/harvest-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: next }),
      });
      if (!res.ok) setOptIn(!next); // revert on failure
    } catch {
      setOptIn(!next);
    } finally {
      setOptInSaving(false);
    }
  }

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

      {/* Deadline + reminder opt-in (current FY only) */}
      {summary.deadline.isCurrentFy && (
        <DeadlineBanner
          daysLeft={summary.deadline.daysLeft}
          fyEnd={summary.deadline.fyEnd}
          optIn={optIn}
          optInSaving={optInSaving}
          onToggle={toggleReminder}
        />
      )}

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

      {/* Year-end harvest plan — the headline action */}
      {h.plan && <HarvestPlanCard plan={h.plan} hasLosers={h.lossCandidates.length > 0} />}

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

      {/* Loss set-off & carry-forward */}
      {(r.setOff.totalSetOff > 0 || summary.carryForward.stcl + summary.carryForward.ltcl > 0) && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Layers className="h-4 w-4 text-accent" /> Loss set-off &amp; carry-forward
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-1.5 text-sm">
              <Row label="Short-term gain (gross)" value={formatINR(r.stcgGain, true)} valueClass={pnlClass(r.stcgGain)} />
              <Row label="Long-term gain (gross)" value={formatINR(r.ltcgGain, true)} valueClass={pnlClass(r.ltcgGain)} />
              {r.setOff.totalSetOff > 0 && (
                <Row label="Losses set off this year" value={`−${formatINR(r.setOff.totalSetOff)}`} valueClass="text-accent" />
              )}
              <div className="!mt-2 border-t border-border pt-2">
                <Row label="Taxable short-term" value={formatINR(r.netStcg)} bold />
                <Row label="Taxable long-term" value={formatINR(r.netLtcg)} bold />
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Carried forward</p>
              {summary.carryForward.buckets.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No unabsorbed losses carry forward from {fy}.</p>
              ) : (
                <>
                  <p className="mt-1.5 text-sm">
                    <span className="font-semibold text-ink">{formatINR(summary.carryForward.stcl)}</span> short-term ·{" "}
                    <span className="font-semibold text-ink">{formatINR(summary.carryForward.ltcl)}</span> long-term
                    {summary.carryForward.expiringFy && (
                      <span className="text-muted"> · earliest lapses after {summary.carryForward.expiringFy}</span>
                    )}
                  </p>
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 font-medium">Booked</th>
                        <th className="py-1 text-right font-medium">STCL</th>
                        <th className="py-1 text-right font-medium">LTCL</th>
                        <th className="py-1 text-right font-medium">Lapses after</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.carryForward.buckets.map((b) => (
                        <tr key={b.fy} className="border-t border-border/50">
                          <td className="py-1 font-mono">{b.fy}</td>
                          <td className="py-1 text-right font-mono">{b.stcl > 0 ? formatINR(b.stcl) : "—"}</td>
                          <td className="py-1 text-right font-mono">{b.ltcl > 0 ? formatINR(b.ltcl) : "—"}</td>
                          <td className="py-1 text-right font-mono text-muted">{b.expiresFy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            Short-term losses offset both STCG &amp; LTCG; long-term losses offset only LTCG. Unabsorbed
            losses carry forward up to 8 years — file your ITR on time to preserve them.
          </p>
        </div>
      )}

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

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3">
        <p className="text-sm">
          Ready to file? Capital gains are reported in your <span className="font-medium">ITR-2 / ITR-3</span>.
        </p>
        <a
          href={ITR_PORTAL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-transform duration-200 hover:scale-[1.03] active:scale-95"
        >
          File on the Income Tax portal <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Estimates for listed equity / equity funds (STT-paid) under the post-Jul-2024 regime: STCG{" "}
        {(summary.rules.stcgRate * 100).toFixed(0)}%, LTCG {(summary.rules.ltcgRate * 100).toFixed(1)}% above ₹1.25L/yr.
        Debt, gold, unlisted and international holdings follow different rules and aren&apos;t modelled. Not tax advice.
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  valueClass = "",
  bold = false,
}: {
  label: string;
  value: string;
  valueClass?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-muted ${bold ? "font-medium text-ink" : ""}`}>{label}</span>
      <span className={`font-mono ${bold ? "font-semibold" : ""} ${valueClass}`}>{value}</span>
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

function DeadlineBanner({
  daysLeft,
  fyEnd,
  optIn,
  optInSaving,
  onToggle,
}: {
  daysLeft: number;
  fyEnd: string;
  optIn: boolean;
  optInSaving: boolean;
  onToggle: (next: boolean) => void;
}) {
  const urgent = daysLeft <= 60;
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
        urgent ? "border-accent/40 bg-accent-soft" : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-3">
        <CalendarClock className={`h-5 w-5 shrink-0 ${urgent ? "text-accent" : "text-muted"}`} />
        <p className="text-sm">
          <span className="font-semibold">{daysLeft} day{daysLeft === 1 ? "" : "s"}</span> to the {fyEnd} tax
          deadline.{" "}
          {urgent
            ? "Harvest losses before then to cut this year's tax."
            : "Plenty of time to plan your harvest."}
        </p>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={optIn}
          disabled={optInSaving}
          onChange={(e) => onToggle(e.target.checked)}
          className="h-4 w-4 rounded border-border accent-accent"
        />
        Email me a reminder
      </label>
    </div>
  );
}

function HarvestPlanCard({ plan, hasLosers }: { plan: HarvestPlan; hasLosers: boolean }) {
  if (plan.items.length === 0 || plan.taxSaved <= 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Scissors className="h-4 w-4 text-accent" /> Year-end harvest plan
        </h2>
        <p className="mt-2 text-sm text-muted">
          {hasLosers
            ? "You have loss-making positions, but no realized gains this year to offset. Selling them now still books losses that carry forward up to 8 years."
            : "No loss-making positions to harvest right now — we'll build a plan here when one appears."}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-accent/30 bg-surface p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Scissors className="h-4 w-4 text-accent" /> Year-end harvest plan
      </h2>
      <p className="mt-2 text-sm text-muted">
        Sell {plan.items.length === 1 ? "this position" : `these ${plan.items.length} positions`} to offset{" "}
        <span className="font-semibold text-ink">{formatINR(plan.gainsOffset)}</span> of realized gains and save about{" "}
        <span className="font-semibold text-gain">{formatINR(plan.taxSaved)}</span> in tax.
      </p>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted">Tax now</p>
          <p className="font-mono text-lg font-semibold">{formatINR(plan.taxBefore)}</p>
        </div>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted" />
        <div className="rounded-xl border border-accent/30 bg-accent-soft px-4 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted">After plan</p>
          <p className="font-mono text-lg font-semibold text-gain">{formatINR(plan.taxAfter)}</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Sell</th>
              <th className="px-3 py-2 text-right font-medium">Loss booked</th>
              <th className="px-3 py-2 text-center font-medium">Offsets</th>
              <th className="py-2 pl-3 text-right font-medium">Tax saved</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((it, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3 font-medium">
                  <span className="truncate">{it.symbol}</span>
                  {it.kind === "fund" ? (
                    <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">MF</span>
                  ) : (
                    <span className="ml-1.5 text-xs text-muted">×{it.quantity}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono text-loss">−{formatINR(it.loss)}</td>
                <td className="px-3 py-2 text-center text-xs text-muted">
                  {it.appliedToStcg > 0 && <span>{formatINR(it.appliedToStcg)} STCG</span>}
                  {it.appliedToStcg > 0 && it.appliedToLtcg > 0 && " · "}
                  {it.appliedToLtcg > 0 && <span>{formatINR(it.appliedToLtcg)} LTCG</span>}
                </td>
                <td className="py-2 pl-3 text-right font-mono text-gain">{formatINR(it.taxSaved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {plan.carryForwardCreated > 0 && (
        <p className="mt-3 text-xs text-muted">
          Plus <span className="font-medium text-ink">{formatINR(plan.carryForwardCreated)}</span> of extra losses
          carried forward to future years.
        </p>
      )}
      <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        India has no &ldquo;wash-sale&rdquo; rule — you can rebuy the same position immediately to keep your exposure
        while still booking the loss.
        {plan.fundTermAssumed &&
          " Mutual-fund holding periods aren't in the imported data, so funds are treated as long-term (conservative)."}
      </p>
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
                {c.kind === "fund" ? (
                  <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{c.symbol}</span>
                    <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-muted">MF</span>
                  </span>
                ) : (
                  <Link
                    href={`/stock/${c.symbol}?exchange=${c.exchange}`}
                    className="truncate text-sm font-medium hover:text-accent"
                  >
                    {c.symbol}
                    <span className="ml-1.5 text-xs text-muted">×{c.quantity}</span>
                  </Link>
                )}
                {renderRight(c)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
