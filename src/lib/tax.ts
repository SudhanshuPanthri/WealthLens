import type { Transaction, FundHolding } from "@prisma/client";
import { getQuotes, toYahooSymbol } from "./quotes";
import { computeFundMetrics } from "./funds";

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
  isin: string | null;
  quantity: number;
  buyDate: string; // ISO
  sellDate: string; // ISO
  buyValue: number;
  sellValue: number;
  gain: number;
  term: Term;
}

/** Losses applied to reduce a financial year's taxable gains. */
export interface LossSetOff {
  currentStclVsLtcg: number; // this year's net short-term loss set against this year's LTCG
  broughtFwdStclUsed: number; // carried short-term loss set against this year's STCG then LTCG
  broughtFwdLtclUsed: number; // carried long-term loss set against this year's LTCG
  totalSetOff: number;
}

/** Unabsorbed loss from one FY, still available to carry forward (8 AY limit). */
export interface CarryForwardBucket {
  fy: string; // origin FY the loss was booked in
  stcl: number; // remaining short-term capital loss
  ltcl: number; // remaining long-term capital loss
  expiresFy: string; // last FY it can still be set off (origin + 8)
}

export interface CarryForward {
  stcl: number; // total STCL carried INTO the FY after the selected one
  ltcl: number; // total LTCL carried forward
  buckets: CarryForwardBucket[]; // by origin FY, oldest first
  expiringFy: string | null; // earliest expiry among the buckets
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
  kind?: "stock" | "fund"; // funds: equity MF positions; default stock
}

/** One position to sell in the year-end harvest plan, with how its loss is applied. */
export interface HarvestPlanItem {
  symbol: string; // ticker (stocks) or scheme name (funds)
  exchange: string; // NSE/BSE, or "MF" for funds
  kind: "stock" | "fund";
  quantity: number;
  loss: number; // total loss booked if the whole position is sold (positive)
  term: Term;
  appliedToStcg: number; // portion of the loss that cancels short-term gains
  appliedToLtcg: number; // portion that cancels long-term gains
  taxSaved: number; // appliedToStcg*stcgRate + appliedToLtcg*ltcgRate
}

/** An optimized set of positions to sell before the FY-end to cut this year's tax. */
export interface HarvestPlan {
  items: HarvestPlanItem[];
  lossBooked: number; // total loss realized by selling the listed positions
  gainsOffset: number; // taxable gains actually cancelled
  taxBefore: number; // estimated tax for the FY as things stand
  taxAfter: number; // estimated tax after executing the plan
  taxSaved: number; // taxBefore − taxAfter
  carryForwardCreated: number; // booked loss beyond this year's gains (carries forward)
  fundTermAssumed: boolean; // a fund's holding period was unknown and assumed long-term
}

export interface TaxSummary {
  fy: string; // e.g. "2025-26"
  availableFys: string[];
  realized: {
    stcgGain: number; // gross net short-term gain for the FY (can be < 0)
    ltcgGain: number; // gross net long-term gain for the FY (can be < 0)
    netStcg: number; // taxable short-term after loss set-off (≥ 0)
    netLtcg: number; // taxable long-term after loss set-off (≥ 0, before exemption)
    setOff: LossSetOff;
    stcgTax: number; // on netStcg
    ltcgTax: number; // on netLtcg above the exemption
    totalTax: number;
    disposals: Disposal[];
  };
  carryForward: CarryForward; // losses carried into the FY after the selected one
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
    plan: HarvestPlan | null; // optimized year-end sell plan (current FY only)
  };
  deadline: { fyEnd: string; daysLeft: number; isCurrentFy: boolean }; // 31-Mar deadline for the target FY
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

/** FY label from a start year, e.g. 2025 → "2025-26". */
function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// Capital losses may be carried forward for 8 assessment years after the year
// they're booked (a loss in FY Y can be set off through FY Y+8).
const CARRY_FORWARD_YEARS = 8;

interface FyGains {
  stcgGross: number; // net short-term gain for the FY (within-head set-off already applied)
  ltcgGross: number; // net long-term gain for the FY
}

/**
 * Apply Indian capital-loss set-off rules chronologically through `targetFy`:
 *  - within a head, gains and losses are already netted (caller passes net),
 *  - a current-year short-term loss sets off the current year's long-term gain,
 *  - brought-forward STCL sets off STCG first (higher rate) then LTCG,
 *  - brought-forward / current LTCL sets off only LTCG,
 *  - unabsorbed losses carry forward up to 8 AYs (oldest used first, then expire).
 * Returns the target FY's set-off + taxable gains and the carry-forward ledger
 * standing after that FY.
 */
