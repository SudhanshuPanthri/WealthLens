import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/quotes";
import { getSessionUser } from "@/lib/auth";

// Typeahead search for the watchlist "add stock" box. Auth-gated to avoid
// exposing an open proxy to Yahoo search.
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await searchStocks(q);
  return NextResponse.json({ results });
}
