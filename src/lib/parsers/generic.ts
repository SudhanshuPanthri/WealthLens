import type { ParsedHolding, ParseResult, Exchange } from "../types";
import { findHeaderRow, findColumn, toNumber } from "./utils";

/**
 * Generic template for any other broker: a CSV/XLSX with columns
 *   symbol, quantity, avg_price  (plus optional: exchange, isin, name)
 * Header aliases are accepted (ticker/qty/average price/buy price...).
 */
export function parseGeneric(rows: string[][]): ParseResult | null {
  const symbolAliases = ["symbol", "ticker", "tradingsymbol", "scrip", "stock"];
  const qtyAliases = ["quantity", "qty", "shares", "units"];
  const priceAliases = ["avg_price", "avgprice", "average price", "avg cost", "buy price", "buy average", "price", "average buy price"];

  let header: ReturnType<typeof findHeaderRow> = null;
  for (const s of symbolAliases) {
    for (const q of qtyAliases) {
      header = findHeaderRow(rows, [s, q]);
      if (header) break;
    }
    if (header) break;
  }
  if (!header) return null;

  const { rowIndex, columns } = header;
  const symbolCol = findColumn(columns, symbolAliases);
  const qtyCol = findColumn(columns, qtyAliases);
  const priceCol = findColumn(columns, priceAliases);
  if (priceCol < 0) return null;
  const exchangeCol = findColumn(columns, ["exchange"]);
  const isinCol = findColumn(columns, ["isin"]);
  const nameCol = findColumn(columns, ["name", "stock name", "company"]);

  const holdings: ParsedHolding[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const symbol = (row[symbolCol] ?? "").toUpperCase().trim();
    if (!symbol) continue;
    const quantity = toNumber(row[qtyCol] ?? "");
    const avgPrice = toNumber(row[priceCol] ?? "");
    if (!Number.isFinite(quantity) || !Number.isFinite(avgPrice) || quantity <= 0) {
      warnings.push(`Skipped row ${i + 1} ("${symbol}"): invalid quantity or price.`);
      continue;
    }
    const exchange: Exchange =
      exchangeCol >= 0 && (row[exchangeCol] ?? "").toUpperCase().includes("BSE") ? "BSE" : "NSE";
    holdings.push({
      symbol,
      quantity,
      avgPrice,
      exchange,
      isin: isinCol >= 0 ? row[isinCol]?.trim() || undefined : undefined,
      name: nameCol >= 0 ? row[nameCol]?.trim() || undefined : undefined,
    });
  }

  if (holdings.length === 0) return null;
  return { broker: "GENERIC", brokerLabel: "Other broker", holdings, warnings };
}
