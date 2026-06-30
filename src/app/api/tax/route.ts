import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeTax } from "@/lib/tax";

// Capital-gains tax summary for the signed-in user. ?fy=2025-26 selects a
// financial year; defaults to the current FY. Polled by the tax page so
// unrealized figures and harvesting suggestions track live prices.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const fyParam = req.nextUrl.searchParams.get("fy") ?? undefined;
  const fy = fyParam && /^\d{4}-\d{2}$/.test(fyParam) ? fyParam : undefined;

  const [transactions, funds] = await Promise.all([
    prisma.transaction.findMany({
      where: { portfolioId: user.portfolioId },
      orderBy: { tradedAt: "asc" },
    }),
    prisma.fundHolding.findMany({ where: { portfolioId: user.portfolioId } }),
  ]);
  const summary = await computeTax(transactions, fy, undefined, funds);
  return NextResponse.json({ summary });
}
