import type { Holding, Transaction } from "@prisma/client";
import YahooFinance from "yahoo-finance2";
import { getQuotes, toYahooSymbol } from "./quotes";
import { computePnl, computeXirr } from "./pnl";
import type { AllocationSlice } from "./metrics";

const yf = new YahooFinance();

// Market-cap tiers in absolute INR (Yahoo `marketCap` for .NS/.BO is rupees).
// Roughly the SEBI large/mid/small bands; one place to retune.
export const CAP_TIERS = {
  large: 5e11, // ≥ ₹50,000 Cr
  mid: 1.5e11, // ₹15,000–50,000 Cr  (below = small)
} as const;

export type CapTier = "Large cap" | "Mid cap" | "Small cap" | "Unclassified";

function capTier(marketCap: number | null): CapTier {
  if (marketCap === null || !Number.isFinite(marketCap)) return "Unclassified";
  if (marketCap >= CAP_TIERS.large) return "Large cap";
  if (marketCap >= CAP_TIERS.mid) return "Mid cap";
  return "Small cap";
}

export interface BrokerLeg {
  broker: string;
  quantity: number;
  invested: number;
  value: number | null;
}

/** One stock, merged across every broker the user holds it at. */
export interface MergedPosition {
  symbol: string;
  exchange: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null;
  capTier: CapTier;
  quantity: number;
  invested: number;
  value: number | null; // null only if no broker leg had a live price
  price: number | null; // value-weighted average price across legs
  pnl: number | null;
  pnlPct: number | null;
  weightPct: number;
  brokers: BrokerLeg[]; // sorted by value desc; length > 1 means cross-broker
}

export interface CrossBrokerAnalytics {
  positions: MergedPosition[];
  /** Positions held at more than one broker — the cross-broker exposure story. */
  multiBroker: MergedPosition[];
  capAllocation: AllocationSlice[];
  sectorAllocation: AllocationSlice[];
  concentration: { top1Pct: number; top3Pct: number; top5Pct: number; hhi: number };
  totals: {
    value: number;
    invested: number;
    positionCount: number; // distinct stocks (after merge)
    rowCount: number; // raw broker-tagged holding rows
    brokerCount: number;
  };
  asOf: string;
}

/**
 * Collapse broker-tagged holding rows into true per-stock positions and derive
 * the cross-broker view: market-cap allocation, real single-stock concentration
 * (the dashboard counts the same stock at two brokers as two positions, which
 * understates it), and which stocks are split across brokers.
 */
