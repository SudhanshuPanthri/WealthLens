import YahooFinance from "yahoo-finance2";
import { marketCache } from "./cache";

const yf = new YahooFinance();

// Public market data is cached in a swappable TTL store (see lib/cache.ts).
const cached = marketCache.cached.bind(marketCache);

export interface IndexQuote {
  slug: string; // url-safe id, e.g. "nifty-50"
  name: string;
  exchange: "NSE" | "BSE";
  price: number | null;
  change: number | null;
  changePct: number | null;
}

export interface Mover {
  symbol: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
}

export interface FundQuote {
  name: string;
  category: string;
  nav: number | null;
  return1y: number | null;
  date: string | null;
}

export interface MarketSnapshot {
  indices: IndexQuote[];
  largeCap: Mover[];
  midCap: Mover[];
  smallCap: Mover[];
  funds: FundQuote[];
  asOf: string;
}

// Flagship indices for NSE & BSE plus a couple of broad gauges. The slug is the
// url-safe id used by the index detail route; the registry doubles as the
// whitelist of symbols that route is allowed to fetch.
export const INDEX_REGISTRY: { slug: string; symbol: string; name: string; exchange: "NSE" | "BSE" }[] = [
  { slug: "nifty-50", symbol: "^NSEI", name: "Nifty 50", exchange: "NSE" },
  { slug: "sensex", symbol: "^BSESN", name: "Sensex", exchange: "BSE" },
  { slug: "nifty-bank", symbol: "^NSEBANK", name: "Nifty Bank", exchange: "NSE" },
  { slug: "nifty-it", symbol: "^CNXIT", name: "Nifty IT", exchange: "NSE" },
];

export function findIndex(slug: string) {
  return INDEX_REGISTRY.find((i) => i.slug === slug) ?? null;
}

const INDICES = INDEX_REGISTRY;

// Representative constituents per market-cap bucket. We fetch quotes and show
// the top movers of the day from each list — an honest "top movers" view, not
// an exhaustive ranking of the whole market.
const LARGE_CAP = [
  "RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "BHARTIARTL", "ITC", "LT",
  "SBIN", "HINDUNILVR", "KOTAKBANK", "AXISBANK", "BAJFINANCE", "MARUTI", "SUNPHARMA",
  "TITAN", "ASIANPAINT", "ULTRACEMCO", "WIPRO", "NTPC",
];
const MID_CAP = [
  "POLYCAB", "CUMMINSIND", "MPHASIS", "FEDERALBNK", "BHARATFORG", "ASHOKLEY",
  "PERSISTENT", "COFORGE", "AUROPHARMA", "GODREJPROP", "TVSMOTOR", "INDHOTEL",
  "PAGEIND", "MRF", "BALKRISIND", "OBEROIRLTY",
];
const SMALL_CAP = [
  "IRCTC", "RVNL", "SUZLON", "IDFCFIRSTB", "YESBANK", "BANDHANBNK", "NBCC",
  "RBLBANK", "IEX", "CDSL", "ANGELONE", "KPITTECH", "HFCL", "TANLA", "JBCHEPHARM",
];

// Popular funds across categories. Resolved to mfapi.in scheme codes by name at
// runtime (avoids hardcoding numeric codes that can go stale).
const FUNDS: { query: string; category: string }[] = [
  { query: "Nippon India Large Cap Fund Direct Growth", category: "Large Cap" },
  { query: "Motilal Oswal Midcap Fund Direct Growth", category: "Mid Cap" },
  { query: "Nippon India Small Cap Fund Direct Growth", category: "Small Cap" },
  { query: "Parag Parikh Flexi Cap Fund Direct Growth", category: "Flexi Cap" },
  { query: "UTI Nifty 50 Index Fund Direct Growth", category: "Index" },
];

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const [indices, largeCap, midCap, smallCap, funds] = await Promise.all([
    getIndices(),
    getMovers("large", LARGE_CAP),
    getMovers("mid", MID_CAP),
    getMovers("small", SMALL_CAP),
    getFunds(),
  ]);
  return { indices, largeCap, midCap, smallCap, funds, asOf: new Date().toISOString() };
}

export interface IndexChartPoint {
  date: string; // ISO date
  close: number;
}

export interface IndexDetail {
  slug: string;
  symbol: string;
  name: string;
  exchange: "NSE" | "BSE";
  price: number | null;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  chart: IndexChartPoint[];
  asOf: string;
}

const INDEX_RANGE_DAYS: Record<string, number> = { "1M": 31, "6M": 186, "1Y": 366, "5Y": 1830 };

/**
 * Full detail for one index: live quote + daily-close history for the chart.
 * `slug` must be in INDEX_REGISTRY (the route validates this) — we never fetch
 * an arbitrary caller-supplied symbol.
 */
