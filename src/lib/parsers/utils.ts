import Papa from "papaparse";
import ExcelJS from "exceljs";

/** Normalize any cell to a trimmed string. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
    if ("result" in value) return String(value.result ?? "").trim();
    if ("text" in value) return String(value.text ?? "").trim();
    if (value instanceof Date) return value.toISOString();
    return "";
  }
  return String(value).trim();
}

/** Read a CSV or XLSX file into a 2D array of trimmed string cells. */
export async function fileToRows(buffer: Buffer, fileName: string): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: string[] = [];
      const values = row.values as ExcelJS.CellValue[];
      // ExcelJS row.values is 1-indexed (index 0 is empty)
      for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]));
      rows.push(cells);
    });
    return rows;
  }
  const text = buffer.toString("utf-8");
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return result.data.map((row) => row.map((c) => (c ?? "").trim()));
}

/** Parse "1,234.50", "₹1234", "12.5%" etc. Returns NaN if not numeric. */
export function toNumber(raw: string): number {
  const cleaned = raw.replace(/[₹,%\s,]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "--") return NaN;
  return Number(cleaned);
}

export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Find the first row where every one of `required` appears (after
 * normalization) among the cells. Returns the row index and a map of
 * normalized header -> column index.
 */
export function findHeaderRow(
  rows: string[][],
  required: string[],
): { rowIndex: number; columns: Map<string, number> } | null {
  const requiredNorm = required.map(normalizeHeader);
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const norm = rows[i].map(normalizeHeader);
    if (requiredNorm.every((r) => norm.includes(r))) {
      const columns = new Map<string, number>();
      norm.forEach((h, idx) => {
        if (h && !columns.has(h)) columns.set(h, idx);
      });
      return { rowIndex: i, columns };
    }
  }
  return null;
}

/** First column index whose normalized header matches any alias, else -1. */
export function findColumn(columns: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const idx = columns.get(normalizeHeader(alias));
    if (idx !== undefined) return idx;
  }
  return -1;
}
