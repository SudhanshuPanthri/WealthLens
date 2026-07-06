import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./db";
import { computeMetrics } from "./metrics";
import { computeFundMetrics } from "./funds";
import { buildSnapshot } from "./insights/schema";

/**
 * Portfolio Q&A chat. Reuses the insights engine ladder minus the rule-based
 * engine (a deterministic scorer can't hold a conversation): Claude when
 * ANTHROPIC_API_KEY is set, else OpenRouter (free models), else Gemini.
 * Claude streams; the other two return the full reply in one chunk.
 */

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}
export type ChatEngine = "claude" | "openrouter" | "gemini";

export class ChatError extends Error {}

/** Engines usable for chat, best first. Empty when no LLM key is configured. */
export function chatEngines(): ChatEngine[] {
  const ladder: ChatEngine[] = [];
  if (process.env.ANTHROPIC_API_KEY) ladder.push("claude");
  if (process.env.OPENROUTER_API_KEY) ladder.push("openrouter");
  if (process.env.GEMINI_API_KEY) ladder.push("gemini");
  return ladder;
}

const CHAT_SYSTEM_PROMPT = `You are the portfolio assistant of WealthLens, a portfolio analytics product for Indian retail investors (NSE/BSE stocks and mutual funds). You answer the investor's questions about their own portfolio, using the JSON snapshot provided in <portfolio_context>.

Ground every claim in the snapshot — quote actual weights, P&L percentages, sector exposures, and concentration figures. Never invent holdings, prices, or numbers that are not in the data. If the snapshot lacks what a question needs (e.g. transaction history, fund constituents), say so plainly and point to the relevant WealthLens page (Transactions, Tax, Analytics, Dividends, Fees) instead of guessing.

When asked what to invest in or how to improve the portfolio, respond educationally: identify gaps the data shows (concentration, missing sectors, cap-tier tilt, equity/debt mix) and describe categories of options the investor could evaluate — never specific buy/sell orders, target prices, or timing calls. Apply Indian-market context: single-stock weight above ~10% and top-5 above ~50% deserve scrutiny, LTCG/STCG rules differ, index funds and Direct mutual-fund plans are low-cost defaults worth mentioning where relevant.

Style: plain conversational text — no markdown headings, asterisks, or tables; short paragraphs or simple hyphen lists. Be concise and direct; lead with the answer. Amounts are INR. End answers that lean toward recommendations with a one-line reminder that this is analysis, not investment advice from a SEBI-registered advisor.`;

const r = (n: number | null, d = 2) => (n === null ? null : Number(n.toFixed(d)));

/**
 * Assemble the model-facing view of the user's portfolio: the same rounded
 * stock snapshot the insights engines use, plus a lean mutual-fund summary.
 * Quote/NAV lookups are cache-first, so this is cheap on a warm server.
 */
export async function buildChatContext(portfolioId: string): Promise<string> {
  const [holdings, fundRows] = await Promise.all([
    prisma.holding.findMany({ where: { portfolioId } }),
    prisma.fundHolding.findMany({ where: { portfolioId } }),
  ]);

  const parts: string[] = [];
  if (holdings.length > 0) {
    const metrics = await computeMetrics(holdings);
    parts.push(`Stock holdings (live-priced):\n${JSON.stringify(buildSnapshot(metrics))}`);
  }
  if (fundRows.length > 0) {
    const fm = await computeFundMetrics(fundRows);
    const funds = {
      totals: {
        investedINR: r(fm.totals.invested, 0),
        currentValueINR: r(fm.totals.currentValue, 0),
        pnlINR: r(fm.totals.pnl, 0),
        pnlPct: r(fm.totals.pnlPct),
        fundCount: fm.totals.count,
      },
      amcAllocation: fm.amcAllocation.map((a) => ({ amc: a.label, pct: r(a.pct) })),
      funds: fm.funds.map((f) => ({
        scheme: f.schemeName,
        amc: f.amc,
        category: f.category,
        investedINR: r(f.invested, 0),
        currentValueINR: r(f.value, 0),
        pnlPct: r(f.pnlPct),
        weightPct: r(f.weightPct),
      })),
    };
    parts.push(`Mutual fund holdings (live NAV):\n${JSON.stringify(funds)}`);
  }
  if (parts.length === 0) {
    return "The user has not imported any holdings yet. Suggest importing a broker CSV/XLSX or a CAS PDF on the Import page; general questions can still be answered educationally.";
  }
  return parts.join("\n\n");
}

