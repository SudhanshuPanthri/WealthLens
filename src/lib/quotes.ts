import YahooFinance from "yahoo-finance2";
import { prisma } from "./db";
import type { Exchange } from "./types";

const yf = new YahooFinance();

const QUOTE_TTL_MS = 60 * 1000; // re-fetch prices after 1 minute (dashboard polls live)
const SECTOR_FETCH_BUDGET = 8; // max per-request profile lookups (1 HTTP call each)

export function toYahooSymbol(symbol: string, exchange: Exchange | string): string {
  return `${symbol}.${exchange === "BSE" ? "BO" : "NS"}`;
}

export interface Quote {
  symbol: string; // yahoo symbol
  price: number;
  prevClose: number | null;
  dayChange: number | null; // percent
  name: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  high52: number | null;
  low52: number | null;
  trailingPE: number | null;
  updatedAt: Date;
}

/**
 * Get quotes for a set of yahoo symbols, served from the DB cache when fresh
 * (10 min), batch-fetched from Yahoo otherwise. Sector/industry come from a
 * separate profile endpoint and are backfilled a few symbols at a time.
 */
export async function getQuotes(yahooSymbols: string[]): Promise<Map<string, Quote>> {
  const unique = [...new Set(yahooSymbols)];
  const result = new Map<string, Quote>();
  if (unique.length === 0) return result;

  const cached = await prisma.quoteCache.findMany({ where: { symbol: { in: unique } } });
  const now = Date.now();
  const stale: string[] = [];
  for (const sym of unique) {
    const row = cached.find((c) => c.symbol === sym);
    if (row && now - row.updatedAt.getTime() < QUOTE_TTL_MS) {
      result.set(sym, row);
    } else {
      stale.push(sym);
    }
  }

  if (stale.length > 0) {
    try {
      const quotes = await yf.quote(stale);
      const list = Array.isArray(quotes) ? quotes : [quotes];
      for (const q of list) {
        if (!q?.symbol || typeof q.regularMarketPrice !== "number") continue;
        const data = {
          price: q.regularMarketPrice,
          prevClose: q.regularMarketPreviousClose ?? null,
          dayChange: q.regularMarketChangePercent ?? null,
          name: q.longName ?? q.shortName ?? null,
          marketCap: q.marketCap ?? null,
          high52: q.fiftyTwoWeekHigh ?? null,
          low52: q.fiftyTwoWeekLow ?? null,
          trailingPE: q.trailingPE ?? null,
        };
        const row = await prisma.quoteCache.upsert({
          where: { symbol: q.symbol },
          // keep previously-resolved sector/industry on price refresh
          update: data,
          create: { symbol: q.symbol, sector: null, industry: null, ...data },
        });
        result.set(q.symbol, row);
      }
    } catch (err) {
      console.error("Yahoo quote fetch failed:", err);
    }
    // Anything Yahoo didn't return: fall back to stale cache rather than nothing
    for (const sym of stale) {
      if (!result.has(sym)) {
        const row = cached.find((c) => c.symbol === sym);
        if (row) result.set(sym, row);
      }
    }
  }

  await backfillSectors(result);
  return result;
}

/** Fetch sector/industry for a few symbols that don't have one yet. */
async function backfillSectors(quotes: Map<string, Quote>) {
  const missing = [...quotes.values()].filter((q) => !q.sector).slice(0, SECTOR_FETCH_BUDGET);
  for (const q of missing) {
    try {
      const summary = await yf.quoteSummary(q.symbol, { modules: ["summaryProfile"] });
      const profile = summary.summaryProfile;
      if (profile?.sector) {
        const row = await prisma.quoteCache.update({
          where: { symbol: q.symbol },
          data: { sector: profile.sector, industry: profile.industry ?? null },
        });
        quotes.set(q.symbol, row);
      }
    } catch {
      // sector is a nice-to-have; ignore per-symbol failures
    }
  }
}

export interface ChartPoint {
  date: string; // ISO date
  close: number;
}

export interface StockDetail {
  symbol: string; // bare symbol, e.g. RELIANCE
  exchange: Exchange;
  yahooSymbol: string;
  name: string | null;
  sector: string | null;
  industry: string | null;
  description: string | null;
  price: number | null;
  prevClose: number | null;
  dayChange: number | null; // percent
  marketCap: number | null;
  high52: number | null;
  low52: number | null;
  trailingPE: number | null;
  chart: ChartPoint[];
  asOf: string;
}

const RANGE_DAYS: Record<string, number> = { "1M": 31, "6M": 186, "1Y": 366, "5Y": 1830 };

