import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveIsin } from "@/lib/quotes";

const CommitSchema = z.object({
  broker: z.enum(["ZERODHA", "GROWW", "GENERIC"]),
  fileName: z.string().min(1).max(255),
  holdings: z
    .array(
      z.object({
        symbol: z.string().max(40).optional(),
        isin: z.string().max(12).optional(),
        name: z.string().max(200).optional(),
        quantity: z.number().positive(),
        avgPrice: z.number().nonnegative(),
        exchange: z.enum(["NSE", "BSE"]),
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
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid import payload." }, { status: 400 });
  }
  const { broker, fileName, holdings } = parsed.data;

  // Resolve symbol-less rows (Groww exports carry only name + ISIN)
  const resolved: { symbol: string; exchange: "NSE" | "BSE"; isin?: string; name?: string; quantity: number; avgPrice: number }[] = [];
  const unresolved: string[] = [];
  for (const h of holdings) {
    if (h.symbol) {
      resolved.push({ ...h, symbol: h.symbol.toUpperCase() });
    } else if (h.isin) {
      const hit = await resolveIsin(h.isin, h.name);
      if (hit) resolved.push({ ...h, symbol: hit.symbol, exchange: hit.exchange });
      else unresolved.push(h.name ?? h.isin);
    } else {
      unresolved.push(h.name ?? "(unknown)");
    }
  }

  if (resolved.length === 0) {
    return NextResponse.json(
      { error: "None of the holdings could be matched to a listed stock." },
      { status: 422 },
    );
  }

  const batch = await prisma.importBatch.create({
    data: { portfolioId: user.portfolioId, broker, fileName, rowCount: resolved.length },
  });

  // Same stock appearing twice in one file (e.g. NSE+BSE rows): merge quantities
  const merged = new Map<string, (typeof resolved)[number]>();
  for (const h of resolved) {
    const prev = merged.get(h.symbol);
    if (prev) {
      const totalQty = prev.quantity + h.quantity;
      prev.avgPrice = (prev.quantity * prev.avgPrice + h.quantity * h.avgPrice) / totalQty;
      prev.quantity = totalQty;
    } else {
      merged.set(h.symbol, { ...h });
    }
  }

  let upserted = 0;
  for (const h of merged.values()) {
    await prisma.holding.upsert({
      where: {
        portfolioId_symbol_broker: {
          portfolioId: user.portfolioId,
          symbol: h.symbol,
          broker,
        },
      },
      update: {
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        exchange: h.exchange,
        isin: h.isin ?? undefined,
        name: h.name ?? undefined,
        importBatchId: batch.id,
      },
      create: {
        portfolioId: user.portfolioId,
        symbol: h.symbol,
        broker,
        quantity: h.quantity,
        avgPrice: h.avgPrice,
        exchange: h.exchange,
        isin: h.isin,
        name: h.name,
        importBatchId: batch.id,
      },
    });
    upserted++;
  }

  return NextResponse.json({ ok: true, imported: upserted, unresolved });
}
