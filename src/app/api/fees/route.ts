import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeFees } from "@/lib/fees";

export const maxDuration = 60;

// Mutual-fund fee/expense-ratio leakage for the signed-in user. Fetched
// client-side so the page paints instantly and fills in when ready.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const funds = await prisma.fundHolding.findMany({ where: { portfolioId: user.portfolioId } });
  const summary = await computeFees(funds);
  return NextResponse.json({ summary });
}
