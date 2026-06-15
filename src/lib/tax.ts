import type { Transaction } from "@prisma/client";
import { getQuotes, toYahooSymbol } from "./quotes";

/**
 * Capital-gains tax intelligence for listed Indian equity / equity ETFs &
 * mutual funds (STT-paid). This is the differentiator brokers won't build: not
 * a record of what tax you owe, but planning levers — loss harvesting, the
 * ₹1.25L LTCG free allowance, and holding-period countdowns to convert STCG
 * into lower-taxed LTCG.
 *
 * IMPORTANT: rates/thresholds change in most Union Budgets — they live here so
 * there's a single place to update. Figures below are the post-23-Jul-2024
 * regime. This is an *estimate* for equity STT-paid instruments; debt funds,
 * gold, unlisted and international holdings follow different rules and aren't
 * modelled. Not tax advice.
 */
export const TAX_RULES = {
  ltcgThresholdMonths: 12, // listed equity & equity MF held > 12 months = long-term
  stcgRate: 0.2, // short-term: flat 20%
  ltcgRate: 0.125, // long-term: 12.5% on the part above the exemption
  ltcgExemption: 125000, // ₹1.25L aggregate LTCG free per financial year
} as const;

export type Term = "STCG" | "LTCG";

export interface Disposal {
  symbol: string;
  exchange: string;
  quantity: number;
  buyDate: string; // ISO
  sellDate: string; // ISO
  buyValue: number;
  sellValue: number;
  gain: number;
  term: Term;
}

export interface TaxLot {
  symbol: string;
  exchange: string;
  quantity: number;
  buyDate: string; // ISO of the oldest open lot
  cost: number; // cost basis of open qty
  price: number | null;
  value: number | null;
  unrealized: number | null; // null when no live price
  term: Term; // status today
  daysToLtcg: number; // 0 if already long-term
}

export interface HarvestCandidate {
  symbol: string;
  exchange: string;
  quantity: number;
  amount: number; // loss (positive number) or harvestable gain
  term: Term;
  estTaxImpact: number; // tax saved (loss) or tax-free gain bookable (ltcg)
  daysToLtcg?: number;
}

export interface TaxSummary {
  fy: string; // e.g. "2025-26"
  availableFys: string[];
  realized: {
    stcgGain: number;
    ltcgGain: number;
    stcgTax: number;
    ltcgTax: number;
    totalTax: number;
    disposals: Disposal[];
  };
  ltcgAllowance: { exemption: number; used: number; remaining: number };
  unrealized: {
    stcgGain: number;
    ltcgGain: number;
    lots: TaxLot[];
  };
  harvest: {
    lossCandidates: HarvestCandidate[]; // open positions in loss
    totalHarvestableLoss: number;
    estLossTaxSaved: number;
    ltcgFreeCandidates: HarvestCandidate[]; // book LTCG into the remaining allowance
    countdown: HarvestCandidate[]; // STCG-with-gain positions nearing the LTCG line
  };
  rules: typeof TAX_RULES;
  warnings: string[];
  asOf: string;
}

// ---- Financial-year helpers (India: 1 Apr → 31 Mar) ------------------------

/** FY label for a date, e.g. 2025-09-01 → "2025-26", 2026-02-01 → "2025-26". */
export function fyOf(date: Date): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() >= 3 ? y : y - 1; // months are 0-based; Apr = 3
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function fyStartYear(fy: string): number {
  return Number(fy.slice(0, 4));
}

function fyBounds(fy: string): { start: Date; end: Date } {
  const sy = fyStartYear(fy);
  return {
    start: new Date(Date.UTC(sy, 3, 1, 0, 0, 0)), // 1 Apr
    end: new Date(Date.UTC(sy + 1, 2, 31, 23, 59, 59)), // 31 Mar
  };
}

/** Long-term if held strictly more than the threshold (12 months) by `asOf`. */
function ltcgCrossoverDate(buyDate: Date): Date {
  const d = new Date(buyDate);
  d.setUTCMonth(d.getUTCMonth() + TAX_RULES.ltcgThresholdMonths);
  return d;
}

