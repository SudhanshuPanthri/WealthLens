import type { Transaction } from "@prisma/client";
import { getQuotes, toYahooSymbol } from "./quotes";

export interface PnlPosition {
  symbol: string;
  exchange: string;
  openQty: number;
  avgCost: number; // per-share cost basis of open lots
  invested: number; // cost basis of open lots
  price: number | null;
  value: number | null;
  unrealizedPnl: number | null;
  realizedPnl: number; // realized on this symbol so far
}

export interface PnlPoint {
  date: string; // ISO date
  invested: number; // cumulative net cash deployed (buy cost − sell proceeds)
  realized: number; // cumulative realized P&L
}

export interface PnlSummary {
  totalInvested: number; // cost basis of still-open positions
  currentValue: number; // open positions at live price
  totalUnrealized: number;
  totalRealized: number;
  totalReturnPct: number | null; // (unrealized+realized) vs invested
  xirr: number | null; // annualized money-weighted return (fraction, e.g. 0.18 = 18%)
  buyCount: number;
  sellCount: number;
  tradeCount: number;
  firstTradeDate: string | null;
  positions: PnlPosition[];
  series: PnlPoint[];
}

interface Lot {
  qty: number;
  price: number;
}

interface Cashflow {
  date: Date;
  amount: number; // negative = money in (buy), positive = money out (sell / final value)
}

/**
 * Compute realized/unrealized P&L (FIFO), open positions, an invested-over-time
 * series, and XIRR from a transaction ledger enriched with live quotes.
 */
