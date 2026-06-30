import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeTax } from "@/lib/tax";
import TaxView from "@/components/TaxView";
import Link from "next/link";
import { Receipt } from "lucide-react";

export const metadata = { title: "Tax — WealthLens" };

export default async function TaxPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  const [transactions, funds] = await Promise.all([
    prisma.transaction.findMany({
      where: { portfolioId: user.portfolioId },
      orderBy: { tradedAt: "asc" },
    }),
    prisma.fundHolding.findMany({ where: { portfolioId: user.portfolioId } }),
  ]);

  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <Receipt className="mx-auto h-10 w-10 text-muted" />
        <h1 className="mt-4 text-xl font-bold">No trades to analyze yet</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          Import a tradebook or P&amp;L statement and WealthLens will compute your short- and long-term
          capital gains, tax owed, and ways to legally reduce it.
        </p>
        <Link
          href="/transactions"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Import trades
        </Link>
      </div>
    );
  }

  const summary = await computeTax(transactions, undefined, undefined, funds);
  return <TaxView initial={summary} reminderOptIn={user.harvestReminderOptIn} />;
}
