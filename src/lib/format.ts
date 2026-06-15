const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(value: number | null | undefined, precise = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return precise ? inrPrecise.format(value) : inr.format(value);
}

export function formatPct(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

/** Compact INR using Indian crore/lakh scale, e.g. ₹1.45 L Cr, ₹820 Cr. */
export function formatCroreINR(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const crore = value / 1e7;
  if (crore >= 1e5) return `₹${(crore / 1e5).toFixed(2)} L Cr`;
  if (crore >= 1) return `₹${crore.toFixed(crore >= 100 ? 0 : 2)} Cr`;
  return `₹${(value / 1e5).toFixed(2)} L`;
}

export function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function pnlClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "text-muted";
  return value >= 0 ? "text-gain" : "text-loss";
}

export const BROKER_LABELS: Record<string, string> = {
  ZERODHA: "Zerodha",
  GROWW: "Groww",
  GENERIC: "Other",
};