function systemWithContext(context: string): string {
  return `${CHAT_SYSTEM_PROMPT}\n\n<portfolio_context>\n${context}\n</portfolio_context>`;
}

/** A per-request timeout, aborted early if the caller's signal fires (client disconnect). */
function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

// ---- Claude (streaming) ----------------------------------------------------

const CLAUDE_MODEL = "claude-opus-4-8";

export async function* claudeChatStream(
  context: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const client = new Anthropic();
  const stream = client.messages.stream(
    {
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      // Chat is interactive — "medium" keeps adaptive thinking shallow enough to
      // start streaming quickly. Raise via env for deeper analysis.
      output_config: {
        effort: (process.env.CHAT_CLAUDE_EFFORT as "low" | "medium" | "high" | "max") || "medium",
      },
      system: systemWithContext(context),
      messages,
    },
    // Aborting stops server-side generation when the client disconnects/cancels.
    { signal },
  );

  let sawText = false;
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      sawText = true;
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (!sawText && final.stop_reason === "refusal") {
    throw new ChatError("The model declined to answer that question.");
  }
}

// ---- OpenRouter (single chunk) ----------------------------------------------

// Chat is interactive, so the free default is the low-latency MoE (gpt-oss-20b,
// ~3.6B active params) rather than the larger gpt-oss-120b the batch insights
// engine uses. The free lineup rotates and per-model availability changes
// without notice, so keep it configurable — OPENROUTER_CHAT_MODEL overrides just
// chat, OPENROUTER_MODEL overrides both chat and insights. Other strong free
// picks to try: meta-llama/llama-3.3-70b-instruct:free (fast on LPU hardware),
// nvidia/nemotron-3-super-120b-a12b:free (1M ctx, agentic reasoning),
// qwen/qwen3-next-80b-a3b-instruct:free. Verify the :free ID is live first.
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-oss-20b:free";

function openRouterModel(): string {
  return process.env.OPENROUTER_CHAT_MODEL || process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL;
}

export async function openRouterChat(
  context: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new ChatError("OPENROUTER_API_KEY is not set.");
  const model = openRouterModel();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
      "X-Title": "WealthLens",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemWithContext(context) }, ...messages],
      temperature: 0.5,
      max_tokens: 2048,
    }),
    signal: withTimeout(60000, signal),
  });
  if (!res.ok) {
    throw new ChatError(
      `OpenRouter API error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`,
    );
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ChatError("OpenRouter returned an empty reply.");
  return text;
}

// ---- Gemini (single chunk) ---------------------------------------------------

const GEMINI_MODEL = "gemini-2.5-flash";

export async function geminiChat(
  context: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ChatError("GEMINI_API_KEY is not set.");

  const body = {
    systemInstruction: { parts: [{ text: systemWithContext(context) }] },
    contents: messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 4096,
      // Same speedup as the insights engine: chat needs latency, not deep thinking.
      thinkingConfig: { thinkingBudget: Number(process.env.GEMINI_THINKING) || 0 },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: withTimeout(45000, signal),
    },
  );
  if (!res.ok) {
    throw new ChatError(`Gemini API error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ChatError("Gemini returned an empty reply.");
  return text;
}

/** Model label shown next to the engine badge in the UI. */
export function chatModelLabel(engine: ChatEngine): string {
  if (engine === "claude") return CLAUDE_MODEL;
  if (engine === "openrouter") return openRouterModel();
  return GEMINI_MODEL;
}
