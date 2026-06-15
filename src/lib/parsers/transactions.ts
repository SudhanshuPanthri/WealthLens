import type { ParsedTransaction, TransactionParseResult, TradeType, Exchange } from "../types";
import { findHeaderRow, findColumn, toNumber } from "./utils";

/**
 * Parse a date cell from the formats brokers emit:
 *  - ISO: 2023-04-03 or 2023-04-03T09:15:00 (Zerodha)
 *  - dd-mm-yyyy / dd/mm/yyyy (common in Indian generic exports)
 * Returns an ISO date string (yyyy-mm-dd) or null.
 */
export function parseTradeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // ISO first (yyyy-mm-dd, optionally with time)
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // dd-mm-yyyy or dd/mm/yyyy
  const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    let year = dmy[3];
    if (year.length === 2) year = `20${year}`;
    return `${year}-${month}-${day}`;
  }

  // Last resort: let the engine try
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normalizeType(raw: string): TradeType | null {
  const t = raw.trim().toLowerCase();
  if (t === "buy" || t === "b" || t === "bought" || t === "credit") return "BUY";
  if (t === "sell" || t === "s" || t === "sold" || t === "debit") return "SELL";
  return null;
}

/**
 * Zerodha tradebook (Console → Reports → Tradebook → download). Columns:
 * symbol, isin, trade_date, exchange, segment, series, trade_type, auction,
 * quantity, price, trade_id, order_id, order_execution_time.
 */
export function parseZerodhaTradebook(rows: string[][]): TransactionParseResult | null {
  const header = findHeaderRow(rows, ["symbol", "trade_date", "trade_type", "quantity", "price"]);
  if (!header) return null;
  const { rowIndex, columns } = header;
  const symbolCol = findColumn(columns, ["symbol"]);
  const isinCol = findColumn(columns, ["isin"]);
  const dateCol = findColumn(columns, ["trade_date", "order_execution_time"]);
  const typeCol = findColumn(columns, ["trade_type"]);
  const qtyCol = findColumn(columns, ["quantity"]);
  const priceCol = findColumn(columns, ["price"]);
  const exCol = findColumn(columns, ["exchange"]);

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const symbol = (row[symbolCol] ?? "").toUpperCase().trim();
    if (!symbol) continue;
    const type = normalizeType(row[typeCol] ?? "");
    const quantity = toNumber(row[qtyCol] ?? "");
    const price = toNumber(row[priceCol] ?? "");
    const tradedAt = parseTradeDate(row[dateCol] ?? "");
    if (!type || !Number.isFinite(quantity) || !Number.isFinite(price) || !tradedAt) {
      warnings.push(`Skipped row ${i + 1} ("${symbol}"): missing trade type, qty, price, or date.`);
      continue;
    }
    if (quantity <= 0) continue;
    const exRaw = (exCol >= 0 ? row[exCol] : "").toUpperCase();
    transactions.push({
      symbol: symbol.replace(/-(BE|BL|T1|N1|E1)$/i, ""),
      isin: isinCol >= 0 ? row[isinCol]?.trim() || undefined : undefined,
      type,
      quantity,
      price,
      tradedAt,
      exchange: exRaw.includes("BSE") ? "BSE" : "NSE",
    });
  }

  if (transactions.length === 0) return null;
  return { broker: "ZERODHA", brokerLabel: "Zerodha", transactions, warnings };
}

// Zerodha appends a series suffix to P&L symbols (e.g. GOLDBEES-E, LIQUIDCASE-F).
// Strip it so the symbol resolves against live quotes / ISIN lookup.
const PNL_SUFFIX = /-(E|F|BE|BZ|BL|T1|N1|E1|RL)$/i;

/** Pull the "from YYYY-MM-DD to YYYY-MM-DD" period out of the statement header. */
function findStatementPeriod(rows: string[][]): { from: string; to: string } | null {
  for (const row of rows) {
    for (const cell of row) {
      const m = cell.match(/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i);
      if (m) return { from: m[1], to: m[2] };
    }
  }
  return null;
}

/**
 * Zerodha Tax P&L statement (Console → Reports → P&L → download). The "Equity"
 * sheet carries an aggregated table — NOT individual trades:
 *   Symbol | ISIN | Quantity | Buy Value | Sell Value | Realized P&L | ... |
 *   Open Quantity | Open Quantity Type | Open Value | Unrealized P&L | ...
 *
 * We decompose each row into synthetic transactions so the ledger/P&L engine
 * can consume it: the realized quantity becomes a BUY + SELL at its average
 * prices, and the open quantity becomes a BUY at its cost basis. Because the
 * statement has no per-trade dates, buys are dated to the period start and
 * sells to the period end — so realized/unrealized totals are exact while XIRR
 * is only an estimate (warned below; the Tradebook gives precise XIRR).
 */