function runSetOff(
  perFy: Map<string, FyGains>,
  targetFy: string,
): { setOff: LossSetOff; netStcg: number; netLtcg: number; carryForward: CarryForward } {
  const targetSy = fyStartYear(targetFy);
  const years = new Set<number>([...perFy.keys()].map(fyStartYear));
  years.add(targetSy);
  const ordered = [...years].filter((sy) => sy <= targetSy).sort((a, b) => a - b);

  let buckets: { sy: number; stcl: number; ltcl: number }[] = [];
  let result = { setOff: emptySetOff(), netStcg: 0, netLtcg: 0 };

  for (const sy of ordered) {
    buckets = buckets.filter((b) => sy <= b.sy + CARRY_FORWARD_YEARS); // expire stale losses
    const g = perFy.get(fyLabel(sy)) ?? { stcgGross: 0, ltcgGross: 0 };

    let stcg = Math.max(0, g.stcgGross);
    let ltcg = Math.max(0, g.ltcgGross);
    let newStcl = Math.max(0, -g.stcgGross);
    const newLtcl = Math.max(0, -g.ltcgGross);
    const so = emptySetOff();

    // 1) current-year STCL → current-year LTCG (STCG is already netted within head)
    const a = Math.min(newStcl, ltcg);
    ltcg -= a;
    newStcl -= a;
    so.currentStclVsLtcg = a;

    // 2) brought-forward losses, oldest first
    buckets.sort((x, y) => x.sy - y.sy);
    for (const b of buckets) {
      const s1 = Math.min(b.stcl, stcg); // bf STCL → STCG (saves the higher rate first)
      stcg -= s1;
      b.stcl -= s1;
      const s2 = Math.min(b.stcl, ltcg); // bf STCL → LTCG
      ltcg -= s2;
      b.stcl -= s2;
      const l1 = Math.min(b.ltcl, ltcg); // bf LTCL → LTCG only
      ltcg -= l1;
      b.ltcl -= l1;
      so.broughtFwdStclUsed += s1 + s2;
      so.broughtFwdLtclUsed += l1;
    }
    buckets = buckets.filter((b) => b.stcl > 1e-6 || b.ltcl > 1e-6);
    if (newStcl > 1e-6 || newLtcl > 1e-6) buckets.push({ sy, stcl: newStcl, ltcl: newLtcl });

    so.currentStclVsLtcg = round2(so.currentStclVsLtcg);
    so.broughtFwdStclUsed = round2(so.broughtFwdStclUsed);
    so.broughtFwdLtclUsed = round2(so.broughtFwdLtclUsed);
    so.totalSetOff = round2(so.currentStclVsLtcg + so.broughtFwdStclUsed + so.broughtFwdLtclUsed);

    if (sy === targetSy) result = { setOff: so, netStcg: round2(stcg), netLtcg: round2(ltcg) };
  }

  const cfBuckets: CarryForwardBucket[] = buckets
    .map((b) => ({ fy: fyLabel(b.sy), stcl: round2(b.stcl), ltcl: round2(b.ltcl), expiresFy: fyLabel(b.sy + CARRY_FORWARD_YEARS) }))
    .sort((a, b) => (a.fy < b.fy ? -1 : 1));

  const carryForward: CarryForward = {
    stcl: round2(cfBuckets.reduce((s, b) => s + b.stcl, 0)),
    ltcl: round2(cfBuckets.reduce((s, b) => s + b.ltcl, 0)),
    buckets: cfBuckets,
    expiringFy: cfBuckets.length ? cfBuckets[0].expiresFy : null,
  };
  return { ...result, carryForward };
}

