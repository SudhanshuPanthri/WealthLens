import type { FundHolding } from "@prisma/client";
import { prisma } from "./db";
import { fundCache } from "./cache";

const NAV_TTL_MS = 30 * 60 * 1000; // NAVs publish once daily — 30-min cache is plenty.

export interface EnrichedFund {
  schemeName: string;
  amc: string | null;
  folio: string | null;
  isin: string | null;
  category: string | null;
  units: number;
  avgNav: number;
  invested: number;
  nav: number | null; // latest NAV
  navDate: string | null;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  weightPct: number | null;
}

export interface FundMetrics {
  totals: { invested: number; currentValue: number; pnl: number; pnlPct: number; count: number; pricedCount: number };
  funds: EnrichedFund[];
  amcAllocation: { label: string; value: number; pct: number }[];
  asOf: string;
}

/** Stable key for a fund position: ISIN+folio when known, else scheme name+folio. */
export function fundDedupeKey(isin: string | null | undefined, schemeName: string, folio: string | null | undefined): string {
  const f = (folio ?? "").trim();
  if (isin && isin.trim()) return `isin:${isin.trim().toUpperCase()}|${f}`;
  return `name:${normalizeSchemeName(schemeName)}|${f}`;
}

export function normalizeSchemeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---- mfapi.in access (NAV provider) ---------------------------------------

interface MfSearchHit {
  schemeCode: number;
  schemeName: string;
}
interface MfDetail {
  meta: { scheme_code: number; scheme_name: string; fund_house?: string; scheme_category?: string };
  data: { date: string; nav: string }[];
}

/** fetch with one retry — guards against undici cold-connection timeouts (see market.ts). */
async function fetchRetry(url: string): Promise<Response> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch {
    return fetch(url, { signal: AbortSignal.timeout(8000) });
  }
}

/**
 * Resolve a scheme (by ISIN/name) to an mfapi.in scheme code, cached permanently
 * in FundSchemeMap. mfapi.in only searches by name, so we search the scheme name
 * and pick the hit that best matches the plan/option tokens (Direct/Regular,
 * Growth/IDCW) present in the query.
 */
export async function resolveScheme(
  schemeName: string,
  isin?: string | null,
): Promise<{ schemeCode: string; schemeName: string } | null> {
  const cacheKey = isin?.trim() ? `isin:${isin.trim().toUpperCase()}` : `name:${normalizeSchemeName(schemeName)}`;
  const cached = await prisma.fundSchemeMap.findUnique({ where: { key: cacheKey } });
  if (cached) return { schemeCode: cached.schemeCode, schemeName: cached.schemeName };

  try {
    const res = await fetchRetry(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(cleanQuery(schemeName))}`);
    if (!res.ok) return null;
    const hits = (await res.json()) as MfSearchHit[];
    if (!hits?.length) return null;

    const best = pickBestHit(hits, schemeName);
    await prisma.fundSchemeMap.upsert({
      where: { key: cacheKey },
      update: { schemeCode: String(best.schemeCode), schemeName: best.schemeName, isin: isin ?? undefined },
      create: { key: cacheKey, schemeCode: String(best.schemeCode), schemeName: best.schemeName, isin: isin ?? null },
    });
    return { schemeCode: String(best.schemeCode), schemeName: best.schemeName };
  } catch (err) {
    console.error(`Scheme resolution failed for "${schemeName}":`, err);
    return null;
  }
}

/** Drop option suffixes that hurt the search ("- Growth Option" etc.). */
function cleanQuery(name: string): string {
  return name
    .replace(/\b(option|plan|payout|reinvestment)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickBestHit(hits: MfSearchHit[], query: string): MfSearchHit {
  const q = query.toLowerCase();
  const wantDirect = /\bdirect\b/.test(q);
  const wantRegular = /\bregular\b/.test(q);
  const wantIdcw = /\b(idcw|dividend)\b/.test(q);
  const wantGrowth = /\bgrowth\b/.test(q);

  const score = (h: MfSearchHit) => {
    const n = h.schemeName.toLowerCase();
    let s = 0;
    if (wantDirect && /\bdirect\b/.test(n)) s += 4;
    if (wantRegular && /\bregular\b/.test(n)) s += 4;
    if (wantDirect && /\bregular\b/.test(n)) s -= 3; // wrong plan
    if (wantRegular && /\bdirect\b/.test(n)) s -= 3;
    if (wantGrowth && /\bgrowth\b/.test(n)) s += 2;
    if (wantIdcw && /\b(idcw|dividend)\b/.test(n)) s += 2;
    if (wantGrowth && /\b(idcw|dividend)\b/.test(n)) s -= 2;
    return s;
  };
  return [...hits].sort((a, b) => score(b) - score(a))[0];
}

interface NavInfo {
  nav: number;
  date: string;
  fundHouse: string | null;
  category: string | null;
}

/** Latest NAV + metadata for an mfapi.in scheme code, cached for NAV_TTL_MS. */
async function getNav(schemeCode: string): Promise<NavInfo | null> {
  return fundCache.cached(`nav:${schemeCode}`, NAV_TTL_MS, async () => {
    const res = await fetchRetry(`https://api.mfapi.in/mf/${schemeCode}`);
    if (!res.ok) throw new Error(`mfapi ${res.status}`);
    const detail = (await res.json()) as MfDetail;
    const latest = detail.data?.[0];
    const nav = Number(latest?.nav);
    if (!Number.isFinite(nav)) throw new Error("no NAV");
    return {
      nav,
      date: latest.date ?? "",
      fundHouse: detail.meta?.fund_house ?? null,
      category: detail.meta?.scheme_category ?? null,
    };
  }).catch(() => null);
}

