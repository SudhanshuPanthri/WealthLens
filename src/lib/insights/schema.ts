import { z } from "zod";
import { createHash } from "crypto";
import type { PortfolioMetrics } from "../metrics";

export const InsightSchema = z.object({
  healthScore: z.number().describe("Overall portfolio health, 0-100. Be discriminating: 50 is average."),
  headline: z.string().describe("One punchy sentence summarizing the portfolio's state."),
  summary: z.string().describe("2-3 paragraph plain-language assessment of the portfolio."),
  strengths: z.array(z.string()).describe("What this portfolio gets right. 2-5 items."),
  risks: z
    .array(
      z.object({
        severity: z.enum(["low", "medium", "high"]),
        title: z.string(),
        detail: z.string().describe("Why this is a risk and what could go wrong, with numbers from the data."),
      }),
    )
    .describe("Concrete risks, ordered most severe first."),
  redFlags: z
    .array(z.string())
    .describe("Urgent, specific problems needing attention now. Empty array if none."),
  diversification: z.object({
    verdict: z.string().describe("One-line verdict on diversification quality."),
    detail: z.string().describe("Sector/stock concentration analysis with the actual numbers."),
  }),
  suggestions: z
    .array(
      z.object({
        title: z.string(),
        rationale: z.string().describe("Why, grounded in this portfolio's data."),
        action: z.string().describe("The concrete step the investor could evaluate."),
      }),
    )
    .describe("3-6 actionable, prioritized ideas to improve the portfolio."),
});

export type InsightPayload = z.infer<typeof InsightSchema>;

export type InsightEngine = "rule-based" | "openrouter" | "gemini" | "claude";

export interface StoredInsight {
  id: string;
  createdAt: string;
  model: string;
  engine: InsightEngine;
  payload: InsightPayload;
  // Set at runtime (not persisted) when the preferred engine failed and we fell
  // back — so the UI can explain why a lesser engine produced this analysis.
  note?: string;
}

export const SYSTEM_PROMPT = `You are the analysis engine of WealthLens, a portfolio analytics product for Indian retail equity investors (NSE/BSE). You receive a JSON snapshot of one investor's holdings with computed metrics, and you produce a structured, rigorous portfolio review.

Ground every claim in the numbers provided — quote weights, P&L percentages, sector exposures, and concentration figures rather than speaking in generalities. Apply sound portfolio-construction principles for Indian markets: single-stock concentration above ~10% and top-5 concentration above ~50% deserve scrutiny; a Herfindahl index above ~1500 indicates meaningful concentration; sector exposure above ~30% in one sector is a risk worth naming; deep drawdowns from 52-week highs and extreme P/E ratios are worth flagging on a per-stock basis. Consider market-cap mix where data allows. "Unclassified" sector entries mean sector data was unavailable — do not treat them as a real sector.

Be direct and discriminating: a concentrated, loss-making portfolio should score visibly lower than a balanced, profitable one. Do not pad. Never recommend specific buy/sell orders as advice — frame suggestions as options the investor could evaluate, and never invent holdings or numbers not present in the data.`;

/** Strip metrics down to what a model needs (and round noise away). */
export function buildSnapshot(metrics: PortfolioMetrics) {
  const r = (n: number | null, d = 2) => (n === null ? null : Number(n.toFixed(d)));
  return {
    totals: {
      investedINR: r(metrics.totals.invested, 0),
      currentValueINR: r(metrics.totals.currentValue, 0),
      pnlINR: r(metrics.totals.pnl, 0),
      pnlPct: r(metrics.totals.pnlPct),
      holdingsCount: metrics.totals.holdingsCount,
    },
    concentration: {
      top1Pct: r(metrics.concentration.top1Pct),
      top3Pct: r(metrics.concentration.top3Pct),
      top5Pct: r(metrics.concentration.top5Pct),
      herfindahlIndex: metrics.concentration.hhi,
    },
    sectorAllocation: metrics.sectorAllocation.map((s) => ({ sector: s.label, pct: r(s.pct) })),
    brokerAllocation: metrics.brokerAllocation.map((b) => ({ broker: b.label, pct: r(b.pct) })),
    holdings: metrics.holdings.map((h) => ({
      symbol: h.symbol,
      name: h.name,
      sector: h.sector,
      weightPct: r(h.weightPct),
      investedINR: r(h.invested, 0),
      pnlPct: r(h.pnlPct),
      pctFrom52WeekHigh: r(h.pctFrom52High),
      trailingPE: r(h.trailingPE, 1),
      marketCapINR: h.marketCap,
      broker: h.broker,
    })),
  };
}

export function snapshotHash(metrics: PortfolioMetrics): string {
  // Hash only position data, not prices — small price moves shouldn't force regeneration
  const positions = metrics.holdings
    .map((h) => `${h.broker}:${h.symbol}:${h.quantity}:${h.avgPrice}`)
    .sort()
    .join("|");
  return createHash("sha256").update(positions).digest("hex");
}

export function clampScore(payload: InsightPayload): InsightPayload {
  payload.healthScore = Math.max(0, Math.min(100, Math.round(payload.healthScore)));
  return payload;
}

export class InsightError extends Error {}