export function parseZerodhaPnl(rows: string[][]): TransactionParseResult | null {
  const header = findHeaderRow(rows, ["symbol", "isin", "quantity", "buy value", "sell value"]);
  if (!header) return null;
  const { rowIndex, columns } = header;
  const symbolCol = findColumn(columns, ["symbol"]);
  const isinCol = findColumn(columns, ["isin"]);
  const qtyCol = findColumn(columns, ["quantity"]);
  const buyValCol = findColumn(columns, ["buy value"]);
  const sellValCol = findColumn(columns, ["sell value"]);
  const openQtyCol = findColumn(columns, ["open quantity"]);
  const openValCol = findColumn(columns, ["open value"]);

  const period = findStatementPeriod(rows);
  // Fall back to a 1-year window ending today if the header line is missing.
  const buyDate = period?.from ?? "2000-01-01";
  const sellDate = period?.to ?? new Date().toISOString().slice(0, 10);

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    let symbol = (row[symbolCol] ?? "").toUpperCase().trim();
    if (!symbol) continue;
    symbol = symbol.replace(PNL_SUFFIX, "");
    const isin = isinCol >= 0 ? row[isinCol]?.trim() || undefined : undefined;

    const realizedQty = toNumber(row[qtyCol] ?? "");
    const buyValue = toNumber(row[buyValCol] ?? "");
    const sellValue = toNumber(row[sellValCol] ?? "");
    const openQty = openQtyCol >= 0 ? toNumber(row[openQtyCol] ?? "") : NaN;
    const openValue = openValCol >= 0 ? toNumber(row[openValCol] ?? "") : NaN;

    const base = { symbol, isin, exchange: "NSE" as Exchange };

    // Realized leg: a round-trip BUY then SELL at average prices.
    if (Number.isFinite(realizedQty) && realizedQty > 0 && Number.isFinite(buyValue) && Number.isFinite(sellValue)) {
      transactions.push({ ...base, type: "BUY", quantity: realizedQty, price: buyValue / realizedQty, tradedAt: buyDate });
      transactions.push({ ...base, type: "SELL", quantity: realizedQty, price: sellValue / realizedQty, tradedAt: sellDate });
    }

    // Open leg: still-held quantity at its cost basis.
    if (Number.isFinite(openQty) && openQty > 0 && Number.isFinite(openValue) && openValue > 0) {
      transactions.push({ ...base, type: "BUY", quantity: openQty, price: openValue / openQty, tradedAt: buyDate });
    }
  }

  if (transactions.length === 0) return null;
  warnings.push(
    "This is a P&L statement, not a tradebook: it has no per-trade dates, so buys are " +
      "dated to the statement start and sells to its end. Realized and unrealized P&L are " +
      "exact, but XIRR is an estimate — import the Tradebook for precise return-rate timing.",
  );
  return { broker: "ZERODHA", brokerLabel: "Zerodha P&L statement", transactions, warnings };
}

/**
 * Generic tradebook: a CSV with date, symbol, type (buy/sell), quantity, price,
 * and optional fees. Header aliases are matched loosely.
 */
export function parseGenericTransactions(rows: string[][]): TransactionParseResult | null {
  const header =
    findHeaderRow(rows, ["date", "symbol", "type", "quantity", "price"]) ??
    findHeaderRow(rows, ["date", "symbol", "side", "quantity", "price"]) ??
    findHeaderRow(rows, ["trade date", "symbol", "trade type", "quantity", "price"]);
  if (!header) return null;
  const { rowIndex, columns } = header;
  const symbolCol = findColumn(columns, ["symbol", "ticker", "scrip", "instrument"]);
  const dateCol = findColumn(columns, ["date", "trade date", "trade_date"]);
  const typeCol = findColumn(columns, ["type", "side", "trade type", "trade_type", "transaction type"]);
  const qtyCol = findColumn(columns, ["quantity", "qty", "shares"]);
  const priceCol = findColumn(columns, ["price", "rate", "avg price"]);
  const isinCol = findColumn(columns, ["isin"]);
  const feesCol = findColumn(columns, ["fees", "charges", "brokerage", "commission"]);
  const exCol = findColumn(columns, ["exchange"]);

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (let i = rowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const symbol = (row[symbolCol] ?? "").toUpperCase().trim();
    if (!symbol) continue;
    const type = normalizeType(row[typeCol] ?? "");
    const quantity = toNumber(row[qtyCol] ?? "");
    const price = toNumber(row[priceCol] ?? "");
    const tradedAt = parseTradeDate(row[dateCol] ?? "");
    if (!type || !Number.isFinite(quantity) || !Number.isFinite(price) || !tradedAt) {
      warnings.push(`Skipped row ${i + 1} ("${symbol}"): missing trade type, qty, price, or date.`);
      continue;
    }
    if (quantity <= 0) continue;
    const fees = feesCol >= 0 ? toNumber(row[feesCol] ?? "") : NaN;
    const exRaw = (exCol >= 0 ? row[exCol] : "").toUpperCase();
    transactions.push({
      symbol,
      isin: isinCol >= 0 ? row[isinCol]?.trim() || undefined : undefined,
      type,
      quantity,
      price,
      fees: Number.isFinite(fees) ? fees : undefined,
      tradedAt,
      exchange: (exRaw.includes("BSE") ? "BSE" : "NSE") as Exchange,
    });
  }

  if (transactions.length === 0) return null;
  return { broker: "GENERIC", brokerLabel: "Generic tradebook", transactions, warnings };
}
