import type { FundHolding } from "@prisma/client";
import { computeFundMetrics } from "./funds";

/**
 * Mutual-fund fee (expense-ratio) leakage. Totals the annual TER drag across the
 * user's funds and flags Regular-plan holdings where the identical Direct plan
 * would cost ~1% less a year — the cross-fund "what are fees costing me" view a
 * single AMC/broker won't volunteer.
 *
 * There's no free API for exact Indian TERs, so we estimate by category + plan.
 * These are clearly-labelled ESTIMATES; the Regular→Direct *gap* (the actionable
 * number) is far more stable than the absolute TER. Always check the scheme's
 * SID/factsheet for the exact figure.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export type Plan = "Direct" | "Regular";
type Category = "index" | "equity" | "hybrid" | "debt";

// Typical TER bands (% per year) by category and plan. Regular carries the
// distributor commission; Direct doesn't.
const TER: Record<Category, { Direct: number; Regular: number }> = {
  index: { Direct: 0.2, Regular: 0.5 },
  equity: { Direct: 0.9, Regular: 1.75 },
  hybrid: { Direct: 0.8, Regular: 1.5 },
  debt: { Direct: 0.4, Regular: 0.9 },
};
const PROJECTION_YEARS = 10;

function detectPlan(name: string): Plan {
  return /\bdirect\b/i.test(name) ? "Direct" : "Regular";
}

function categoryOf(category: string | null, name: string): Category {
  const s = `${category ?? ""} ${name}`.toLowerCase();
  if (/index|\betf\b|nifty|sensex/.test(s)) return "index";
  if (/debt|liquid|bond|gilt|money market|overnight|duration|credit|banking and psu/.test(s)) return "debt";
  if (/hybrid|balanced|asset alloc|arbitrage|multi.?asset/.test(s)) return "hybrid";
  return "equity";
}

export interface FeeFund {
  schemeName: string;
  plan: Plan;
  category: Category;
  base: number; // value the fee is charged on — live value, or invested if NAV unresolved
  liveValued: boolean; // false when we fell back to invested (NAV didn't resolve)
  terPct: number; // estimated expense ratio for this plan
  annualFee: number; // base × terPct
  directTerPct: number; // estimated TER of the Direct plan (same category)
  annualSaving: number; // fee saved per year by switching to Direct (0 if already Direct)
  projectedSaving: number; // annualSaving over PROJECTION_YEARS (simple, value-constant)
}

export interface FeeSummary {
  totalValue: number;
  totalAnnualFee: number;
  weightedTerPct: number; // value-weighted average TER
  regularCount: number;
  switchableAnnualSaving: number; // total/yr from moving Regular → Direct
  switchableProjectedSaving: number; // over PROJECTION_YEARS
  projectionYears: number;
  funds: FeeFund[]; // by annual fee desc
  pricedCount: number; // funds with a resolved value
  asOf: string;
}

export async function computeFees(holdings: FundHolding[]): Promise<FeeSummary> {
  const fm = await computeFundMetrics(holdings);

  const funds: FeeFund[] = fm.funds.map((f) => {
    const plan = detectPlan(f.schemeName);
    const category = categoryOf(f.category, f.schemeName);
    const terPct = TER[category][plan];
    const directTerPct = TER[category].Direct;
    // Fee is charged on assets — use live value, falling back to invested so a
    // failed NAV lookup doesn't silently drop a fund from the totals.
    const base = f.value ?? f.invested;
    const annualFee = round2((base * terPct) / 100);
    const annualSaving = plan === "Regular" ? round2((base * (terPct - directTerPct)) / 100) : 0;
    return {
      schemeName: f.schemeName,
      plan,
      category,
      base: round2(base),
      liveValued: f.value !== null,
      terPct,
      annualFee,
      directTerPct,
      annualSaving,
      projectedSaving: round2(annualSaving * PROJECTION_YEARS),
    };
  });
  funds.sort((a, b) => b.annualFee - a.annualFee);

  const totalValue = round2(funds.reduce((s, f) => s + f.base, 0));
  const totalAnnualFee = round2(funds.reduce((s, f) => s + f.annualFee, 0));
  const switchableAnnualSaving = round2(funds.reduce((s, f) => s + f.annualSaving, 0));

  return {
    totalValue,
    totalAnnualFee,
    weightedTerPct: totalValue > 0 ? round2((totalAnnualFee / totalValue) * 100) : 0,
    regularCount: funds.filter((f) => f.plan === "Regular").length,
    switchableAnnualSaving,
    switchableProjectedSaving: round2(switchableAnnualSaving * PROJECTION_YEARS),
    projectionYears: PROJECTION_YEARS,
    funds,
    pricedCount: funds.filter((f) => f.liveValued).length,
    asOf: new Date().toISOString(),
  };
}
