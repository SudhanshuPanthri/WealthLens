import type { PortfolioMetrics } from "../metrics";
import type { InsightPayload } from "./schema";

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

/**
 * Deterministic, keyless insights engine. Produces the same structured payload
 * as the LLM engines using sound portfolio-construction heuristics, so insights
 * always work — even with no API key configured.
 */
export function ruleBasedInsights(metrics: PortfolioMetrics): InsightPayload {
  const { totals, concentration, sectorAllocation, holdings } = metrics;
  const top = holdings[0];
  const topSector = sectorAllocation.find((s) => s.label !== "Unclassified") ?? sectorAllocation[0];

  // --- scoring (start at 100, deduct for problems) ---
  let score = 100;
  if (concentration.top1Pct > 25) score -= 22;
  else if (concentration.top1Pct > 15) score -= 13;
  else if (concentration.top1Pct > 10) score -= 6;

  if (concentration.top5Pct > 70) score -= 18;
  else if (concentration.top5Pct > 55) score -= 10;
  else if (concentration.top5Pct > 45) score -= 4;

  if (concentration.hhi > 2500) score -= 14;
  else if (concentration.hhi > 1500) score -= 7;

  if (topSector && topSector.pct > 45) score -= 14;
  else if (topSector && topSector.pct > 30) score -= 7;

  if (totals.holdingsCount < 5) score -= 12;
  else if (totals.holdingsCount < 8) score -= 5;

  if (totals.pnlPct < -15) score -= 12;
  else if (totals.pnlPct < 0) score -= 5;
  else if (totals.pnlPct > 15) score += 4;

  const deepLosers = holdings.filter((h) => (h.pnlPct ?? 0) < -25);
  score -= Math.min(10, deepLosers.length * 3);
  score = Math.max(0, Math.min(100, Math.round(score)));

  // --- strengths ---
  const strengths: string[] = [];
  if (totals.holdingsCount >= 12)
    strengths.push(`Holds ${totals.holdingsCount} stocks, a reasonable base for diversification.`);
  if (concentration.top1Pct <= 10)
    strengths.push(`No single stock dominates — the largest position is ${fmtPct(concentration.top1Pct)} of the portfolio.`);
  if (sectorAllocation.filter((s) => s.label !== "Unclassified").length >= 5)
    strengths.push(`Exposure spans ${sectorAllocation.filter((s) => s.label !== "Unclassified").length} sectors.`);
  if (totals.pnlPct > 0)
    strengths.push(`Portfolio is in profit overall, up ${fmtPct(totals.pnlPct)} on invested capital.`);
  const winners = holdings.filter((h) => (h.pnlPct ?? 0) > 20).length;
  if (winners > 0) strengths.push(`${winners} holding(s) are up more than 20% from cost.`);
  if (strengths.length === 0) strengths.push("You have a consolidated view of your holdings to build on.");

  // --- risks ---
  const risks: InsightPayload["risks"] = [];
  if (concentration.top1Pct > 15 && top) {
    risks.push({
      severity: concentration.top1Pct > 25 ? "high" : "medium",
      title: `Heavy single-stock concentration in ${top.symbol}`,
      detail: `${top.symbol} alone is ${fmtPct(top.weightPct ?? 0)} of the portfolio. A sharp move in one stock would swing your whole portfolio disproportionately.`,
    });
  }
  if (concentration.top5Pct > 55) {
    risks.push({
      severity: concentration.top5Pct > 70 ? "high" : "medium",
      title: "Top holdings carry most of the portfolio",
      detail: `The top 5 positions make up ${fmtPct(concentration.top5Pct)} of value (Herfindahl index ${concentration.hhi}). Returns are concentrated in a handful of names.`,
    });
  }
  if (topSector && topSector.pct > 30) {
    risks.push({
      severity: topSector.pct > 45 ? "high" : "medium",
      title: `Overweight in ${topSector.label}`,
      detail: `${fmtPct(topSector.pct)} of the portfolio sits in ${topSector.label}. A sector-wide downturn would hit a large share of your capital at once.`,
    });
  }
  if (totals.holdingsCount < 8) {
    risks.push({
      severity: totals.holdingsCount < 5 ? "high" : "low",
      title: "Few holdings",
      detail: `With only ${totals.holdingsCount} stocks, idiosyncratic risk is high — one bad result has an outsized effect.`,
    });
  }
  for (const h of deepLosers.slice(0, 2)) {
    risks.push({
      severity: "low",
      title: `${h.symbol} is deep in the red`,
      detail: `${h.symbol} is down ${fmtPct(h.pnlPct ?? 0)} from your average cost. Worth reviewing whether the original thesis still holds.`,
    });
  }
  if (risks.length === 0)
    risks.push({
      severity: "low",
      title: "No major structural risks detected",
      detail: "Concentration, sector spread, and holding count are within reasonable ranges on the available data.",
    });

  // --- red flags ---
  const redFlags: string[] = [];
  if (concentration.top1Pct > 35 && top)
    redFlags.push(`${top.symbol} is ${fmtPct(top.weightPct ?? 0)} of the portfolio — an extreme single-stock bet.`);
  if (topSector && topSector.pct > 55)
    redFlags.push(`Over half the portfolio (${fmtPct(topSector.pct)}) is in ${topSector.label} alone.`);
  const richlyValued = holdings.filter((h) => (h.trailingPE ?? 0) > 80);
  if (richlyValued.length > 0)
    redFlags.push(`${richlyValued.map((h) => h.symbol).join(", ")} trade at very high P/E (>80) — priced for strong growth.`);

  // --- diversification ---
  const sectorCount = sectorAllocation.filter((s) => s.label !== "Unclassified").length;
  const divVerdict =
    concentration.hhi > 2500 ? "Highly concentrated" : concentration.hhi > 1500 ? "Moderately concentrated" : "Reasonably diversified";
  const diversification = {
    verdict: divVerdict,
    detail: `Across ${totals.holdingsCount} holdings and ${sectorCount} sector(s), the largest position is ${fmtPct(concentration.top1Pct)} and the top 5 are ${fmtPct(concentration.top5Pct)} of value. The Herfindahl index is ${concentration.hhi} (under 1500 = diversified, over 2500 = concentrated).`,
  };

  // --- suggestions ---
  const suggestions: InsightPayload["suggestions"] = [];
  if (concentration.top1Pct > 15 && top)
    suggestions.push({
      title: "Trim your largest position",
      rationale: `${top.symbol} at ${fmtPct(top.weightPct ?? 0)} drives a large share of your risk.`,
      action: `Consider whether reducing ${top.symbol} toward a 10% cap and redeploying into underweight areas fits your plan.`,
    });
  if (topSector && topSector.pct > 30)
    suggestions.push({
      title: `Diversify away from ${topSector.label}`,
      rationale: `Sector exposure of ${fmtPct(topSector.pct)} concentrates macro risk.`,
      action: `Evaluate adding holdings from under-represented sectors to balance the ${topSector.label} tilt.`,
    });
  if (totals.holdingsCount < 8)
    suggestions.push({
      title: "Broaden the holding count",
      rationale: `${totals.holdingsCount} stocks leaves you exposed to single-company surprises.`,
      action: "Consider a low-cost index fund or a few quality names in unrepresented sectors to spread risk.",
    });
  if (deepLosers.length > 0)
    suggestions.push({
      title: "Review your biggest losers",
      rationale: `${deepLosers.map((h) => h.symbol).join(", ")} are down sharply from cost.`,
      action: "Re-check the original investment thesis for each; decide deliberately whether to hold, average, or exit.",
    });
  suggestions.push({
    title: "Set a rebalancing cadence",
    rationale: "Portfolios drift as winners grow; periodic rebalancing keeps concentration in check.",
    action: "Pick a schedule (e.g. quarterly) to review weights against your target allocation.",
  });

  return {
    healthScore: score,
    headline:
      score >= 70
        ? "A broadly healthy portfolio with a few areas to tighten."
        : score >= 45
          ? "A workable portfolio, but concentration and balance need attention."
          : "This portfolio carries significant concentration risk that needs addressing.",
    summary: `Your portfolio holds ${totals.holdingsCount} stocks worth approximately ₹${Math.round(totals.currentValue).toLocaleString("en-IN")}, ${totals.pnlPct >= 0 ? "up" : "down"} ${fmtPct(Math.abs(totals.pnlPct))} on invested capital. ${diversification.verdict} on a Herfindahl basis (${concentration.hhi}), with the largest position at ${fmtPct(concentration.top1Pct)} and ${topSector ? `${topSector.label} the biggest sector at ${fmtPct(topSector.pct)}` : "no dominant sector"}.\n\nThis is a heuristic analysis generated locally. Add a Gemini or Claude API key for a deeper, AI-written review.`,
    strengths: strengths.slice(0, 5),
    risks,
    redFlags,
    diversification,
    suggestions: suggestions.slice(0, 6),
  };
}
