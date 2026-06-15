import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeCrossBroker, benchmarkVsNifty } from "@/lib/analytics";

// Cross-broker analytics for the signed-in user: true merged-across-brokers
// positions + market-cap allocation (from holdings) and a Nifty 50 benchmark
// (from the transaction ledger). Polled by the page for live prices.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [holdings, transactions] = await Promise.all([
    prisma.holding.findMany({ where: { portfolioId: user.portfolioId }, orderBy: { symbol: "asc" } }),
    prisma.transaction.findMany({ where: { portfolioId: user.portfolioId }, orderBy: { tradedAt: "asc" } }),
  ]);

  const [crossBroker, benchmark] = await Promise.all([
    computeCrossBroker(holdings),
    benchmarkVsNifty(transactions),
  ]);

  return NextResponse.json({ crossBroker, benchmark });
}