export async function getIndexDetail(
  slug: string,
  range: keyof typeof INDEX_RANGE_DAYS = "1Y",
): Promise<IndexDetail | null> {
  const idx = findIndex(slug);
  if (!idx) return null;

  const [quote, chart] = await Promise.all([
    yf.quote(idx.symbol).catch(() => null),
    (async () => {
      const points: IndexChartPoint[] = [];
      try {
        const period1 = new Date(Date.now() - (INDEX_RANGE_DAYS[range] ?? 366) * 24 * 60 * 60 * 1000);
        const res = await yf.chart(idx.symbol, { period1, interval: "1d" });
        for (const row of res.quotes ?? []) {
          if (row?.date && typeof row.close === "number") {
            points.push({ date: new Date(row.date).toISOString().slice(0, 10), close: row.close });
          }
        }
      } catch (err) {
        console.error(`Index chart fetch failed for ${idx.symbol}:`, err);
      }
      return points;
    })(),
  ]);

  const q = Array.isArray(quote) ? quote[0] : quote;
  if (!q && chart.length === 0) return null;

  return {
    slug: idx.slug,
    symbol: idx.symbol,
    name: idx.name,
    exchange: idx.exchange,
    price: q?.regularMarketPrice ?? null,
    prevClose: q?.regularMarketPreviousClose ?? null,
    change: q?.regularMarketChange ?? null,
    changePct: q?.regularMarketChangePercent ?? null,
    dayHigh: q?.regularMarketDayHigh ?? null,
    dayLow: q?.regularMarketDayLow ?? null,
    yearHigh: q?.fiftyTwoWeekHigh ?? null,
    yearLow: q?.fiftyTwoWeekLow ?? null,
    chart,
    asOf: new Date().toISOString(),
  };
}

async function getIndices(): Promise<IndexQuote[]> {
  return cached("indices", 60_000, async () => {
    const quotes = await yf.quote(INDICES.map((i) => i.symbol)).catch(() => []);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    return INDICES.map((idx) => {
      const q = list.find((x) => x?.symbol === idx.symbol);
      return {
        slug: idx.slug,
        name: idx.name,
        exchange: idx.exchange,
        price: q?.regularMarketPrice ?? null,
        change: q?.regularMarketChange ?? null,
        changePct: q?.regularMarketChangePercent ?? null,
      };
    });
  });
}

async function getMovers(bucket: string, symbols: string[]): Promise<Mover[]> {
  return cached(`movers:${bucket}`, 120_000, async () => {
    const quotes = await yf.quote(symbols.map((s) => `${s}.NS`)).catch(() => []);
    const list = Array.isArray(quotes) ? quotes : [quotes];
    return list
      .filter((q) => typeof q?.regularMarketPrice === "number")
      .map((q) => ({
        symbol: (q.symbol ?? "").replace(/\.NS$/, ""),
        name: q.shortName ?? q.longName ?? null,
        price: q.regularMarketPrice ?? null,
        changePct: q.regularMarketChangePercent ?? null,
      }))
      .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity))
      .slice(0, 5);
  });
}

// The search endpoint returns camelCase; the detail endpoint's `meta` is snake_case.
interface MfApiSearchHit {
  schemeCode: number;
  schemeName: string;
}
interface MfApiDetail {
  meta: { scheme_code: number; scheme_name: string };
  data: { date: string; nav: string }[];
}

async function getFunds(): Promise<FundQuote[]> {
  // Don't go through cached(): a transient upstream failure yields [], and we
  // must not cache an empty result for 6h. Cache only a non-empty fund list.
  const hit = marketCache.get<FundQuote[]>("funds");
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.value;

  const results = await Promise.all(FUNDS.map((f) => resolveFund(f.query, f.category)));
  const funds = results.filter((f): f is FundQuote => f !== null);
  if (funds.length > 0) marketCache.set("funds", funds);
  else if (hit) return hit.value; // serve stale rather than empty
  return funds;
}

/** fetch with one retry — guards against undici cold-connection timeouts. */
async function fetchRetry(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    return fetch(url, { signal: AbortSignal.timeout(8000) });
  }
}

async function resolveFund(query: string, category: string): Promise<FundQuote | null> {
  try {
    const searchRes = await fetchRetry(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(query)}`);
    if (!searchRes.ok) return null;
    const hits = (await searchRes.json()) as MfApiSearchHit[];
    if (!hits.length) return null;

    const detailRes = await fetchRetry(`https://api.mfapi.in/mf/${hits[0].schemeCode}`);
    if (!detailRes.ok) return null;
    const detail = (await detailRes.json()) as MfApiDetail;
    const navs = detail.data;
    if (!navs?.length) return null;

    const latest = navs[0];
    const nav = Number(latest.nav);
    // 1-year return: compare against the NAV closest to ~252 trading days ago
    const yearAgo = navs[Math.min(navs.length - 1, 248)];
    const navYearAgo = Number(yearAgo?.nav);
    const return1y =
      Number.isFinite(nav) && Number.isFinite(navYearAgo) && navYearAgo > 0
        ? ((nav - navYearAgo) / navYearAgo) * 100
        : null;

    return {
      name: detail.meta.scheme_name.replace(/ - Direct Plan.*/i, "").trim(),
      category,
      nav: Number.isFinite(nav) ? nav : null,
      return1y,
      date: latest.date ?? null,
    };
  } catch (err) {
    console.error(`Fund lookup failed for "${query}":`, err);
    return null;
  }
}