function emptySetOff(): LossSetOff {
  return { currentStclVsLtcg: 0, broughtFwdStclUsed: 0, broughtFwdLtclUsed: 0, totalSetOff: 0 };
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
  isin: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Greedy year-end harvest plan: pick which loss-making positions to sell to
 * cancel the most tax on this year's realized gains. Short-term losses are
 * applied first (they kill 20% STCG, then 12.5% LTCG), then long-term losses
 * (LTCG only). Only LTCG above the ₹1.25L exemption is worth offsetting — the
 * part below it is already tax-free. Whole positions are taken (you sell the
 * lot), so booked loss beyond the gains simply carries forward.
 */
function buildHarvestPlan(
  losers: HarvestCandidate[],
  netStcg: number,
  netLtcg: number,
  taxBefore: number,
): HarvestPlan {
  let needStcg = Math.max(0, netStcg);
  let needLtcg = Math.max(0, netLtcg - TAX_RULES.ltcgExemption);

  const shortTerm = losers.filter((l) => l.term === "STCG").sort((a, b) => b.amount - a.amount);
  const longTerm = losers.filter((l) => l.term === "LTCG").sort((a, b) => b.amount - a.amount);
  const items: HarvestPlanItem[] = [];

  // Short-term losses: cancel STCG first (higher rate), then spill onto LTCG.
  for (const l of shortTerm) {
    if (needStcg <= 0 && needLtcg <= 0) break;
    const aS = Math.min(l.amount, needStcg);
    const aL = Math.min(l.amount - aS, needLtcg);
    if (aS <= 0 && aL <= 0) continue;
    needStcg -= aS;
    needLtcg -= aL;
    items.push({
      symbol: l.symbol,
      exchange: l.exchange,
      kind: l.kind ?? "stock",
      quantity: l.quantity,
      loss: l.amount,
      term: l.term,
      appliedToStcg: round2(aS),
      appliedToLtcg: round2(aL),
      taxSaved: round2(aS * TAX_RULES.stcgRate + aL * TAX_RULES.ltcgRate),
    });
  }
  // Long-term losses: LTCG only.
  for (const l of longTerm) {
    if (needLtcg <= 0) break;
    const aL = Math.min(l.amount, needLtcg);
    if (aL <= 0) continue;
    needLtcg -= aL;
    items.push({
      symbol: l.symbol,
      exchange: l.exchange,
      kind: l.kind ?? "stock",
      quantity: l.quantity,
      loss: l.amount,
      term: l.term,
      appliedToStcg: 0,
      appliedToLtcg: round2(aL),
      taxSaved: round2(aL * TAX_RULES.ltcgRate),
    });
  }

  const lossBooked = round2(items.reduce((s, i) => s + i.loss, 0));
  const gainsOffset = round2(items.reduce((s, i) => s + i.appliedToStcg + i.appliedToLtcg, 0));
  const taxSaved = round2(items.reduce((s, i) => s + i.taxSaved, 0));
  return {
    items,
    lossBooked,
    gainsOffset,
    taxBefore: round2(taxBefore),
    taxAfter: round2(Math.max(0, taxBefore - taxSaved)),
    taxSaved,
    carryForwardCreated: round2(Math.max(0, lossBooked - gainsOffset)),
    fundTermAssumed: items.some((i) => i.kind === "fund"),
  };
}

/**
 * Compute the full tax picture for a target FY (defaults to the FY containing
 * `asOf`). FIFO-matches sells against buys, dating each matched chunk so we can
 * classify STCG vs LTCG, then values still-open lots at live prices.
 */
export async function computeTax(
  transactions: Transaction[],
  fy?: string,
  asOf: Date = new Date(),
  funds: FundHolding[] = [],
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
      arr.push({ qty: t.quantity, price: perShare, date: t.tradedAt, isin: t.isin ?? null });
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
          isin: lot.isin ?? t.isin ?? null,
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

  // ---- Realized gains per FY + loss set-off / carry-forward ---------------
  // Net each head per FY (within-head set-off), then run the chronological
  // cross-head + brought-forward set-off engine through the target FY.
  const perFy = new Map<string, FyGains>();
  for (const d of disposals) {
    const dfy = fyOf(new Date(d.sellDate));
    const g = perFy.get(dfy) ?? { stcgGross: 0, ltcgGross: 0 };
    if (d.term === "STCG") g.stcgGross += d.gain;
    else g.ltcgGross += d.gain;
    perFy.set(dfy, g);
  }

  const fyDisposals = disposals.filter((d) => {
    const sd = new Date(d.sellDate);
    return sd >= start && sd <= end;
  });
  const gross = perFy.get(targetFy) ?? { stcgGross: 0, ltcgGross: 0 };
  const stcgGain = gross.stcgGross;
  const ltcgGain = gross.ltcgGross;

  const { setOff, netStcg, netLtcg, carryForward } = runSetOff(perFy, targetFy);

  // The ₹1.25L exemption applies to taxable LTCG after loss set-off.
  const ltcgUsed = Math.min(Math.max(netLtcg, 0), TAX_RULES.ltcgExemption);
  const ltcgRemaining = Math.max(0, TAX_RULES.ltcgExemption - ltcgUsed);
  const stcgTax = Math.max(0, netStcg) * TAX_RULES.stcgRate;
  const ltcgTax = Math.max(0, netLtcg - TAX_RULES.ltcgExemption) * TAX_RULES.ltcgRate;

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

  // ---- Equity mutual-fund losers ------------------------------------------
  // Equity MFs are STT-paid and follow the same STCG/LTCG rules as stocks, so
  // their unrealized losses are harvestable too. We don't store per-lot buy
  // dates for funds, so the holding period is unknown — we assume long-term
  // (the conservative choice: LTCL offsets only LTCG, never overstating relief).
  let fundTermAssumed = false;
  const fundLosers: HarvestCandidate[] = [];
  if (funds.length > 0) {
    const fm = await computeFundMetrics(funds);
    for (const f of fm.funds) {
      const isEquity = f.category ? /equity/i.test(f.category) : false;
      if (!isEquity || f.pnl === null || f.pnl >= 0) continue;
      const loss = -f.pnl;
      fundTermAssumed = true;
      fundLosers.push({
        symbol: f.schemeName,
        exchange: "MF",
        quantity: f.units,
        amount: round2(loss),
        term: "LTCG",
        estTaxImpact: round2(loss * TAX_RULES.ltcgRate),
        kind: "fund",
      });
    }
  }

  // ---- Harvesting levers --------------------------------------------------
  // 1. Tax-loss harvesting: open positions sitting in a loss. Booking the loss
  //    offsets realized gains — short-term losses can offset both STCG & LTCG
  //    (so we value them at the higher STCG rate), long-term losses only LTCG.
  const stockLossCandidates: HarvestCandidate[] = taxLots
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
        kind: "stock" as const,
      };
    });
  const lossCandidates: HarvestCandidate[] = [...stockLossCandidates, ...fundLosers].sort(
    (a, b) => b.amount - a.amount,
  );
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

  // Year-end harvest plan + deadline. The plan only makes sense for the FY you
  // can still act in (you can't harvest a closed year), so it's null otherwise.
  const isCurrentFy = targetFy === fyOf(asOf);
  const fyEndDate = end; // 31 Mar of the target FY
  const deadline = {
    fyEnd: fyEndDate.toISOString().slice(0, 10),
    daysLeft: Math.max(0, daysBetween(asOf, fyEndDate)),
    isCurrentFy,
  };
  const plan = isCurrentFy ? buildHarvestPlan(lossCandidates, netStcg, netLtcg, stcgTax + ltcgTax) : null;

  const warnings: string[] = [];
  if (unmatchedSellQty > 1e-9) {
    warnings.push(
      `${Math.round(unmatchedSellQty)} sold unit(s) had no matching buy in your data ` +
        "(holdings likely predate the imported trades) and are excluded from realized gains. " +
        "Import earlier trades for a complete picture.",
    );
  }

  if (setOff.totalSetOff > 0) {
    warnings.push(
      `₹${Math.round(setOff.totalSetOff).toLocaleString("en-IN")} of capital losses were set off this year ` +
        "(short-term losses against both STCG & LTCG, long-term losses against LTCG only), reducing the tax shown.",
    );
  }
  if (carryForward.stcl + carryForward.ltcl > 0) {
    warnings.push(
      `₹${Math.round(carryForward.stcl + carryForward.ltcl).toLocaleString("en-IN")} of unabsorbed losses carry ` +
        `forward to future years (file your ITR on time to preserve them; they lapse after 8 years).`,
    );
  }

  // Stable option set: every FY with realized disposals plus the current FY,
  // independent of which FY is selected — so switching the FY doesn't drop the
  // current (or any) option from the dropdown.
  const availableFys = [...new Set([fyOf(asOf), ...fySet, targetFy])].sort().reverse();

  return {
    fy: targetFy,
    availableFys,
    realized: {
      stcgGain: round2(stcgGain),
      ltcgGain: round2(ltcgGain),
      netStcg: round2(netStcg),
      netLtcg: round2(netLtcg),
      setOff,
      stcgTax: round2(stcgTax),
      ltcgTax: round2(ltcgTax),
      totalTax: round2(stcgTax + ltcgTax),
      disposals: fyDisposals.sort((a, b) => (a.sellDate < b.sellDate ? 1 : -1)),
    },
    carryForward,
    ltcgAllowance: { exemption: TAX_RULES.ltcgExemption, used: round2(ltcgUsed), remaining: round2(ltcgRemaining) },
    unrealized: { stcgGain: round2(uStcg), ltcgGain: round2(uLtcg), lots: taxLots },
    harvest: {
      lossCandidates,
      totalHarvestableLoss,
      estLossTaxSaved,
      ltcgFreeCandidates,
      countdown,
      plan,
    },
    deadline,
    rules: TAX_RULES,
    warnings,
    asOf: asOf.toISOString(),
  };
}