/**
 * Enrich fund holdings with live NAV and compute fund-level totals + AMC mix.
 * Pure over the FundHolding rows (+ the NAV provider).
 */
export async function computeFundMetrics(holdings: FundHolding[]): Promise<FundMetrics> {
  const enriched: EnrichedFund[] = await Promise.all(
    holdings.map(async (h) => {
      const invested = h.costValue ?? h.units * h.avgNav;
      let nav: number | null = null;
      let navDate: string | null = null;
      let category: string | null = null;
      let amc = h.amc ?? null;

      const resolved = h.schemeCode
        ? { schemeCode: h.schemeCode }
        : await resolveScheme(h.schemeName, h.isin);
      if (resolved) {
        const info = await getNav(resolved.schemeCode);
        if (info) {
          nav = info.nav;
          navDate = info.date;
          category = info.category;
          amc ??= info.fundHouse;
        }
      }

      const value = nav !== null ? h.units * nav : null;
      const pnl = value !== null ? value - invested : null;
      return {
        schemeName: h.schemeName,
        amc,
        folio: h.folio,
        isin: h.isin,
        category,
        units: h.units,
        avgNav: h.avgNav,
        invested,
        nav,
        navDate,
        value,
        pnl,
        pnlPct: pnl !== null && invested > 0 ? (pnl / invested) * 100 : null,
        weightPct: null,
      };
    }),
  );

  const eff = (f: EnrichedFund) => f.value ?? f.invested;
  const currentValue = enriched.reduce((s, f) => s + eff(f), 0);
  const invested = enriched.reduce((s, f) => s + f.invested, 0);
  for (const f of enriched) f.weightPct = currentValue > 0 ? (eff(f) / currentValue) * 100 : null;
  enriched.sort((a, b) => eff(b) - eff(a));

  const byAmc = new Map<string, number>();
  for (const f of enriched) byAmc.set(f.amc ?? "Other", (byAmc.get(f.amc ?? "Other") ?? 0) + eff(f));
  const amcAllocation = [...byAmc.entries()]
    .map(([label, value]) => ({ label, value, pct: currentValue > 0 ? (value / currentValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    totals: {
      invested,
      currentValue,
      pnl: currentValue - invested,
      pnlPct: invested > 0 ? ((currentValue - invested) / invested) * 100 : 0,
      count: enriched.length,
      pricedCount: enriched.filter((f) => f.nav !== null).length,
    },
    funds: enriched,
    amcAllocation,
    asOf: new Date().toISOString(),
  };
}
