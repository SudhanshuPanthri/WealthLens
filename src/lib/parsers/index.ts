import type { ParseResult, TransactionParseResult } from "../types";
import { fileToRows } from "./utils";
import { parseZerodha } from "./zerodha";
import { parseGroww } from "./groww";
import { parseGeneric } from "./generic";
import { parseZerodhaTradebook, parseZerodhaPnl, parseGenericTransactions } from "./transactions";

/**
 * Auto-detect the broker format and parse holdings out of an uploaded
 * CSV/XLSX. Order matters: broker-specific signatures are checked before
 * the permissive generic template.
 */
export async function parsePortfolioFile(buffer: Buffer, fileName: string): Promise<ParseResult> {
  const rows = await fileToRows(buffer, fileName);
  if (rows.length === 0) {
    throw new ParseError("The file appears to be empty or unreadable.");
  }

  const result = parseZerodha(rows) ?? parseGroww(rows) ?? parseGeneric(rows);
  if (!result) {
    throw new ParseError(
      "Could not recognize this file. Supported: Zerodha Console/Kite holdings export, " +
        "Groww holdings statement, or a generic CSV with columns: symbol, quantity, avg_price.",
    );
  }
  return result;
}

/**
 * Auto-detect and parse a broker *tradebook* (list of buy/sell trades) out of
 * an uploaded CSV/XLSX. Used by the transactions import.
 */
export async function parseTransactionsFile(
  buffer: Buffer,
  fileName: string,
): Promise<TransactionParseResult> {
  const rows = await fileToRows(buffer, fileName);
  if (rows.length === 0) {
    throw new ParseError("The file appears to be empty or unreadable.");
  }

  const result =
    parseZerodhaPnl(rows) ?? parseZerodhaTradebook(rows) ?? parseGenericTransactions(rows);
  if (!result) {
    throw new ParseError(
      "Could not recognize this file. Supported: Zerodha Console Tradebook, " +
        "Zerodha P&L statement, or a generic CSV with columns: date, symbol, " +
        "type (buy/sell), quantity, price.",
    );
  }
  return result;
}

export class ParseError extends Error {}
