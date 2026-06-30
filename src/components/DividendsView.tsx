"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Coins, CalendarClock, Percent, Info } from "lucide-react";
import type { DividendSummary } from "@/lib/dividends";
import { formatINR, formatPct } from "@/lib/format";

export default function DividendsView() {
  const [summary, setSummary] = useState<DividendSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/dividends")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.summary) setSummary(d.summary);
        else setError(d.error ?? "Could not load dividends.");
      })
      .catch(() => alive && setError("Could not load dividends."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dividend income</h1>
        <p className="mt-0.5 text-sm text-muted">
          Projected payouts across every holding and broker — the passive-income view no single broker shows.
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

function Loaded({ summary }: { summary: DividendSummary }) {
  const payers = summary.holdings.filter((h) => (h.annualIncome ?? 0) > 0);
  const next = summary.calendar[0] ?? null;

  if (payers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <Coins className="mx-auto h-10 w-10 text-muted" />
        <h2 className="mt-4 text-lg font-bold">No dividend payers found</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          None of your current holdings have a known dividend. As you add dividend-paying stocks, your projected
          income and ex-date calendar will appear here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card icon={<Coins className="h-4 w-4 text-accent" />} label="Projected annual income">
          <span className="font-mono text-xl font-semibold text-gain">{formatINR(summary.totalAnnualIncome)}</span>
          <span className="text-xs text-muted">≈ {formatINR(summary.monthlyAverage)}/mo average</span>
        </Card>
        <Card icon={<Percent className="h-4 w-4 text-accent" />} label="Portfolio yield">
          <span className="font-mono text-xl font-semibold">{formatPct(summary.portfolioYieldPct, false)}</span>
          <span className="text-xs text-muted">on {formatINR(summary.portfolioValue)} invested value</span>
        </Card>
        <Card icon={<Coins className="h-4 w-4 text-accent" />} label="Dividend payers">
          <span className="font-mono text-xl font-semibold">{summary.payerCount}</span>
          <span className="text-xs text-muted">of {summary.holdings.length} holdings</span>
        </Card>
        <Card icon={<CalendarClock className="h-4 w-4 text-accent" />} label="Next ex-date">
          {next ? (
            <>
              <span className="font-mono text-xl font-semibold">{next.exDate}</span>
              <span className="text-xs text-muted">
                {next.symbol}
                {next.estimated && " · est."}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">None scheduled</span>
          )}
        </Card>
      </div>

      {summary.calendar.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-accent" /> Ex-dividend calendar
          </h2>
          <p className="mt-1 text-xs text-muted">
            Hold a stock before its ex-date to qualify for the next payout.
            {summary.calendarEstimated && " Dates marked “est.” are projected from last year's schedule — verify before trading."}
          </p>
          <ul className="mt-3 divide-y divide-border/60">
            {summary.calendar.slice(0, 10).map((c) => (
              <li key={`${c.symbol}-${c.exDate}`} className="flex items-center justify-between py-2">
                <div className="min-w-0">
                  <Link href={`/stock/${c.symbol}`} className="text-sm font-medium hover:text-accent">
                    {c.symbol}
                  </Link>
                  {c.name && <span className="ml-2 truncate text-xs text-muted">{c.name}</span>}
                </div>
                <div className="text-right">
                  <span className="block font-mono text-sm">
                    {c.exDate}
                    {c.estimated && <span className="ml-1.5 text-[11px] text-muted">est.</span>}
                  </span>
                  {c.estIncome !== null && (
                    <span className="block text-[11px] text-muted">est. {formatINR(c.estIncome)}/yr</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface">
        <h2 className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm font-semibold">
          <Coins className="h-4 w-4 text-muted" /> Income by holding
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2 font-medium">Stock</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Div / share</th>
                <th className="px-3 py-2 text-right font-medium">Yield</th>
                <th className="px-5 py-2 text-right font-medium">Annual income</th>
              </tr>
            </thead>
            <tbody>
              {payers.map((h) => (
                <tr key={`${h.symbol}-${h.exchange}`} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-2 font-medium">
                    <Link href={`/stock/${h.symbol}?exchange=${h.exchange}`} className="hover:text-accent">
                      {h.symbol}
                    </Link>
                    {h.name && <span className="ml-2 hidden text-xs text-muted sm:inline">{h.name}</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted">{h.quantity}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted">
                    {h.ratePerShare !== null ? formatINR(h.ratePerShare, true) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-muted">
                    {h.yieldPct !== null ? formatPct(h.yieldPct, false) : "—"}
                  </td>
                  <td className="px-5 py-2 text-right font-mono text-gain">{formatINR(h.annualIncome ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Projection uses each stock&apos;s trailing 12-month dividend per share — a forward estimate, not a guarantee.
        Companies can change or skip payouts. Equity mutual funds (growth) don&apos;t distribute and are excluded.
      </p>
    </>
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
      <div className="skeleton h-48 w-full rounded-2xl" />
      <div className="skeleton h-64 w-full rounded-2xl" />
    </div>
  );
}
