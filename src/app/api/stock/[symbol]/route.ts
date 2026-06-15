import { NextRequest, NextResponse } from "next/server";
import { getStockDetail } from "@/lib/quotes";
import type { Exchange } from "@/lib/types";

// Live detail (quote + fundamentals + profile + price history) for one stock.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const { searchParams } = req.nextUrl;
  const exchange = (searchParams.get("exchange") === "BSE" ? "BSE" : "NSE") as Exchange;
  const rangeParam = searchParams.get("range") ?? "1Y";
  const range = (["1M", "6M", "1Y", "5Y"].includes(rangeParam) ? rangeParam : "1Y") as
    | "1M"
    | "6M"
    | "1Y"
    | "5Y";

  const detail = await getStockDetail(symbol.toUpperCase(), exchange, range);
  if (!detail) return NextResponse.json({ error: "Stock not found." }, { status: 404 });
  return NextResponse.json({ detail });
}
