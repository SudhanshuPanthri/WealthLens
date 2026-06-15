import { InsightSchema, SYSTEM_PROMPT, buildSnapshot, clampScore, InsightError, type InsightPayload } from "./schema";
import type { PortfolioMetrics } from "../metrics";

const MODEL = "gemini-2.5-flash";

// Describes the exact JSON the model must return. Kept in sync with InsightSchema.
const JSON_SHAPE = `Return ONLY a JSON object (no markdown, no prose) matching exactly:
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
 * Generate insights via Google's Gemini API (free tier friendly). Uses JSON
 * response mode and validates the result against InsightSchema, retrying once.
 */
export async function geminiInsights(metrics: PortfolioMetrics): Promise<{ payload: InsightPayload; model: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new InsightError("GEMINI_API_KEY is not set.");

  const prompt = `${SYSTEM_PROMPT}\n\n${JSON_SHAPE}\n\nPortfolio snapshot:\n${JSON.stringify(buildSnapshot(metrics))}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 8192 },
  };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      lastErr = `Gemini API error ${res.status}: ${await res.text().catch(() => "")}`;
      continue;
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = InsightSchema.safeParse(extractJson(text));
    if (parsed.success) {
      return { payload: clampScore(parsed.data), model: MODEL };
    }
    lastErr = `Gemini returned an unexpected shape: ${parsed.error.issues[0]?.message ?? "parse error"}`;
  }
  throw new InsightError(lastErr || "Gemini insight generation failed.");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // best-effort: grab the outermost {...}
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
