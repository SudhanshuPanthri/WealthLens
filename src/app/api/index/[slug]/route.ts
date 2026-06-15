import { NextRequest, NextResponse } from "next/server";
import { getIndexDetail } from "@/lib/market";

// Live detail (quote + price history) for one market index. The slug is
// validated against INDEX_REGISTRY inside getIndexDetail — no arbitrary fetch.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const rangeParam = req.nextUrl.searchParams.get("range") ?? "1Y";
  const range = (["1M", "6M", "1Y", "5Y"].includes(rangeParam) ? rangeParam : "1Y") as
    | "1M"
    | "6M"
    | "1Y"
    | "5Y";

  const detail = await getIndexDetail(slug, range);
  if (!detail) return NextResponse.json({ error: "Index not found." }, { status: 404 });
  return NextResponse.json({ detail });
}
