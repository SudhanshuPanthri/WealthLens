import { NextResponse, type NextRequest } from "next/server";
import { refreshAllQuotes } from "@/lib/refresh";

export const maxDuration = 60;

/**
 * Refresh all quotes on demand — for serverless deploys where there's no
 * long-lived process to run the in-process timer (set BACKGROUND_REFRESH=off
 * there). Point an external scheduler (Vercel Cron, GitHub Actions, cron-job.org)
 * at this with the secret. Protected by CRON_SECRET via either the
 * `Authorization: Bearer <secret>` header or a `?secret=` query param.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Refuse to run unauthenticated in production; allow in local dev.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
    }
  } else {
    const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const provided = header ?? req.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  try {
    const result = await refreshAllQuotes();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (err) {
    console.error("Cron refresh failed:", err);
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
}
