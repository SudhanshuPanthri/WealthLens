import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeMetrics } from "@/lib/metrics";

// Live portfolio metrics for the logged-in user — polled by the dashboard so
// prices update in the browser without a reload or re-upload.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const holdings = await prisma.holding.findMany({
    where: { portfolioId: user.portfolioId },
    orderBy: { symbol: "asc" },
  });
  if (holdings.length === 0) return NextResponse.json({ metrics: null });

  const metrics = await computeMetrics(holdings);
  return NextResponse.json({ metrics });
}
