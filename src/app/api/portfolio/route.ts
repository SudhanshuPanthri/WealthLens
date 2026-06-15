import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeMetrics } from "@/lib/metrics";
import { computeFundMetrics } from "@/lib/funds";

// Live portfolio metrics for the logged-in user — polled by the dashboard so
// prices update in the browser without a reload or re-upload. Returns stock
// `metrics` and, when present, mutual-fund `funds` metrics.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [holdings, fundHoldings] = await Promise.all([
    prisma.holding.findMany({ where: { portfolioId: user.portfolioId }, orderBy: { symbol: "asc" } }),
    prisma.fundHolding.findMany({ where: { portfolioId: user.portfolioId } }),
  ]);

  const [metrics, funds] = await Promise.all([
    holdings.length > 0 ? computeMetrics(holdings) : Promise.resolve(null),
    fundHoldings.length > 0 ? computeFundMetrics(fundHoldings) : Promise.resolve(null),
  ]);

  return NextResponse.json({ metrics, funds });
}
