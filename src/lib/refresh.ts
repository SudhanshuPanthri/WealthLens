import { prisma } from "./db";
import { getQuotes, toYahooSymbol } from "./quotes";
import { getMarketSnapshot } from "./market";

/**
 * Rough check for whether NSE/BSE are likely open, so the background refresher
 * doesn't hammer Yahoo overnight/weekends. IST = UTC+5:30; cash market runs
 * 09:15–15:30 — we use a 09:00–15:45 window for a small buffer.
 */
export function isMarketLikelyOpen(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const day = ist.getUTCDay(); // 0 = Sun … 6 = Sat
  if (day === 0 || day === 6) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 45;
}

/**
 * Refresh the QuoteCache for every distinct symbol held or watchlisted across
 * all users, and warm the public market snapshot. Safe to call from a timer or
 * an external cron. Returns how many symbols were touched.
 */
export async function refreshAllQuotes(): Promise<{ symbols: number; refreshed: number }> {
  const [holdings, watch] = await Promise.all([
    prisma.holding.findMany({ select: { symbol: true, exchange: true } }),
    prisma.watchlistItem.findMany({ select: { symbol: true, exchange: true } }),
  ]);

  const symbols = new Set<string>();
  for (const h of holdings) symbols.add(toYahooSymbol(h.symbol, h.exchange));
  for (const w of watch) symbols.add(toYahooSymbol(w.symbol, w.exchange));
  const list = [...symbols];

  // Warm the homepage/dashboard market snapshot regardless of holdings.
  await getMarketSnapshot().catch(() => undefined);

  if (list.length === 0) return { symbols: 0, refreshed: 0 };
  const quotes = await getQuotes(list); // writes QuoteCache
  return { symbols: list.length, refreshed: quotes.size };
}
