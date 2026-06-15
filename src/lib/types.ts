export type Broker = "ZERODHA" | "GROWW" | "GENERIC";
export type Exchange = "NSE" | "BSE";

/** One holding row extracted from a broker export, before symbol resolution. */
export interface ParsedHolding {
  /** NSE/BSE trading symbol, e.g. RELIANCE. Missing for Groww (name+ISIN only). */
  symbol?: string;
  isin?: string;
  name?: string;
  quantity: number;
  avgPrice: number;
  exchange: Exchange;
}

export interface ParseResult {
  broker: Broker;
  brokerLabel: string;
  holdings: ParsedHolding[];
  warnings: string[];
}

export type TradeType = "BUY" | "SELL";

/** One trade row extracted from a broker tradebook, before symbol resolution. */
export interface ParsedTransaction {
  symbol?: string;
  isin?: string;
  name?: string;
  type: TradeType;
  quantity: number;
  price: number;
  fees?: number;
  tradedAt: string; // ISO date
  exchange: Exchange;
}

export interface TransactionParseResult {
  broker: Broker;
  brokerLabel: string;
  transactions: ParsedTransaction[];
  warnings: string[];
}

export type FundSource = "CAMS" | "KFINTECH" | "CSV";

/** One mutual-fund position parsed from a CSV/Excel or a CAS, pre-resolution. */
export interface ParsedFund {
  schemeName: string;
  isin?: string;
  amc?: string;
  folio?: string;
  units: number;
  /** Cost basis per unit. Derived from costValue/units when only a total is given. */
  avgNav: number;
  /** Total invested, when the source states it directly (CAS does). */
  costValue?: number;
}

export interface FundParseResult {
  source: FundSource;
  sourceLabel: string;
  funds: ParsedFund[];
  warnings: string[];
}

/**
 * Discriminated result of the unified import parser: a file is either a set of
 * stock holdings or a set of mutual-fund positions. (Transactions have their own
 * dedicated parse/commit route.)
 */
export type ImportParse =
  | ({ kind: "HOLDINGS" } & ParseResult)
  | ({ kind: "FUNDS" } & FundParseResult);
