import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computePnl } from "@/lib/pnl";
import type { LedgerRow } from "@/app/api/transactions/route";
import type { TradeType } from "@/lib/types";
import TransactionsView from "@/components/TransactionsView";

export const metadata = { title: "Transactions — WealthLens" };

export default async function TransactionsPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

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

  return (
    <TransactionsView
      initialSummary={summary}
      initialLedger={ledger}
      initialCount={transactions.length}
    />
  );
}
