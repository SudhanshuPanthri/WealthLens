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