export async function computeCrossBroker(holdings: Holding[]): Promise<CrossBrokerAnalytics> {
  const quotes = await getQuotes(holdings.map((h) => toYahooSymbol(h.symbol, h.exchange)));

  const groups = new Map<string, Holding[]>();
  for (const h of holdings) {
    const arr = groups.get(h.symbol) ?? [];
    arr.push(h);
    groups.set(h.symbol, arr);
  }

  const positions: MergedPosition[] = [];
  for (const [symbol, rows] of groups) {
    const legs: BrokerLeg[] = [];
    let quantity = 0;
    let invested = 0;
    let value: number | null = null;
    let sector: string | null = null;
    let name: string | null = null;
    let marketCap: number | null = null;
    let exchange = rows[0].exchange;

    for (const h of rows) {
      const q = quotes.get(toYahooSymbol(h.symbol, h.exchange));
      const legInvested = h.quantity * h.avgPrice;
      const legValue = q?.price != null ? h.quantity * q.price : null;
      quantity += h.quantity;
      invested += legInvested;
      if (legValue !== null) value = (value ?? 0) + legValue;
      sector ??= q?.sector ?? null;
      name ??= h.name ?? q?.name ?? null;
      marketCap ??= q?.marketCap ?? null;
      legs.push({ broker: h.broker, quantity: h.quantity, invested: legInvested, value: legValue });
    }
    legs.sort((a, b) => (b.value ?? b.invested) - (a.value ?? a.invested));

    const pnl = value !== null ? value - invested : null;
    positions.push({
      symbol,
      exchange,
      name,
      sector,
      marketCap,
      capTier: capTier(marketCap),
      quantity,
      invested,
      value,
      price: value !== null && quantity > 0 ? value / quantity : null,
      pnl,
      pnlPct: pnl !== null && invested > 0 ? (pnl / invested) * 100 : null,
      weightPct: 0, // filled below
      brokers: legs,
    });
  }

  // Effective value: priced positions use live value, unpriced fall back to
  // invested so totals stay sane (mirrors computeMetrics).
  const eff = (p: MergedPosition) => p.value ?? p.invested;
  const totalValue = positions.reduce((s, p) => s + eff(p), 0);
  const totalInvested = positions.reduce((s, p) => s + p.invested, 0);
  for (const p of positions) p.weightPct = totalValue > 0 ? (eff(p) / totalValue) * 100 : 0;
  positions.sort((a, b) => eff(b) - eff(a));

  const byCap = new Map<string, number>();
  const bySector = new Map<string, number>();
  for (const p of positions) {
    byCap.set(p.capTier, (byCap.get(p.capTier) ?? 0) + eff(p));
    const sec = p.sector ?? "Unclassified";
    bySector.set(sec, (bySector.get(sec) ?? 0) + eff(p));
  }
  const toSlices = (m: Map<string, number>): AllocationSlice[] =>
    [...m.entries()]
      .map(([label, value]) => ({ label, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
      .sort((a, b) => b.value - a.value);

  const weights = positions.map((p) => p.weightPct / 100);
  const sumTop = (n: number) => weights.slice(0, n).reduce((s, w) => s + w, 0) * 100;

  const brokers = new Set(holdings.map((h) => h.broker));

  return {
    positions,
    multiBroker: positions.filter((p) => p.brokers.length > 1),
    capAllocation: toSlices(byCap),
    sectorAllocation: toSlices(bySector),
    concentration: {
      top1Pct: sumTop(1),
      top3Pct: sumTop(3),
      top5Pct: sumTop(5),
      hhi: Math.round(weights.reduce((s, w) => s + w * w, 0) * 10000),
    },
    totals: {
      value: totalValue,
      invested: totalInvested,
      positionCount: positions.length,
      rowCount: holdings.length,
      brokerCount: brokers.size,
    },
    asOf: new Date().toISOString(),
  };
}

export interface NiftyBenchmark {
  available: boolean;
  reason?: string; // set when unavailable
  portfolioXirr: number | null; // fraction, e.g. 0.18
  niftyXirr: number | null;
  alphaPct: number | null; // (portfolio − nifty), percentage points
  invested: number; // net cash deployed (still-open cost basis)
  portfolioValue: number; // current live value of open positions
  niftyValue: number; // same cashflows replayed into Nifty 50
  firstDate: string | null;
  asOf: string;
}

interface NiftyClose {
  t: number; // epoch ms
  close: number;
}

/** Daily Nifty 50 closes from `from`, ascending. */
async function niftyCloses(from: Date): Promise<NiftyClose[]> {
  const res = await yf.chart("^NSEI", { period1: from, interval: "1d" });
  const out: NiftyClose[] = [];
  for (const r of res.quotes ?? []) {
    if (r?.date && typeof r.close === "number") {
      out.push({ t: new Date(r.date).getTime(), close: r.close });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Last close on or before `t` (binary search); earliest close if none precedes. */
function closeAt(series: NiftyClose[], t: number): number | null {
  if (series.length === 0) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) {
      ans = series[mid].close;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans ?? series[0].close;
}

/**
 * Benchmark the user's actual money-weighted return against Nifty 50: replay the
 * exact buy/sell cashflows (same rupee amounts, same dates) into the index and
 * compare XIRR. Answers "would I have done better just buying the Nifty?" —
 * impossible to see on any single broker's app.
 */
export async function benchmarkVsNifty(transactions: Transaction[]): Promise<NiftyBenchmark> {
  const asOf = new Date().toISOString();
  const base: NiftyBenchmark = {
    available: false,
    portfolioXirr: null,
    niftyXirr: null,
    alphaPct: null,
    invested: 0,
    portfolioValue: 0,
    niftyValue: 0,
    firstDate: null,
    asOf,
  };

  if (transactions.length < 2) {
    return { ...base, reason: "Import a tradebook with at least two trades to benchmark against the Nifty." };
  }

  const sorted = [...transactions].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  const pnl = await computePnl(sorted);

  const series = await niftyCloses(sorted[0].tradedAt);
  if (series.length === 0) {
    return { ...base, reason: "Couldn't fetch Nifty 50 history right now — try again shortly." };
  }

  // Replay each trade as buying/selling Nifty units at that day's close.
  let units = 0;
  const flows: { date: Date; amount: number }[] = [];
  for (const t of sorted) {
    const close = closeAt(series, t.tradedAt.getTime());
    if (close === null || close <= 0) continue;
    const fees = t.fees ?? 0;
    if (t.type === "BUY") {
      const cost = t.quantity * t.price + fees;
      units += cost / close;
      flows.push({ date: t.tradedAt, amount: -cost });
    } else {
      const proceeds = t.quantity * t.price - fees;
      units -= proceeds / close;
      flows.push({ date: t.tradedAt, amount: proceeds });
    }
  }

  const latestClose = series[series.length - 1].close;
  const niftyValue = Math.max(0, units) * latestClose;
  if (niftyValue > 0) flows.push({ date: new Date(), amount: niftyValue });
  const niftyXirr = computeXirr(flows);

  const portfolioXirr = pnl.xirr;
  const alphaPct =
    portfolioXirr !== null && niftyXirr !== null ? (portfolioXirr - niftyXirr) * 100 : null;

  return {
    available: true,
    portfolioXirr,
    niftyXirr,
    alphaPct,
    invested: pnl.totalInvested,
    portfolioValue: pnl.currentValue,
    niftyValue,
    firstDate: sorted[0].tradedAt.toISOString().slice(0, 10),
    asOf,
  };
}
