import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeMetrics } from "@/lib/metrics";
import { generateInsights, getLatestInsight, InsightError } from "@/lib/insights";
import { rateLimit, llmQueue } from "@/lib/rate-limit";
import { logError } from "@/lib/log";

// Insight generation calls Claude and can take a couple of minutes
export const maxDuration = 300;

// Per-user generation cap (overridable). Guards LLM quota/cost against abuse.
const GEN_LIMIT = Math.max(1, Number(process.env.INSIGHTS_RATE_LIMIT) || 8);
const GEN_WINDOW_MS = 60_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const insight = await getLatestInsight(user.portfolioId);
  return NextResponse.json({ insight });
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const limited = rateLimit(`insights:${user.id}`, GEN_LIMIT, GEN_WINDOW_MS);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many insight generations. Please wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const force = Boolean(body?.force);

  const holdings = await prisma.holding.findMany({ where: { portfolioId: user.portfolioId } });
  if (holdings.length === 0) {
    return NextResponse.json(
      { error: "No holdings yet — import a portfolio first." },
      { status: 422 },
    );
  }

  try {
    const metrics = await computeMetrics(holdings);
    // Bound concurrent LLM calls process-wide so bursts queue rather than pile up.
    const insight = await llmQueue.run(() =>
      generateInsights(user.portfolioId!, metrics, { force }),
    );
    return NextResponse.json({ insight });
  } catch (err) {
    if (err instanceof InsightError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    logError("insights", err, { userId: user.id });
    return NextResponse.json(
      { error: "Insight generation failed. Check the server logs and your ANTHROPIC_API_KEY." },
      { status: 500 },
    );
  }
}