/**
 * Full detail for a single stock: live quote + fundamentals + company profile +
 * a daily-close price history for the chart. Used by the stock detail page.
 */
export async function getStockDetail(
  symbol: string,
  exchange: Exchange,
  range: keyof typeof RANGE_DAYS = "1Y",
): Promise<StockDetail | null> {
  const yahooSymbol = toYahooSymbol(symbol, exchange);

  const quotes = await getQuotes([yahooSymbol]);
  const q = quotes.get(yahooSymbol);

  let description: string | null = null;
  try {
    const summary = await yf.quoteSummary(yahooSymbol, { modules: ["assetProfile"] });
    description = summary.assetProfile?.longBusinessSummary ?? null;
  } catch {
    // profile is a nice-to-have
  }

  const chart: ChartPoint[] = [];
  try {
    const period1 = new Date(Date.now() - (RANGE_DAYS[range] ?? 366) * 24 * 60 * 60 * 1000);
    const res = await yf.chart(yahooSymbol, { period1, interval: "1d" });
    for (const row of res.quotes ?? []) {
      if (row?.date && typeof row.close === "number") {
        chart.push({ date: new Date(row.date).toISOString().slice(0, 10), close: row.close });
      }
    }
  } catch (err) {
    console.error(`Chart fetch failed for ${yahooSymbol}:`, err);
  }

  if (!q && chart.length === 0) return null;

  return {
    symbol,
    exchange,
    yahooSymbol,
    name: q?.name ?? null,
    sector: q?.sector ?? null,
    industry: q?.industry ?? null,
    description,
    price: q?.price ?? null,
    prevClose: q?.prevClose ?? null,
    dayChange: q?.dayChange ?? null,
    marketCap: q?.marketCap ?? null,
    high52: q?.high52 ?? null,
    low52: q?.low52 ?? null,
    trailingPE: q?.trailingPE ?? null,
    chart,
    asOf: new Date().toISOString(),
  };
}

/**
 * Resolve a free-text query (symbol or company name) to NSE/BSE matches for the
 * watchlist add box. Returns a small ranked list.
 */
export async function searchStocks(
  query: string,
): Promise<{ symbol: string; exchange: Exchange; name: string | null }[]> {
  if (!query.trim()) return [];
  try {
    const res = await yf.search(query, { quotesCount: 10, newsCount: 0 });
    const hits = res.quotes.filter(
      (q) =>
        "symbol" in q &&
        typeof q.symbol === "string" &&
        (q.symbol.endsWith(".NS") || q.symbol.endsWith(".BO")),
    ) as { symbol: string; longname?: string; shortname?: string }[];
    return hits
      .map((q) => ({
        symbol: q.symbol.replace(/\.(NS|BO)$/, ""),
        exchange: (q.symbol.endsWith(".BO") ? "BSE" : "NSE") as Exchange,
        name: q.longname ?? q.shortname ?? null,
      }))
      .slice(0, 8);
  } catch (err) {
    console.error(`Stock search failed for "${query}":`, err);
    return [];
  }
}

/**
 * Resolve an ISIN (and stock name as fallback) to an NSE/BSE trading symbol,
 * cached permanently in SymbolMap.
 */
export async function resolveIsin(
  isin: string,
  name?: string,
): Promise<{ symbol: string; exchange: Exchange } | null> {
  const cached = await prisma.symbolMap.findUnique({ where: { isin } });
  if (cached) return { symbol: cached.symbol, exchange: cached.exchange as Exchange };

  for (const query of [isin, name].filter(Boolean) as string[]) {
    try {
      const res = await yf.search(query, { quotesCount: 6, newsCount: 0 });
      const hit = res.quotes.find(
        (q) =>
          "symbol" in q &&
          typeof q.symbol === "string" &&
          (q.symbol.endsWith(".NS") || q.symbol.endsWith(".BO")),
      ) as { symbol: string; longname?: string; shortname?: string } | undefined;
      if (hit) {
        const exchange: Exchange = hit.symbol.endsWith(".BO") ? "BSE" : "NSE";
        const symbol = hit.symbol.replace(/\.(NS|BO)$/, "");
        await prisma.symbolMap.upsert({
          where: { isin },
          update: { symbol, exchange, name: hit.longname ?? hit.shortname ?? name ?? null },
          create: { isin, symbol, exchange, name: hit.longname ?? hit.shortname ?? name ?? null },
        });
        return { symbol, exchange };
      }
    } catch (err) {
      console.error(`Symbol resolution failed for ${query}:`, err);
    }
  }
  return null;
}
