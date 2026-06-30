import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { computeTax } from "@/lib/tax";
import { sendHarvestReminder } from "@/lib/email";

export const maxDuration = 60;

// Minimum estimated saving (₹) and days-to-deadline window for sending a nudge.
const MIN_TAX_SAVED = 1000;
const WINDOW_DAYS = 90;

/**
 * Emails opted-in users a tax-loss-harvesting reminder when they have a
 * worthwhile, time-sensitive opportunity. Meant to run daily in Jan–Mar; it's
 * self-guarding (only sends within WINDOW_DAYS of the 31-Mar deadline and above
 * MIN_TAX_SAVED), so running it year-round is harmless. Protected by CRON_SECRET
 * via `Authorization: Bearer <secret>` or `?secret=`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
    }
  } else {
    const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const provided = header ?? req.nextUrl.searchParams.get("secret");
    if (provided !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const users = await prisma.user.findMany({
    where: { harvestReminderOptIn: true },
    include: { portfolios: { orderBy: { createdAt: "asc" }, take: 1 } },
  });

  let sent = 0;
  let skipped = 0;
  for (const user of users) {
    const portfolioId = user.portfolios[0]?.id;
    if (!portfolioId) {
      skipped++;
      continue;
    }
    try {
      const [transactions, funds] = await Promise.all([
        prisma.transaction.findMany({ where: { portfolioId }, orderBy: { tradedAt: "asc" } }),
        prisma.fundHolding.findMany({ where: { portfolioId } }),
      ]);
      const summary = await computeTax(transactions, undefined, undefined, funds);
      const plan = summary.harvest.plan;
      const worthwhile =
        plan && plan.taxSaved >= MIN_TAX_SAVED && summary.deadline.daysLeft <= WINDOW_DAYS;
      if (!worthwhile) {
        skipped++;
        continue;
      }
      await sendHarvestReminder(user.email, {
        taxSaved: plan.taxSaved,
        daysLeft: summary.deadline.daysLeft,
        fyEnd: summary.deadline.fyEnd,
        appUrl,
      });
      sent++;
    } catch (err) {
      console.error(`Harvest reminder failed for ${user.email}:`, err);
      skipped++;
    }
  }

  return NextResponse.json({ ok: true, candidates: users.length, sent, skipped, at: new Date().toISOString() });
}
