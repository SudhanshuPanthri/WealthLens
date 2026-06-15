import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computePnl } from "@/lib/pnl";
import type { TradeType } from "@/lib/types";

export interface LedgerRow {
  id: string;
  symbol: string;
  exchange: string;
  type: TradeType;
  quantity: number;
  price: number;
  fees: number;
  tradedAt: string; // ISO date
  broker: string;
}

// Live P&L summary + ledger for the signed-in user. Polled by the transactions
// page so realized/unrealized figures track current prices.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const transactions = await prisma.transaction.findMany({
    where: { portfolioId: user.portfolioId },
    orderBy: { tradedAt: "desc" },
  });
  const summary = await computePnl(transactions);
  const ledger: LedgerRow[] = transactions.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    exchange: t.exchange,
    type: t.type as TradeType,
    quantity: t.quantity,
    price: t.price,
    fees: t.fees,
    tradedAt: t.tradedAt.toISOString().slice(0, 10),
    broker: t.broker,
  }));
  return NextResponse.json({ summary, ledger, count: transactions.length });
}
