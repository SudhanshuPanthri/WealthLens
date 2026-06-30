import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomInt } from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { sendPasswordResetCode } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";

const Schema = z.object({ email: z.string().email().max(254) });
const CODE_TTL_MS = 10 * 60 * 1000;

/** Step 1: email a 6-digit reset code. Always returns ok so the response can't
 *  be used to enumerate which emails have accounts. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const byEmail = rateLimit(`pwreset:email:${email}`, 3, 15 * 60 * 1000);
  const byIp = rateLimit(`pwreset:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!byEmail.ok || !byIp.ok) {
    return NextResponse.json({ error: "Too many requests. Try again in a few minutes." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    // Invalidate any prior unconsumed codes for this email, then issue a fresh one.
    await prisma.passwordReset.deleteMany({ where: { email, consumedAt: null } });
    await prisma.passwordReset.create({
      data: { email, codeHash: await hashPassword(code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    });
    try {
      await sendPasswordResetCode(email, code);
    } catch (err) {
      console.error("Password-reset email failed:", err);
    }
  }

  return NextResponse.json({ ok: true });
}
