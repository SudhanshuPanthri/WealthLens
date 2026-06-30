import YahooFinance from "yahoo-finance2";
import type { Holding } from "@prisma/client";
import { getQuotes, toYahooSymbol } from "./quotes";
import { TTLCache } from "./cache";

/**
 * Projected dividend income across all holdings + an upcoming ex-date calendar.
 * The cross-broker passive-income view no single broker app gives you. Uses
 * Yahoo's trailing annual dividend rate (per share) as the forward estimate.
 * Equity growth mutual funds don't distribute, so this covers stocks/ETFs only.
 */

const yf = new YahooFinance();
const dividendCache = new TTLCache();
const DIV_TTL_MS = 12 * 60 * 60 * 1000; // dividend data updates slowly — cache 12h

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface DividendHolding {
  symbol: string;
  exchange: string;
  name: string | null;
  quantity: number;
  price: number | null;
  value: number | null;
  ratePerShare: number | null; // trailing annual dividend per share (INR)
  annualIncome: number | null; // ratePerShare × quantity
  yieldPct: number | null; // ratePerShare / price
  exDate: string | null; // estimated next ex-date (ISO yyyy-mm-dd), if known
  exDateEstimated: boolean; // true when projected from last year's schedule
}

export interface DividendSummary {
  totalAnnualIncome: number;
  monthlyAverage: number;
  portfolioValue: number;
  portfolioYieldPct: number; // income / value
  payerCount: number;
  holdings: DividendHolding[]; // dividend-paying first, by income desc
  calendar: { symbol: string; name: string | null; exDate: string; estIncome: number | null; estimated: boolean }[];
  calendarEstimated: boolean; // any calendar entry is a forward projection
  asOf: string;
}

/** Roll a (possibly past) ex-date forward by whole years to its next occurrence. */
function nextOccurrence(iso: string, today: string): { date: string; estimated: boolean } {
  if (iso >= today) return { date: iso, estimated: false };
  const d = new Date(iso + "T00:00:00Z");
  const now = new Date(today + "T00:00:00Z");
  while (d < now) d.setUTCFullYear(d.getUTCFullYear() + 1);
  return { date: d.toISOString().slice(0, 10), estimated: true };
}

interface DivInfo {
  ratePerShare: number | null;
  exDate: string | null;
}

/** Per-symbol dividend rate + next ex-date from Yahoo, cached 12h. */
async function getDividendInfo(yahooSymbol: string): Promise<DivInfo> {
  return dividendCache
    .cached(`div:${yahooSymbol}`, DIV_TTL_MS, async () => {
      const s = await yf.quoteSummary(yahooSymbol, { modules: ["summaryDetail", "calendarEvents"] });
      const sd = s.summaryDetail;
      const ce = s.calendarEvents;
      const rate = sd?.trailingAnnualDividendRate ?? sd?.dividendRate ?? null;
      const exRaw = ce?.exDividendDate ?? sd?.exDividendDate ?? null;
      return {
        ratePerShare: typeof rate === "number" && rate > 0 ? rate : null,
        exDate: exRaw ? new Date(exRaw).toISOString().slice(0, 10) : null,
      };
    })
    .catch(() => ({ ratePerShare: null, exDate: null }));
}

export async function computeDividends(holdings: Holding[]): Promise<DividendSummary> {
  // Merge the same stock held at multiple brokers into one line.
  const bySym = new Map<string, { symbol: string; exchange: string; name: string | null; quantity: number }>();
  for (const h of holdings) {
    const ys = toYahooSymbol(h.symbol, h.exchange);
    const e = bySym.get(ys) ?? { symbol: h.symbol, exchange: h.exchange, name: h.name, quantity: 0 };
    e.quantity += h.quantity;
    e.name ??= h.name;
    bySym.set(ys, e);
  }

  const yahooSymbols = [...bySym.keys()];
  const [quotes, infoEntries] = await Promise.all([
    getQuotes(yahooSymbols),
    Promise.all(yahooSymbols.map(async (ys) => [ys, await getDividendInfo(ys)] as const)),
  ]);
  const infoMap = new Map(infoEntries);

  const today = new Date().toISOString().slice(0, 10);
  const rows: DividendHolding[] = [];
  for (const [ys, e] of bySym) {
    const q = quotes.get(ys);
    const price = q?.price ?? null;
    const { ratePerShare, exDate } = infoMap.get(ys) ?? { ratePerShare: null, exDate: null };
    const value = price !== null ? e.quantity * price : null;
    const annualIncome = ratePerShare !== null ? round2(ratePerShare * e.quantity) : null;
    const next = exDate ? nextOccurrence(exDate, today) : null;
    rows.push({
      symbol: e.symbol,
      exchange: e.exchange,
      name: q?.name ?? e.name,
      quantity: e.quantity,
      price,
      value: value !== null ? round2(value) : null,
      ratePerShare,
      annualIncome,
      yieldPct: ratePerShare !== null && price ? round2((ratePerShare / price) * 100) : null,
      exDate: next?.date ?? null,
      exDateEstimated: next?.estimated ?? false,
    });
  }
  rows.sort((a, b) => (b.annualIncome ?? 0) - (a.annualIncome ?? 0));

  const totalAnnualIncome = round2(rows.reduce((s, r) => s + (r.annualIncome ?? 0), 0));
  const portfolioValue = round2(rows.reduce((s, r) => s + (r.value ?? 0), 0));

  const calendar = rows
    .filter((r) => r.exDate && (r.annualIncome ?? 0) > 0)
    .map((r) => ({
      symbol: r.symbol,
      name: r.name,
      exDate: r.exDate as string,
      estIncome: r.annualIncome,
      estimated: r.exDateEstimated,
    }))
    .sort((a, b) => (a.exDate < b.exDate ? -1 : 1));

  return {
    totalAnnualIncome,
    monthlyAverage: round2(totalAnnualIncome / 12),
    portfolioValue,
    portfolioYieldPct: portfolioValue > 0 ? round2((totalAnnualIncome / portfolioValue) * 100) : 0,
    payerCount: rows.filter((r) => (r.annualIncome ?? 0) > 0).length,
    holdings: rows,
    calendar,
    calendarEstimated: calendar.some((c) => c.estimated),
    asOf: new Date().toISOString(),
  };
}