export async function computePnl(transactions: Transaction[]): Promise<PnlSummary> {
  if (transactions.length === 0) {
    return {
      totalInvested: 0,
      currentValue: 0,
      totalUnrealized: 0,
      totalRealized: 0,
      totalReturnPct: null,
      xirr: null,
      buyCount: 0,
      sellCount: 0,
      tradeCount: 0,
      firstTradeDate: null,
      positions: [],
      series: [],
    };
  }

  const sorted = [...transactions].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());

  // Per-symbol FIFO lots and running realized P&L.
  const lots = new Map<string, Lot[]>();
  const realizedBySymbol = new Map<string, number>();
  const meta = new Map<string, { exchange: string }>();
  const cashflows: Cashflow[] = [];
  const series: PnlPoint[] = [];

  let cumulativeInvested = 0; // net cash deployed (buy cost − sell proceeds)
  let cumulativeRealized = 0;
  let buyCount = 0;
  let sellCount = 0;

  for (const t of sorted) {
    const key = t.symbol;
    meta.set(key, { exchange: t.exchange });
    const fees = t.fees ?? 0;

    if (t.type === "BUY") {
      buyCount++;
      const cost = t.quantity * t.price + fees;
      cumulativeInvested += cost;
      const arr = lots.get(key) ?? [];
      arr.push({ qty: t.quantity, price: t.price });
      lots.set(key, arr);
      cashflows.push({ date: t.tradedAt, amount: -cost });
    } else {
      sellCount++;
      const proceeds = t.quantity * t.price - fees;
      cumulativeInvested -= proceeds;
      cashflows.push({ date: t.tradedAt, amount: proceeds });

      // Match against earliest open lots (FIFO).
      let remaining = t.quantity;
      let costOfSold = 0;
      const arr = lots.get(key) ?? [];
      while (remaining > 0 && arr.length > 0) {
        const lot = arr[0];
        const take = Math.min(remaining, lot.qty);
        costOfSold += take * lot.price;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) arr.shift();
      }
      // Any oversold qty (e.g. holdings predate the tradebook) costs nothing.
      const realized = proceeds - costOfSold;
      cumulativeRealized += realized;
      realizedBySymbol.set(key, (realizedBySymbol.get(key) ?? 0) + realized);
    }

    const iso = t.tradedAt.toISOString().slice(0, 10);
    const last = series[series.length - 1];
    const point = { date: iso, invested: round2(cumulativeInvested), realized: round2(cumulativeRealized) };
    if (last && last.date === iso) series[series.length - 1] = point;
    else series.push(point);
  }

  // Open positions from remaining lots, valued with live quotes.
  const openSymbols: { symbol: string; exchange: string }[] = [];
  for (const [symbol, arr] of lots) {
    const openQty = arr.reduce((s, l) => s + l.qty, 0);
    if (openQty > 1e-9) openSymbols.push({ symbol, exchange: meta.get(symbol)?.exchange ?? "NSE" });
  }
  const quotes = await getQuotes(openSymbols.map((s) => toYahooSymbol(s.symbol, s.exchange)));

  const positions: PnlPosition[] = [];
  let totalInvested = 0;
  let currentValue = 0;
  let totalUnrealized = 0;

  for (const { symbol, exchange } of openSymbols) {
    const arr = lots.get(symbol)!;
    const openQty = arr.reduce((s, l) => s + l.qty, 0);
    const costBasis = arr.reduce((s, l) => s + l.qty * l.price, 0);
    const q = quotes.get(toYahooSymbol(symbol, exchange));
    const price = q?.price ?? null;
    const value = price !== null ? openQty * price : null;
    const unrealized = value !== null ? value - costBasis : null;

    totalInvested += costBasis;
    if (value !== null) currentValue += value;
    if (unrealized !== null) totalUnrealized += unrealized;

    positions.push({
      symbol,
      exchange,
      openQty,
      avgCost: openQty > 0 ? costBasis / openQty : 0,
      invested: costBasis,
      price,
      value,
      unrealizedPnl: unrealized,
      realizedPnl: realizedBySymbol.get(symbol) ?? 0,
    });
  }
  // Symbols fully closed still carry realized P&L — surface them too.
  for (const [symbol, realized] of realizedBySymbol) {
    if (!openSymbols.some((s) => s.symbol === symbol)) {
      positions.push({
        symbol,
        exchange: meta.get(symbol)?.exchange ?? "NSE",
        openQty: 0,
        avgCost: 0,
        invested: 0,
        price: null,
        value: null,
        unrealizedPnl: null,
        realizedPnl: realized,
      });
    }
  }
  positions.sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  // XIRR: add the current open-position value as a final inflow today.
  let xirr: number | null = null;
  if (currentValue > 0) {
    cashflows.push({ date: new Date(), amount: currentValue });
  }
  xirr = computeXirr(cashflows);

  const totalReturnPct =
    totalInvested > 0 ? ((totalUnrealized + totalRealizedSum(realizedBySymbol)) / totalInvested) * 100 : null;

  return {
    totalInvested: round2(totalInvested),
    currentValue: round2(currentValue),
    totalUnrealized: round2(totalUnrealized),
    totalRealized: round2(cumulativeRealized),
    totalReturnPct,
    xirr,
    buyCount,
    sellCount,
    tradeCount: sorted.length,
    firstTradeDate: sorted[0].tradedAt.toISOString().slice(0, 10),
    positions,
    series,
  };
}

function totalRealizedSum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * XIRR (irregular-interval IRR) via Newton-Raphson with a bisection fallback.
 * Returns the annualized rate as a fraction, or null if it can't converge or
 * there aren't both inflows and outflows.
 */
export function computeXirr(flows: Cashflow[]): number | null {
  if (flows.length < 2) return null;
  const hasPos = flows.some((f) => f.amount > 0);
  const hasNeg = flows.some((f) => f.amount < 0);
  if (!hasPos || !hasNeg) return null;

  const t0 = flows[0].date.getTime();
  const years = (d: Date) => (d.getTime() - t0) / (365 * 24 * 60 * 60 * 1000);

  const npv = (rate: number) =>
    flows.reduce((s, f) => s + f.amount / Math.pow(1 + rate, years(f.date)), 0);
  const dNpv = (rate: number) =>
    flows.reduce((s, f) => {
      const y = years(f.date);
      return s - (y * f.amount) / Math.pow(1 + rate, y + 1);
    }, 0);

  // Newton-Raphson
  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const value = npv(rate);
    const deriv = dNpv(rate);
    if (Math.abs(deriv) < 1e-10) break;
    const next = rate - value / deriv;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < 1e-7) return next > -0.9999 ? next : null;
    rate = next;
  }

  // Bisection fallback over a wide bracket
  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}
