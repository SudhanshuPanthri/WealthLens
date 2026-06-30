import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

const Schema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

/** Step 3: with the verified token, set the new password, consume the reset,
 *  and revoke all existing sessions so the account is re-secured everywhere. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const reset = await prisma.passwordReset.findUnique({ where: { token: parsed.data.token } });
  if (!reset || reset.email !== email || reset.consumedAt || reset.expiresAt < new Date()) {
    return NextResponse.json({ error: "Reset session expired. Start again." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ error: "Account not found." }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.passwordReset.update({ where: { id: reset.id }, data: { consumedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
