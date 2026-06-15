import type { Holding } from "@prisma/client";
import { getQuotes, toYahooSymbol } from "./quotes";

export interface EnrichedHolding {
  symbol: string;
  name: string | null;
  broker: string;
  exchange: string;
  sector: string | null;
  quantity: number;
  avgPrice: number;
  invested: number;
  price: number | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  dayChangePct: number | null;
  weightPct: number | null;
  high52: number | null;
  low52: number | null;
  pctFrom52High: number | null;
  trailingPE: number | null;
  marketCap: number | null;
}

export interface AllocationSlice {
  label: string;
  value: number;
  pct: number;
}

export interface PortfolioMetrics {
  totals: {
    invested: number;
    currentValue: number;
    pnl: number;
    pnlPct: number;
    dayChange: number;
    dayChangePct: number;
    holdingsCount: number;
    pricedCount: number;
  };
  holdings: EnrichedHolding[];
  sectorAllocation: AllocationSlice[];
  brokerAllocation: AllocationSlice[];
  concentration: { top1Pct: number; top3Pct: number; top5Pct: number; hhi: number };
  quotesAsOf: string;
}

/** Enrich raw holdings with live quotes and compute portfolio-level metrics. */
export async function computeMetrics(holdings: Holding[]): Promise<PortfolioMetrics> {
  const quotes = await getQuotes(holdings.map((h) => toYahooSymbol(h.symbol, h.exchange)));

  const enriched: EnrichedHolding[] = holdings.map((h) => {
    const q = quotes.get(toYahooSymbol(h.symbol, h.exchange));
    const invested = h.quantity * h.avgPrice;
    const price = q?.price ?? null;
    const value = price !== null ? h.quantity * price : null;
    const pnl = value !== null ? value - invested : null;
    return {
      symbol: h.symbol,
      name: h.name ?? q?.name ?? null,
      broker: h.broker,
      exchange: h.exchange,
      sector: q?.sector ?? null,
      quantity: h.quantity,
      avgPrice: h.avgPrice,
      invested,
      price,
      value,
      pnl,
      pnlPct: pnl !== null && invested > 0 ? (pnl / invested) * 100 : null,
      dayChangePct: q?.dayChange ?? null,
      weightPct: null, // filled below
      high52: q?.high52 ?? null,
      low52: q?.low52 ?? null,
      pctFrom52High:
        q?.high52 && q.price ? ((q.price - q.high52) / q.high52) * 100 : null,
      trailingPE: q?.trailingPE ?? null,
      marketCap: q?.marketCap ?? null,
    };
  });

  // Holdings without a live price contribute their invested amount so totals stay sane
  const effectiveValue = (h: EnrichedHolding) => h.value ?? h.invested;
  const currentValue = enriched.reduce((s, h) => s + effectiveValue(h), 0);
  const invested = enriched.reduce((s, h) => s + h.invested, 0);
  const dayChange = enriched.reduce((s, h) => {
    if (h.value === null || h.dayChangePct === null) return s;
    const prev = h.value / (1 + h.dayChangePct / 100);
    return s + (h.value - prev);
  }, 0);

  for (const h of enriched) {
    h.weightPct = currentValue > 0 ? (effectiveValue(h) / currentValue) * 100 : null;
  }
  enriched.sort((a, b) => effectiveValue(b) - effectiveValue(a));

  const bySector = new Map<string, number>();
  const byBroker = new Map<string, number>();
  for (const h of enriched) {
    const v = effectiveValue(h);
    bySector.set(h.sector ?? "Unclassified", (bySector.get(h.sector ?? "Unclassified") ?? 0) + v);
    byBroker.set(h.broker, (byBroker.get(h.broker) ?? 0) + v);
  }
  const toSlices = (m: Map<string, number>): AllocationSlice[] =>
    [...m.entries()]
      .map(([label, value]) => ({ label, value, pct: currentValue > 0 ? (value / currentValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

  const weights = enriched.map((h) => (h.weightPct ?? 0) / 100);
  const sumTop = (n: number) => weights.slice(0, n).reduce((s, w) => s + w, 0) * 100;

  return {
    totals: {
      invested,
      currentValue,
      pnl: currentValue - invested,
      pnlPct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
      dayChange,
      dayChangePct: currentValue > 0 ? (dayChange / (currentValue - dayChange)) * 100 : 0,
      holdingsCount: enriched.length,
      pricedCount: enriched.filter((h) => h.price !== null).length,
    },
    holdings: enriched,
    sectorAllocation: toSlices(bySector),
    brokerAllocation: toSlices(byBroker),
    concentration: {
      top1Pct: sumTop(1),
      top3Pct: sumTop(3),
      top5Pct: sumTop(5),
      hhi: Math.round(weights.reduce((s, w) => s + w * w, 0) * 10000),
    },
    quotesAsOf: new Date().toISOString(),
  };
}
