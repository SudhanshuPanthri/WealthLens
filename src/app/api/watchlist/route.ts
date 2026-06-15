import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getQuotes, toYahooSymbol } from "@/lib/quotes";
import type { Exchange } from "@/lib/types";

export interface WatchlistRow {
  id: string;
  symbol: string;
  exchange: Exchange;
  name: string | null;
  price: number | null;
  dayChangePct: number | null;
  high52: number | null;
  low52: number | null;
}

// GET — the user's watchlist, enriched with live quotes.
export async function GET() {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const items = await prisma.watchlistItem.findMany({
    where: { portfolioId: user.portfolioId },
    orderBy: { createdAt: "desc" },
  });
  if (items.length === 0) return NextResponse.json({ items: [] });

  const quotes = await getQuotes(items.map((i) => toYahooSymbol(i.symbol, i.exchange)));
  const rows: WatchlistRow[] = items.map((i) => {
    const q = quotes.get(toYahooSymbol(i.symbol, i.exchange));
    return {
      id: i.id,
      symbol: i.symbol,
      exchange: i.exchange as Exchange,
      name: i.name ?? q?.name ?? null,
      price: q?.price ?? null,
      dayChangePct: q?.dayChange ?? null,
      high52: q?.high52 ?? null,
      low52: q?.low52 ?? null,
    };
  });
  return NextResponse.json({ items: rows });
}

const addSchema = z.object({
  symbol: z.string().min(1).max(40),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  name: z.string().max(120).optional(),
});

// POST — add a stock to the watchlist (idempotent on symbol+exchange).
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  const { symbol, exchange, name } = parsed.data;

  const item = await prisma.watchlistItem.upsert({
    where: {
      portfolioId_symbol_exchange: {
        portfolioId: user.portfolioId,
        symbol: symbol.toUpperCase(),
        exchange,
      },
    },
    update: { name: name ?? undefined },
    create: { portfolioId: user.portfolioId, symbol: symbol.toUpperCase(), exchange, name },
  });
  return NextResponse.json({ item });
}

// DELETE — remove a stock by ?id=… (its own id) or ?symbol=&exchange=.
export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user?.portfolioId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  if (id) {
    // deleteMany scopes the delete to this user's portfolio, preventing IDOR.
    await prisma.watchlistItem.deleteMany({ where: { id, portfolioId: user.portfolioId } });
    return NextResponse.json({ ok: true });
  }
  const symbol = searchParams.get("symbol");
  const exchange = (searchParams.get("exchange") === "BSE" ? "BSE" : "NSE") as Exchange;
  if (!symbol) return NextResponse.json({ error: "Nothing to delete." }, { status: 400 });
  await prisma.watchlistItem.deleteMany({
    where: { portfolioId: user.portfolioId, symbol: symbol.toUpperCase(), exchange },
  });
  return NextResponse.json({ ok: true });
}