function termFor(buyDate: Date, asOf: Date): Term {
  return asOf > ltcgCrossoverDate(buyDate) ? "LTCG" : "STCG";
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

interface DatedLot {
  qty: number;
  price: number; // per-share cost (fees folded in proportionally)
  date: Date;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compute the full tax picture for a target FY (defaults to the FY containing
 * `asOf`). FIFO-matches sells against buys, dating each matched chunk so we can
 * classify STCG vs LTCG, then values still-open lots at live prices.
 */
export async function computeTax(
  transactions: Transaction[],
  fy?: string,
  asOf: Date = new Date(),
): Promise<TaxSummary> {
  const targetFy = fy ?? fyOf(asOf);
  const { start, end } = fyBounds(targetFy);

  const sorted = [...transactions].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());

  const lots = new Map<string, DatedLot[]>();
  const meta = new Map<string, { exchange: string }>();
  const disposals: Disposal[] = [];
  const fySet = new Set<string>();
  let unmatchedSellQty = 0;

  for (const t of sorted) {
    const key = t.symbol;
    meta.set(key, { exchange: t.exchange });
    const fees = t.fees ?? 0;

    if (t.type === "BUY") {
      // Fold buy-side fees into per-share cost so gains are net of charges.
      const perShare = t.price + (t.quantity > 0 ? fees / t.quantity : 0);
      const arr = lots.get(key) ?? [];
      arr.push({ qty: t.quantity, price: perShare, date: t.tradedAt });
      lots.set(key, arr);
    } else {
      fySet.add(fyOf(t.tradedAt));
      const sellPerShare = t.price - (t.quantity > 0 ? fees / t.quantity : 0);
      let remaining = t.quantity;
      const arr = lots.get(key) ?? [];
      while (remaining > 0 && arr.length > 0) {
        const lot = arr[0];
        const take = Math.min(remaining, lot.qty);
        const buyValue = take * lot.price;
        const sellValue = take * sellPerShare;
        disposals.push({
          symbol: key,
          exchange: t.exchange,
          quantity: take,
          buyDate: lot.date.toISOString().slice(0, 10),
          sellDate: t.tradedAt.toISOString().slice(0, 10),
          buyValue: round2(buyValue),
          sellValue: round2(sellValue),
          gain: round2(sellValue - buyValue),
          term: termFor(lot.date, t.tradedAt),
        });
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-9) arr.shift();
      }
      if (remaining > 1e-9) unmatchedSellQty += remaining; // sold more than we have a buy for
    }
  }

  // ---- Realized gains for the target FY -----------------------------------
  const fyDisposals = disposals.filter((d) => {
    const sd = new Date(d.sellDate);
    return sd >= start && sd <= end;
  });
  let stcgGain = 0;
  let ltcgGain = 0;
  for (const d of fyDisposals) {
    if (d.term === "STCG") stcgGain += d.gain;
    else ltcgGain += d.gain;
  }
  const ltcgUsed = Math.min(Math.max(ltcgGain, 0), TAX_RULES.ltcgExemption);
  const ltcgRemaining = Math.max(0, TAX_RULES.ltcgExemption - ltcgUsed);
  const stcgTax = Math.max(0, stcgGain) * TAX_RULES.stcgRate;
  const ltcgTax = Math.max(0, ltcgGain - TAX_RULES.ltcgExemption) * TAX_RULES.ltcgRate;

  // ---- Open lots valued at live prices ------------------------------------
  const openSymbols: { symbol: string; exchange: string }[] = [];
  for (const [symbol, arr] of lots) {
    if (arr.reduce((s, l) => s + l.qty, 0) > 1e-9) {
      openSymbols.push({ symbol, exchange: meta.get(symbol)?.exchange ?? "NSE" });
    }
  }
  const quotes = await getQuotes(openSymbols.map((s) => toYahooSymbol(s.symbol, s.exchange)));

  const taxLots: TaxLot[] = [];
  let uStcg = 0;
  let uLtcg = 0;
  for (const { symbol, exchange } of openSymbols) {
    const arr = lots.get(symbol)!.filter((l) => l.qty > 1e-9);
    const qty = arr.reduce((s, l) => s + l.qty, 0);
    const cost = arr.reduce((s, l) => s + l.qty * l.price, 0);
    const oldest = arr.reduce((min, l) => (l.date < min ? l.date : min), arr[0].date);
    const q = quotes.get(toYahooSymbol(symbol, exchange));
    const price = q?.price ?? null;
    const value = price !== null ? qty * price : null;
    const unrealized = value !== null ? value - cost : null;
    const term = termFor(oldest, asOf);
    const daysToLtcg = term === "LTCG" ? 0 : Math.max(0, daysBetween(asOf, ltcgCrossoverDate(oldest)));

    if (unrealized !== null) {
      if (term === "STCG") uStcg += unrealized;
      else uLtcg += unrealized;
    }

    taxLots.push({
      symbol,
      exchange,
      quantity: qty,
      buyDate: oldest.toISOString().slice(0, 10),
      cost: round2(cost),
      price,
      value: value !== null ? round2(value) : null,
      unrealized: unrealized !== null ? round2(unrealized) : null,
      term,
      daysToLtcg,
    });
  }
  taxLots.sort((a, b) => (a.unrealized ?? 0) - (b.unrealized ?? 0)); // biggest losses first

  // ---- Harvesting levers --------------------------------------------------
  // 1. Tax-loss harvesting: open positions sitting in a loss. Booking the loss
  //    offsets realized gains — short-term losses can offset both STCG & LTCG
  //    (so we value them at the higher STCG rate), long-term losses only LTCG.
  const lossCandidates: HarvestCandidate[] = taxLots
    .filter((l) => l.unrealized !== null && l.unrealized < 0)
    .map((l) => {
      const loss = -(l.unrealized as number);
      const rate = l.term === "STCG" ? TAX_RULES.stcgRate : TAX_RULES.ltcgRate;
      return {
        symbol: l.symbol,
        exchange: l.exchange,
        quantity: l.quantity,
        amount: round2(loss),
        term: l.term,
        estTaxImpact: round2(loss * rate),
      };
    });
  const totalHarvestableLoss = round2(lossCandidates.reduce((s, c) => s + c.amount, 0));
  // Only meaningful up to the gains you've actually realized this FY.
  const offsetableGain = Math.max(0, stcgGain) + Math.max(0, ltcgGain);
  const estLossTaxSaved = round2(
    lossCandidates.reduce((s, c) => s + c.estTaxImpact, 0) *
      (totalHarvestableLoss > 0 ? Math.min(1, offsetableGain / totalHarvestableLoss) : 0),
  );

  // 2. LTCG-allowance harvesting: long-term winners you can sell tax-free while
  //    allowance remains (book gains, optionally rebuy to reset the cost base).
  const ltcgFreeCandidates: HarvestCandidate[] =
    ltcgRemaining > 0
      ? taxLots
          .filter((l) => l.term === "LTCG" && l.unrealized !== null && l.unrealized > 0)
          .sort((a, b) => (b.unrealized as number) - (a.unrealized as number))
          .map((l) => ({
            symbol: l.symbol,
            exchange: l.exchange,
            quantity: l.quantity,
            amount: l.unrealized as number,
            term: "LTCG" as Term,
            estTaxImpact: round2(Math.min(l.unrealized as number, ltcgRemaining) * TAX_RULES.ltcgRate),
          }))
      : [];

  // 3. Holding-period countdown: short-term winners close to the 12-month line.
  //    Waiting converts a 20% STCG bill into a 12.5% LTCG one.
  const countdown: HarvestCandidate[] = taxLots
    .filter((l) => l.term === "STCG" && l.unrealized !== null && l.unrealized > 0 && l.daysToLtcg <= 90)
    .sort((a, b) => a.daysToLtcg - b.daysToLtcg)
    .map((l) => ({
      symbol: l.symbol,
      exchange: l.exchange,
      quantity: l.quantity,
      amount: l.unrealized as number,
      term: "STCG" as Term,
      estTaxImpact: round2((l.unrealized as number) * (TAX_RULES.stcgRate - TAX_RULES.ltcgRate)),
      daysToLtcg: l.daysToLtcg,
    }));

  const warnings: string[] = [];
  if (unmatchedSellQty > 1e-9) {
    warnings.push(
      `${Math.round(unmatchedSellQty)} sold unit(s) had no matching buy in your data ` +
        "(holdings likely predate the imported trades) and are excluded from realized gains. " +
        "Import earlier trades for a complete picture.",
    );
  }

  const availableFys = [...fySet].sort().reverse();
  if (!availableFys.includes(targetFy)) availableFys.unshift(targetFy);

  return {
    fy: targetFy,
    availableFys,
    realized: {
      stcgGain: round2(stcgGain),
      ltcgGain: round2(ltcgGain),
      stcgTax: round2(stcgTax),
      ltcgTax: round2(ltcgTax),
      totalTax: round2(stcgTax + ltcgTax),
      disposals: fyDisposals.sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1)),
    },
    ltcgAllowance: { exemption: TAX_RULES.ltcgExemption, used: round2(ltcgUsed), remaining: round2(ltcgRemaining) },
    unrealized: { stcgGain: round2(uStcg), ltcgGain: round2(uLtcg), lots: taxLots },
    harvest: {
      lossCandidates,
      totalHarvestableLoss,
      estLossTaxSaved,
      ltcgFreeCandidates,
      countdown,
    },
    rules: TAX_RULES,
    warnings,
    asOf: asOf.toISOString(),
  };
}
