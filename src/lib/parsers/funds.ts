import type { FundParseResult, FundSource, ParsedFund } from "../types";
import { findColumn, toNumber } from "./utils";

/** Thrown when a PDF is encrypted and the supplied password is missing/wrong. */
export class PdfPasswordError extends Error {
  readonly wrong: boolean;
  constructor(wrong: boolean) {
    super(wrong ? "Incorrect PDF password." : "This PDF is password-protected.");
    this.name = "PdfPasswordError";
    this.wrong = wrong;
  }
}

/**
 * Extract text from a (possibly password-protected) PDF, reconstructing lines
 * from text-item positions so downstream parsing sees real line structure.
 */
export async function pdfToText(buffer: Buffer, password?: string): Promise<string> {
  // Dynamic import: keep the heavy pdf.js out of the module graph until a PDF
  // is actually uploaded (and off the Edge bundle entirely).
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      password: password ?? "",
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
  } catch (err: unknown) {
    const e = err as { name?: string; code?: number };
    if (e?.name === "PasswordException") throw new PdfPasswordError(e.code === 2);
    throw err;
  }

  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items into lines by rounded y; order lines top→bottom, items left→right.
    const lines = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items) {
      if (!("str" in item) || !("transform" in item)) continue;
      const y = Math.round(item.transform[5]);
      const arr = lines.get(y) ?? [];
      arr.push({ x: item.transform[4], str: item.str });
      lines.set(y, arr);
    }
    const text = [...lines.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    pages.push(text);
  }
  return pages.join("\n");
}

const ISIN_RE = /\bINF[A-Z0-9]{9}\b/;
const NUM = "([0-9,]+\\.?[0-9]*)";

/**
 * Parse a CAMS / KFintech Consolidated Account Statement (CAS) into fund
 * positions. Operates on the line-structured text from `pdfToText`. Best-effort
 * against the documented eCAS layout: per-scheme blocks delimited by an ISIN,
 * with closing units / NAV / cost-value / market-value summary lines.
 */
