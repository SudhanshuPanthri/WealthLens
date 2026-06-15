import { NextResponse } from "next/server";
import { getMarketSnapshot } from "@/lib/market";

// Public market snapshot for the homepage panel. Cached server-side in market.ts.
export async function GET() {
  try {
    const snapshot = await getMarketSnapshot();
    return NextResponse.json(snapshot);
  } catch (err) {
    console.error("Market snapshot failed:", err);
    return NextResponse.json({ error: "Could not load market data right now." }, { status: 502 });
  }
}
