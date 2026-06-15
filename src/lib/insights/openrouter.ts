import { InsightSchema, SYSTEM_PROMPT, buildSnapshot, clampScore, InsightError, type InsightPayload } from "./schema";
import type { PortfolioMetrics } from "../metrics";

// Free model by default; override with OPENROUTER_MODEL. OpenRouter's free
// model lineup rotates, so make it configurable rather than hardcoded.
const DEFAULT_MODEL = "openai/gpt-oss-120b:free";

const JSON_SHAPE = `Return ONLY a JSON object (no markdown, no prose, no code fences) matching exactly:
{
  "healthScore": number (0-100),
  "headline": string,
  "summary": string (2-3 paragraphs),
  "strengths": string[] (2-5),
  "risks": [{ "severity": "low"|"medium"|"high", "title": string, "detail": string }] (most severe first),
  "redFlags": string[] (empty if none),
  "diversification": { "verdict": string, "detail": string },
  "suggestions": [{ "title": string, "rationale": string, "action": string }] (3-6, prioritized)
}`;

/**
 * Generate insights via OpenRouter (OpenAI-compatible chat completions). Works
 * with OpenRouter's free model tier. Validates against InsightSchema, retries once.
 */
export async function openRouterInsights(
  metrics: PortfolioMetrics,
): Promise<{ payload: InsightPayload; model: string }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new InsightError("OPENROUTER_API_KEY is not set.");
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

  const body = {
    model,
    messages: [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${JSON_SHAPE}` },
      { role: "user", content: `Portfolio snapshot:\n${JSON.stringify(buildSnapshot(metrics))}` },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 4096,
  };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Optional attribution headers OpenRouter recommends:
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "WealthLens",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      lastErr = `OpenRouter API error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`;
      continue;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = InsightSchema.safeParse(extractJson(text));
    if (parsed.success) return { payload: clampScore(parsed.data), model };
    lastErr = `OpenRouter returned an unexpected shape: ${parsed.error.issues[0]?.message ?? "parse error"}`;
  }
  throw new InsightError(lastErr || "OpenRouter insight generation failed.");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}
