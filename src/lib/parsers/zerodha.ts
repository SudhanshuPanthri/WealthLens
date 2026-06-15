import type { ParsedHolding, ParseResult } from "../types";
import { findHeaderRow, findColumn, toNumber } from "./utils";

/**
 * Parses Zerodha holdings exports in either of the two shapes Zerodha produces:
 *  - Console (console.zerodha.com → Portfolio → Holdings → Download):
 *    Symbol | ISIN | Sector | Quantity Available | ... | Average Price | ...
 *  - Kite web (kite.zerodha.com → Holdings → small download icon):
 *    Instrument | Qty. | Avg. cost | LTP | Cur. val | P&L | ...
 */
export function parseZerodha(rows: string[][]): ParseResult | null {
  const consoleHeader = findHeaderRow(rows, ["Symbol", "Quantity Available", "Average Price"]);
  const kiteHeader = consoleHeader
    ? null
    : findHeaderRow(rows, ["Instrument", "Qty.", "Avg. cost"]);
  const header = consoleHeader ?? kiteHeader;
  if (!header) return null;

  const { rowIndex, columns } = header;
  const symbolCol = findColumn(columns, ["Symbol", "Instrument"]);
  const qtyCol = findColumn(columns, ["Quantity Available", "Qty."]);
  const avgCol = findColumn(columns, ["Average Price", "Avg. cost"]);
  const isinCol = findColumn(columns, ["ISIN"]);

  const holdings: ParsedHolding[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const symbol = (row[symbolCol] ?? "").toUpperCase().trim();
    if (!symbol) continue;
    const quantity = toNumber(row[qtyCol] ?? "");
    const avgPrice = toNumber(row[avgCol] ?? "");
    if (!Number.isFinite(quantity) || !Number.isFinite(avgPrice)) {
      warnings.push(`Skipped row ${i + 1} ("${symbol}"): could not read quantity/average price.`);
      continue;
    }
    if (quantity <= 0) continue;
    holdings.push({
      // Kite suffixes like "-BE"/"-T1" mark trade-to-trade series, not part of the symbol
      symbol: symbol.replace(/-(BE|BL|T1|N1|E1)$/i, ""),
      isin: isinCol >= 0 ? row[isinCol]?.trim() || undefined : undefined,
      quantity,
      avgPrice,
      exchange: "NSE",
    });
  }

  if (holdings.length === 0) return null;
  return { broker: "ZERODHA", brokerLabel: "Zerodha", holdings, warnings };
}
