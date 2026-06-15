import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getStockDetail } from "@/lib/quotes";
import type { Exchange } from "@/lib/types";
import StockDetailView from "@/components/StockDetailView";

export const metadata = { title: "Stock — WealthLens" };

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ symbol: string }>;
  searchParams: Promise<{ exchange?: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  const { symbol } = await params;
  const { exchange: ex } = await searchParams;
  const exchange = (ex === "BSE" ? "BSE" : "NSE") as Exchange;
  const sym = symbol.toUpperCase();

  const [detail, watched] = await Promise.all([
    getStockDetail(sym, exchange, "1Y"),
    prisma.watchlistItem.findUnique({
      where: {
        portfolioId_symbol_exchange: { portfolioId: user.portfolioId, symbol: sym, exchange },
      },
    }),
  ]);

  if (!detail) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <h1 className="text-xl font-bold">Couldn&apos;t load {sym}</h1>
        <p className="mt-2 text-muted">No live data found for this symbol on {exchange}.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-accent hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <StockDetailView initial={detail} initiallyWatched={Boolean(watched)} />;
}
