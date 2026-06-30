import Link from "next/link";
import { Wallet } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import FeesView from "@/components/FeesView";

export const metadata = { title: "Fund fees — WealthLens" };

export default async function FeesPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  // Cheap count only — NAV/TER work happens client-side via /api/fees so the tab
  // paints instantly.
  const fundCount = await prisma.fundHolding.count({ where: { portfolioId: user.portfolioId } });

  if (fundCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <Wallet className="mx-auto h-10 w-10 text-muted" />
        <h1 className="mt-4 text-xl font-bold">No mutual funds yet</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          Import a CAS or mutual-fund statement and WealthLens will total the annual expense ratio you&apos;re
          paying and flag Regular-plan funds where the Direct plan would cost less.
        </p>
        <Link
          href="/import"
          className="mt-6 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Import funds
        </Link>
      </div>
    );
  }

  return <FeesView />;
}
