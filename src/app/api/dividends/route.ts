import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeDividends } from "@/lib/dividends";

export const maxDuration = 60;

// Projected dividend income + ex-date calendar for the signed-in user.
// Fetched client-side so the page paints instantly and fills in when ready.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const holdings = await prisma.holding.findMany({ where: { portfolioId: user.portfolioId } });
  const summary = await computeDividends(holdings);
  return NextResponse.json({ summary });
}
