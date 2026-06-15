import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { resolveIsin } from "@/lib/quotes";

const CommitSchema = z.object({
  broker: z.enum(["ZERODHA", "GROWW", "GENERIC"]),
  fileName: z.string().min(1).max(255),
  transactions: z
    .array(
      z.object({
        symbol: z.string().max(40).optional(),
        isin: z.string().max(12).optional(),
        name: z.string().max(200).optional(),
        type: z.enum(["BUY", "SELL"]),
        quantity: z.number().positive(),
        price: z.number().nonnegative(),
        fees: z.number().nonnegative().optional(),
        tradedAt: z.string().min(8).max(40),
        exchange: z.enum(["NSE", "BSE"]),
      }),
    )
    .min(1)
    .max(5000),
});

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = CommitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid import payload." }, { status: 400 });
  }
  const { broker, fileName, transactions } = parsed.data;

  // Resolve symbol-less rows (some exports carry only ISIN), cache per-ISIN.
  const isinCache = new Map<string, { symbol: string; exchange: "NSE" | "BSE" } | null>();
  const resolved: {
    symbol: string;
    exchange: "NSE" | "BSE";
    isin?: string;
    name?: string;
    type: "BUY" | "SELL";
    quantity: number;
    price: number;
    fees: number;
    tradedAt: Date;
  }[] = [];
  const unresolved: string[] = [];

  for (const t of transactions) {
    const tradedAt = new Date(t.tradedAt);
    if (Number.isNaN(tradedAt.getTime())) continue;

    let symbol = t.symbol?.toUpperCase();
    let exchange = t.exchange;
    if (!symbol && t.isin) {
      let hit = isinCache.get(t.isin);
      if (hit === undefined) {
        hit = await resolveIsin(t.isin, t.name);
        isinCache.set(t.isin, hit);
      }
      if (hit) {
        symbol = hit.symbol;
        exchange = hit.exchange;
      }
    }
    if (!symbol) {
      unresolved.push(t.name ?? t.isin ?? "(unknown)");
      continue;
    }
    resolved.push({
      symbol,
      exchange,
      isin: t.isin,
      name: t.name,
      type: t.type,
      quantity: t.quantity,
      price: t.price,
      fees: t.fees ?? 0,
      tradedAt,
    });
  }

  if (resolved.length === 0) {
    return NextResponse.json(
      { error: "None of the trades could be matched to a listed stock." },
      { status: 422 },
    );
  }

  const batch = await prisma.importBatch.create({
    data: {
      portfolioId: user.portfolioId,
      broker,
      fileName,
      rowCount: resolved.length,
      kind: "TRANSACTIONS",
    },
  });

  // Idempotent re-import: skip a trade if an identical one already exists.
  // Quantize qty/price in the key — SQLite stores Float as a double and can
  // round-trip a computed value (e.g. buyValue/qty from a P&L statement) to a
  // last-ULP-different double, so the raw float wouldn't string-match on
  // re-import. 4 dp is well beyond paise/unit precision.
  const dedupKey = (t: { symbol: string; type: string; quantity: number; price: number; tradedAt: Date }) =>
    `${t.symbol}|${t.type}|${t.quantity.toFixed(4)}|${t.price.toFixed(4)}|${t.tradedAt.getTime()}`;

  const existing = await prisma.transaction.findMany({
    where: { portfolioId: user.portfolioId },
    select: { symbol: true, type: true, quantity: true, price: true, tradedAt: true },
  });
  const seen = new Set(existing.map(dedupKey));

  const toCreate = resolved.filter((t) => {
    const key = dedupKey(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (toCreate.length > 0) {
    await prisma.transaction.createMany({
      data: toCreate.map((t) => ({
        portfolioId: user.portfolioId!,
        symbol: t.symbol,
        exchange: t.exchange,
        isin: t.isin,
        name: t.name,
        type: t.type,
        quantity: t.quantity,
        price: t.price,
        fees: t.fees,
        tradedAt: t.tradedAt,
        broker,
        importBatchId: batch.id,
      })),
    });
  }

  return NextResponse.json({
    ok: true,
    imported: toCreate.length,
    skipped: resolved.length - toCreate.length,
    unresolved,
  });
}
