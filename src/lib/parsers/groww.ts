import type { ParsedHolding, ParseResult } from "../types";
import { findHeaderRow, findColumn, toNumber } from "./utils";

/**
 * Parses the Groww "Holdings statement" Excel report
 * (Groww app/web → Reports → Stock Reports → Holdings).
 * Shape: a few preamble rows, then:
 *   Stock Name | ISIN | Quantity | Average buy price | Buy value | ...
 * Groww identifies stocks by name + ISIN only — the trading symbol is
 * resolved later (see resolveIsin in quotes.ts).
 */
export function parseGroww(rows: string[][]): ParseResult | null {
  const header =
    findHeaderRow(rows, ["Stock Name", "ISIN", "Quantity", "Average buy price"]) ??
    findHeaderRow(rows, ["Stock Name", "ISIN", "Quantity", "Avg buy price"]) ??
    findHeaderRow(rows, ["Stock Name", "ISIN", "Quantity"]);
  if (!header) return null;

  const { rowIndex, columns } = header;
  const nameCol = findColumn(columns, ["Stock Name"]);
  const isinCol = findColumn(columns, ["ISIN"]);
  const qtyCol = findColumn(columns, ["Quantity"]);
  const avgCol = findColumn(columns, ["Average buy price", "Avg buy price", "Average price", "Buy average price"]);

  const holdings: ParsedHolding[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[nameCol] ?? "").trim();
    const isin = (row[isinCol] ?? "").trim().toUpperCase();
    if (!name && !isin) continue;
    // ISINs for Indian equities look like INE002A01018
    if (!/^IN[A-Z0-9]{10}$/.test(isin)) {
      if (name) warnings.push(`Skipped row ${i + 1} ("${name}"): missing or invalid ISIN.`);
      continue;
    }
    const quantity = toNumber(row[qtyCol] ?? "");
    const avgPrice = avgCol >= 0 ? toNumber(row[avgCol] ?? "") : NaN;
    if (!Number.isFinite(quantity) || !Number.isFinite(avgPrice)) {
      warnings.push(`Skipped row ${i + 1} ("${name}"): could not read quantity/average buy price.`);
      continue;
    }
    if (quantity <= 0) continue;
    holdings.push({ name, isin, quantity, avgPrice, exchange: "NSE" });
  }

  if (holdings.length === 0) return null;
  return { broker: "GROWW", brokerLabel: "Groww", holdings, warnings };
}
