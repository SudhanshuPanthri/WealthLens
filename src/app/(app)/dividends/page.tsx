import Link from "next/link";
import { Coins } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import DividendsView from "@/components/DividendsView";

export const metadata = { title: "Dividends — WealthLens" };

export default async function DividendsPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  // Cheap count only — the (slow) Yahoo dividend lookups happen client-side via
  // /api/dividends so switching to this tab paints instantly.
  const holdingCount = await prisma.holding.count({ where: { portfolioId: user.portfolioId } });

  if (holdingCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <Coins className="mx-auto h-10 w-10 text-muted" />
        <h1 className="mt-4 text-xl font-bold">No holdings yet</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          Import your holdings and WealthLens will project your annual dividend income across every broker and
          build an ex-date calendar so you never miss a payout.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Import holdings
        </Link>
      </div>
    );
  }

  return <DividendsView />;
}
