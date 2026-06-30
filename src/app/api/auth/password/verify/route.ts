import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";

const Schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});
const MAX_ATTEMPTS = 5;

/** Step 2: check the code. On success, issue a short-lived token the reset step
 *  exchanges for the password change (so the code is never re-sent). */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const reset = await prisma.passwordReset.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!reset || reset.expiresAt < new Date()) {
    return NextResponse.json({ error: "Code expired. Request a new one." }, { status: 400 });
  }
  if (reset.attempts >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }

  const ok = await verifyPassword(parsed.data.code, reset.codeHash);
  if (!ok) {
    await prisma.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code." }, { status: 400 });
  }

  const token = randomBytes(32).toString("hex");
  await prisma.passwordReset.update({ where: { id: reset.id }, data: { token } });
  return NextResponse.json({ ok: true, token });
}