export function parseCamsCasText(text: string): FundParseResult | null {
  if (!/consolidated account statement|\bcas\b/i.test(text) && !ISIN_RE.test(text)) return null;

  const source: FundSource = /\b(kfintech|karvy)\b/i.test(text) ? "KFINTECH" : "CAMS";
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const funds: ParsedFund[] = [];
  const warnings: string[] = [];
  let amc: string | undefined;
  let folio: string | undefined;
  let schemeHeader: string | undefined; // most recent scheme-name line
  let current: Partial<ParsedFund> & { units?: number } = {};

  const flush = () => {
    if (current.schemeName && current.units && current.units > 0) {
      const units = current.units;
      const costValue = current.costValue;
      const avgNav = costValue && units > 0 ? costValue / units : (current.avgNav ?? 0);
      funds.push({
        schemeName: current.schemeName,
        isin: current.isin,
        amc: current.amc,
        folio: current.folio,
        units,
        avgNav,
        costValue,
      });
    }
    current = {};
  };

  for (const line of lines) {
    // AMC section header, e.g. "Aditya Birla Sun Life Mutual Fund"
    const amcMatch = line.match(/^(.{3,60}?Mutual Fund)\b/i);
    if (amcMatch && !/folio|isin|nav|value/i.test(line)) amc = amcMatch[1].trim();

    // Folio number
    const folioMatch = line.match(/Folio No[:.\s]+([0-9][0-9A-Za-z\/ ]*?)(?:\s{2,}|\s*(?:PAN|KYC)\b|$)/i);
    if (folioMatch) folio = folioMatch[1].trim();

    // A scheme-name line: has a registrar tag or the leading "<code>-<name>" shape.
    if (/Registrar\s*:/i.test(line) || /^[A-Z0-9]{3,}-[A-Za-z]/.test(line)) {
      schemeHeader = line
        .replace(/^[A-Z0-9]{3,}-/, "")
        .replace(/\(Advisor.*$/i, "")
        .replace(/Registrar\s*:.*$/i, "")
        .replace(/\bISIN\b.*$/i, "")
        .replace(/\s+/g, " ")
        .trim();
    }

    // ISIN starts/continues a scheme block.
    const isinMatch = line.match(ISIN_RE);
    if (isinMatch) {
      flush();
      const inlineName = line
        .slice(0, isinMatch.index)
        .replace(/^[A-Z0-9]{3,}-/, "")
        .replace(/ISIN.*$/i, "")
        .trim();
      current = {
        schemeName: (inlineName.length > 4 ? inlineName : schemeHeader) ?? schemeHeader,
        isin: isinMatch[0],
        amc,
        folio,
      };
    }

    // Summary values (may share a line).
    const units = line.match(new RegExp(`Closing Unit Balance[:.\\s]+${NUM}`, "i"));
    if (units) current.units = toNumber(units[1]);
    const nav = line.match(new RegExp(`NAV on[^:]*[:.]\\s*(?:INR|Rs\\.?)?\\s*${NUM}`, "i"));
    if (nav) current.avgNav = toNumber(nav[1]); // provisional; overridden by cost/units below
    const cost = line.match(new RegExp(`Total Cost Value[^0-9]*${NUM}`, "i"));
    if (cost) current.costValue = toNumber(cost[1]);
  }
  flush();

  if (funds.length === 0) return null;
  if (funds.some((f) => !f.costValue)) {
    warnings.push("Some schemes had no cost value in the statement — invested amounts use the latest NAV as a fallback.");
  }
  warnings.push("Holdings reflect the statement's closing balances; values are re-priced live against today's NAV.");

  return {
    source,
    sourceLabel: source === "KFINTECH" ? "KFintech CAS" : "CAMS CAS",
    funds,
    warnings,
  };
}

/**
 * Parse a generic mutual-fund holdings CSV/Excel. Needs a scheme-name column and
 * a units column, plus either an avg-NAV/cost-per-unit column or a total-invested
 * column. Optional: isin, folio, amc.
 */
export function parseFundsCsv(rows: string[][]): FundParseResult | null {
  // Detect the header by the presence of a scheme + units column in the first
  // 40 rows (broker MF exports often carry banner rows above the table).
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cols = new Map<string, number>();
    rows[i].forEach((c, idx) => {
      const norm = c.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (norm && !cols.has(norm)) cols.set(norm, idx);
    });
    const schemeCol = findColumn(cols, ["scheme", "schemename", "fund", "fundname", "schemenamefund"]);
    const unitsCol = findColumn(cols, ["units", "unitbalance", "closingunits", "closingunitbalance", "balanceunits", "quantity"]);
    if (schemeCol === -1 || unitsCol === -1) continue;

    const navCol = findColumn(cols, ["avgnav", "averagenav", "purchasenav", "costperunit", "nav", "avgprice"]);
    const costCol = findColumn(cols, ["investedvalue", "invested", "costvalue", "amountinvested", "totalcost", "purchasevalue"]);
    const isinCol = findColumn(cols, ["isin"]);
    const folioCol = findColumn(cols, ["folio", "foliono", "folionumber"]);
    const amcCol = findColumn(cols, ["amc", "fundhouse", "amcname", "mutualfund"]);

    const funds: ParsedFund[] = [];
    const warnings: string[] = [];
    for (let r = i + 1; r < rows.length; r++) {
      const row = rows[r];
      const schemeName = (row[schemeCol] ?? "").trim();
      const units = toNumber(row[unitsCol] ?? "");
      if (!schemeName || !Number.isFinite(units) || units <= 0) continue;

      const cost = costCol !== -1 ? toNumber(row[costCol] ?? "") : NaN;
      const navOrCostPerUnit = navCol !== -1 ? toNumber(row[navCol] ?? "") : NaN;
      let avgNav = 0;
      let costValue: number | undefined;
      if (Number.isFinite(cost)) {
        costValue = cost;
        avgNav = units > 0 ? cost / units : 0;
      } else if (Number.isFinite(navOrCostPerUnit)) {
        avgNav = navOrCostPerUnit;
      } else {
        continue; // no cost basis we can use
      }

      funds.push({
        schemeName,
        isin: isinCol !== -1 ? (row[isinCol] ?? "").trim() || undefined : undefined,
        folio: folioCol !== -1 ? (row[folioCol] ?? "").trim() || undefined : undefined,
        amc: amcCol !== -1 ? (row[amcCol] ?? "").trim() || undefined : undefined,
        units,
        avgNav,
        costValue,
      });
    }

    if (funds.length === 0) return null;
    return { source: "CSV", sourceLabel: "Mutual-fund CSV", funds, warnings };
  }
  return null;
}
