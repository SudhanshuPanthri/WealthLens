import Link from "next/link";
import { Layers } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeCrossBroker, benchmarkVsNifty } from "@/lib/analytics";
import AnalyticsView from "@/components/AnalyticsView";

export const metadata = { title: "Analytics — WealthLens" };

export default async function AnalyticsPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  const [holdings, transactions] = await Promise.all([
    prisma.holding.findMany({ where: { portfolioId: user.portfolioId }, orderBy: { symbol: "asc" } }),
    prisma.transaction.findMany({ where: { portfolioId: user.portfolioId }, orderBy: { tradedAt: "asc" } }),
  ]);

  if (holdings.length === 0 && transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <Layers className="mx-auto h-10 w-10 text-muted" />
        <h1 className="mt-4 text-xl font-bold">Nothing to analyze yet</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          Import holdings from any broker and WealthLens will merge them into your true
          per-stock exposure, split it by market-cap, and benchmark your returns against the
          Nifty 50 — the cross-broker picture no single broker app can show.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Import holdings
        </Link>
      </div>
    );
  }

  const [crossBroker, benchmark] = await Promise.all([
    computeCrossBroker(holdings),
    benchmarkVsNifty(transactions),
  ]);

  return <AnalyticsView initialCrossBroker={crossBroker} initialBenchmark={benchmark} />;
}
