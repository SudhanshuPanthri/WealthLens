import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { chatEngines } from "@/lib/chat";
import ChatView from "@/components/ChatView";

export const metadata = { title: "Ask AI — WealthLens" };

export default async function AskPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null;

  const [holdingsCount, fundsCount] = await Promise.all([
    prisma.holding.count({ where: { portfolioId: user.portfolioId } }),
    prisma.fundHolding.count({ where: { portfolioId: user.portfolioId } }),
  ]);

  return (
    <ChatView hasHoldings={holdingsCount + fundsCount > 0} llmAvailable={chatEngines().length > 0} />
  );
}
