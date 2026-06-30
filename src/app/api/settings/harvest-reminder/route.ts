import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

const Schema = z.object({ optIn: z.boolean() });

/** Toggle the year-end tax-loss-harvesting email reminder for the signed-in user. */
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });

  await prisma.user.update({
    where: { id: user.id },
    data: { harvestReminderOptIn: parsed.data.optIn },
  });
  return NextResponse.json({ ok: true, optIn: parsed.data.optIn });
}
