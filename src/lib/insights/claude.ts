import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { InsightSchema, SYSTEM_PROMPT, buildSnapshot, clampScore, InsightError, type InsightPayload } from "./schema";
import type { PortfolioMetrics } from "../metrics";

const MODEL = "claude-opus-4-8";

/** Generate insights via Claude with structured (schema-validated) output. */
export async function claudeInsights(metrics: PortfolioMetrics): Promise<{ payload: InsightPayload; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new InsightError("ANTHROPIC_API_KEY is not set.");

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze this portfolio snapshot:\n\n${JSON.stringify(buildSnapshot(metrics))}`,
      },
    ],
    output_config: { format: zodOutputFormat(InsightSchema) },
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    throw new InsightError("The model could not produce an analysis for this portfolio. Please try again.");
  }
  return { payload: clampScore(response.parsed_output), model: MODEL };
}
