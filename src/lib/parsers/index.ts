import type { ImportParse, TransactionParseResult } from "../types";
import { fileToRows } from "./utils";
import { parseZerodha } from "./zerodha";
import { parseGroww } from "./groww";
import { parseGeneric } from "./generic";
import { parseZerodhaTradebook, parseZerodhaPnl, parseGenericTransactions } from "./transactions";
import { parseCamsCasText, parseFundsCsv, pdfToText } from "./funds";

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

/**
 * Unified import entry point: detect whether an uploaded file is stock holdings
 * or mutual-fund positions (and, for PDFs, parse a CAMS/KFintech CAS). Returns a
 * discriminated result the commit layer routes on. `password` decrypts a
 * protected CAS PDF.
 */
export async function parseImportFile(
  buffer: Buffer,
  fileName: string,
  password?: string,
): Promise<ImportParse> {
  if (fileName.toLowerCase().endsWith(".pdf")) {
    const text = await pdfToText(buffer, password); // throws PdfPasswordError if encrypted
    const cas = parseCamsCasText(text);
    if (cas) return { kind: "FUNDS", ...cas };
    throw new ParseError(
      "Couldn't read this PDF as a CAMS or KFintech Consolidated Account Statement. " +
        "Make sure it's a mutual-fund CAS (from camsonline.com or MF Central).",
    );
  }

  const rows = await fileToRows(buffer, fileName);
  if (rows.length === 0) throw new ParseError("The file appears to be empty or unreadable.");

  // Broker-specific stock holdings first (strong signatures), then mutual-fund
  // CSV (needs scheme + units), then the permissive generic stock template.
  const brokerHoldings = parseZerodha(rows) ?? parseGroww(rows);
  if (brokerHoldings) return { kind: "HOLDINGS", ...brokerHoldings };

  const funds = parseFundsCsv(rows);
  if (funds) return { kind: "FUNDS", ...funds };

  const generic = parseGeneric(rows);
  if (generic) return { kind: "HOLDINGS", ...generic };

  throw new ParseError(
    "Could not recognize this file. Supported: a broker holdings export (Zerodha/Groww), " +
      "a mutual-fund CSV (columns: scheme, units, and avg NAV or invested), or a CAMS/KFintech CAS (PDF).",
  );
}

export class ParseError extends Error {}
