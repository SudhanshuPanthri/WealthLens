import { prisma } from "../db";
import type { PortfolioMetrics } from "../metrics";
import {
  InsightSchema,
  snapshotHash,
  InsightError,
  type StoredInsight,
  type InsightEngine,
  type InsightPayload,
} from "./schema";
import { ruleBasedInsights } from "./rules";
import { geminiInsights } from "./gemini";
import { openRouterInsights } from "./openrouter";
import { claudeInsights } from "./claude";

export {
  InsightSchema,
  InsightError,
  type StoredInsight,
  type InsightPayload,
  type InsightEngine,
} from "./schema";

/** Highest-quality engine whose credentials are present. Rule-based is always available. */
export function activeEngine(): InsightEngine {
  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "rule-based";
}

async function runEngine(
  engine: InsightEngine,
  metrics: PortfolioMetrics,
): Promise<{ payload: InsightPayload; model: string; engine: InsightEngine }> {
  if (engine === "claude") {
    const { payload, model } = await claudeInsights(metrics);
    return { payload, model, engine };
  }
  if (engine === "openrouter") {
    const { payload, model } = await openRouterInsights(metrics);
    return { payload, model, engine };
  }
  if (engine === "gemini") {
    const { payload, model } = await geminiInsights(metrics);
    return { payload, model, engine };
  }
  return { payload: ruleBasedInsights(metrics), model: "rule-based-v1", engine: "rule-based" };
}

/**
 * Generate (or return cached) insights for a portfolio, using the best engine
 * available. Cache key is the position snapshot — re-importing identical
 * holdings reuses the insight. `force` regenerates.
 *
 * If an LLM engine fails (e.g. quota, network), we fall back to the rule-based
 * engine rather than erroring, so the user always gets an analysis.
 */
export async function generateInsights(
  portfolioId: string,
  metrics: PortfolioMetrics,
  options: { force?: boolean } = {},
): Promise<StoredInsight> {
  const hash = snapshotHash(metrics);

  if (!options.force) {
    const existing = await prisma.insight.findFirst({
      where: { portfolioId, snapshotHash: hash },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return deserialize(existing);
  }

  const engine = activeEngine();
  let result: { payload: InsightPayload; model: string; engine: InsightEngine };
  let note: string | undefined;
  try {
    result = await runEngine(engine, metrics);
  } catch (err) {
    if (engine === "rule-based") throw err;
    // LLM failed — degrade gracefully to the keyless engine, but record why so
    // the user isn't left wondering why they got rule-based with a key set.
    const reason = summarizeError(err);
    const label = { claude: "Claude", openrouter: "OpenRouter", gemini: "Gemini", "rule-based": "" }[engine];
    console.error(`Insight engine "${engine}" failed, falling back to rule-based: ${reason}`);
    note = `${label} couldn't be reached (${reason}), so this analysis used the built-in rule-based engine.`;
    result = await runEngine("rule-based", metrics);
  }

  const stored = await prisma.insight.create({
    data: {
      portfolioId,
      snapshotHash: hash,
      model: result.model,
      engine: result.engine,
      content: JSON.stringify(result.payload),
    },
  });
  return {
    id: stored.id,
    createdAt: stored.createdAt.toISOString(),
    model: stored.model,
    engine: stored.engine as InsightEngine,
    payload: result.payload,
    note,
  };
}

function summarizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // pull out a short, human-friendly reason
  if (/quota|prepayment|credits|429/i.test(msg)) return "quota or credits exhausted";
  if (/401|invalid.*key|authentication/i.test(msg)) return "invalid API key";
  if (/timeout|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(msg)) return "network error";
  return msg.slice(0, 80);
}

export async function getLatestInsight(portfolioId: string): Promise<StoredInsight | null> {
  const row = await prisma.insight.findFirst({
    where: { portfolioId },
    orderBy: { createdAt: "desc" },
  });
  return row ? safeDeserialize(row) : null;
}

type InsightRow = { id: string; createdAt: Date; model: string; engine: string; content: string };

function deserialize(row: InsightRow): StoredInsight {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    model: row.model,
    engine: (row.engine as InsightEngine) ?? "rule-based",
    payload: InsightSchema.parse(JSON.parse(row.content)),
  };
}

function safeDeserialize(row: InsightRow): StoredInsight | null {
  try {
    return deserialize(row);
  } catch {
    return null;
  }
}
