import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { fundDedupeKey, resolveScheme } from "@/lib/funds";

const CommitSchema = z.object({
  source: z.enum(["CAMS", "KFINTECH", "CSV"]),
  fileName: z.string().min(1).max(255),
  funds: z
    .array(
      z.object({
        schemeName: z.string().min(1).max(200),
        isin: z.string().max(20).optional(),
        amc: z.string().max(120).optional(),
        folio: z.string().max(60).optional(),
        units: z.number().positive(),
        avgNav: z.number().nonnegative(),
        costValue: z.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CommitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid import payload." }, { status: 400 });
  const { source, fileName, funds } = parsed.data;

  // Merge duplicate (scheme, folio) rows within one file before writing.
  const merged = new Map<string, (typeof funds)[number]>();
  for (const f of funds) {
    const key = fundDedupeKey(f.isin, f.schemeName, f.folio);
    const prev = merged.get(key);
    if (prev) {
      const totalUnits = prev.units + f.units;
      const prevCost = prev.costValue ?? prev.units * prev.avgNav;
      const addCost = f.costValue ?? f.units * f.avgNav;
      prev.costValue = prevCost + addCost;
      prev.avgNav = totalUnits > 0 ? (prevCost + addCost) / totalUnits : 0;
      prev.units = totalUnits;
    } else {
      merged.set(key, { ...f });
    }
  }

  const batch = await prisma.importBatch.create({
    data: { portfolioId: user.portfolioId, broker: source, fileName, rowCount: merged.size, kind: "FUNDS" },
  });

  let upserted = 0;
  for (const [dedupeKey, f] of merged) {
    // Resolve the mfapi.in scheme code now (cached) so the dashboard prices it
    // without a lookup on every poll. A miss is non-fatal — value falls back.
    const resolved = await resolveScheme(f.schemeName, f.isin).catch(() => null);
    await prisma.fundHolding.upsert({
      where: { portfolioId_dedupeKey: { portfolioId: user.portfolioId, dedupeKey } },
      update: {
        schemeName: f.schemeName,
        schemeCode: resolved?.schemeCode ?? null,
        isin: f.isin ?? null,
        amc: f.amc ?? null,
        folio: f.folio ?? null,
        units: f.units,
        avgNav: f.avgNav,
        costValue: f.costValue ?? null,
        source,
        importBatchId: batch.id,
      },
      create: {
        portfolioId: user.portfolioId,
        dedupeKey,
        schemeName: f.schemeName,
        schemeCode: resolved?.schemeCode ?? null,
        isin: f.isin ?? null,
        amc: f.amc ?? null,
        folio: f.folio ?? null,
        units: f.units,
        avgNav: f.avgNav,
        costValue: f.costValue ?? null,
        source,
        importBatchId: batch.id,
      },
    });
    upserted++;
  }

  return NextResponse.json({ ok: true, imported: upserted });
}
