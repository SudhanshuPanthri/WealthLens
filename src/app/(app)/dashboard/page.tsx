import Link from "next/link";
import { Upload } from "lucide-react";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeMetrics } from "@/lib/metrics";
import DashboardView from "@/components/DashboardView";

export const metadata = { title: "Dashboard — WealthLens" };

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout already redirects

  const holdings = await prisma.holding.findMany({
    where: { portfolioId: user.portfolioId },
    orderBy: { symbol: "asc" },
  });

  if (holdings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-surface px-6 py-24 text-center">
        <Upload className="h-10 w-10 text-muted" />
        <h1 className="mt-6 text-2xl font-bold">Your portfolio is empty</h1>
        <p className="mt-2 max-w-md text-muted">
          Import a holdings export from Zerodha, Groww, or any broker to see your unified
          dashboard and AI insights.
        </p>
        <Link
          href="/import"
          className="mt-8 rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Import holdings
        </Link>
      </div>
    );
  }

  // Initial server-rendered metrics for instant first paint; the client view
  // then polls /api/portfolio to keep prices live.
  const metrics = await computeMetrics(holdings);
  return <DashboardView initialMetrics={metrics} />;
}
