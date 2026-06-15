import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getIndexDetail } from "@/lib/market";
import IndexDetailView from "@/components/IndexDetailView";

export const metadata = { title: "Index — WealthLens" };

export default async function IndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  const { slug } = await params;
  const detail = await getIndexDetail(slug, "1Y");

  if (!detail) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-20 text-center">
        <h1 className="text-xl font-bold">Index not found</h1>
        <p className="mt-2 text-muted">No live data found for this index.</p>
        <Link href="/dashboard" className="mt-6 inline-block text-accent hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return <IndexDetailView initial={detail} />;
}
