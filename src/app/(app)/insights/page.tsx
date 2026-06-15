import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getLatestInsight } from "@/lib/insights";
import InsightsView from "@/components/InsightsView";

export const metadata = { title: "AI Insights — WealthLens" };

export default async function InsightsPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null;

  const [insight, holdingsCount] = await Promise.all([
    getLatestInsight(user.portfolioId),
    prisma.holding.count({ where: { portfolioId: user.portfolioId } }),
  ]);

  return <InsightsView initialInsight={insight} holdingsCount={holdingsCount} />;
}
