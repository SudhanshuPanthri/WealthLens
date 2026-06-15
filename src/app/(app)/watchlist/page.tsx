import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getQuotes, toYahooSymbol } from "@/lib/quotes";
import type { Exchange } from "@/lib/types";
import type { WatchlistRow } from "@/app/api/watchlist/route";
import WatchlistView from "@/components/WatchlistView";

export const metadata = { title: "Watchlist — WealthLens" };

export default async function WatchlistPage() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return null; // layout redirects

  const items = await prisma.watchlistItem.findMany({
    where: { portfolioId: user.portfolioId },
    orderBy: { createdAt: "desc" },
  });

  let rows: WatchlistRow[] = [];
  if (items.length > 0) {
    const quotes = await getQuotes(items.map((i) => toYahooSymbol(i.symbol, i.exchange)));
    rows = items.map((i) => {
      const q = quotes.get(toYahooSymbol(i.symbol, i.exchange));
      return {
        id: i.id,
        symbol: i.symbol,
        exchange: i.exchange as Exchange,
        name: i.name ?? q?.name ?? null,
        price: q?.price ?? null,
        dayChangePct: q?.dayChange ?? null,
        high52: q?.high52 ?? null,
        low52: q?.low52 ?? null,
      };
    });
  }

  return <WatchlistView initialItems={rows} />;
}
