# WealthLens — Project Memory / Context Handoff

> Read this first when resuming work in a new session. It captures what the
> product is, what's built, what's been discussed but not built, and the
> non-obvious gotchas. For *how the code works*, see **ARCHITECTURE.md**.

---

## 1. What WealthLens is

A multi-user web app that unifies a user's stock + mutual-fund holdings from any
Indian broker (Zerodha, Groww, generic CSV), prices them live, and adds analytics
brokers don't offer: AI portfolio review, transactions & P&L, and **capital-gains
tax intelligence**. Stack: Next.js 16 (App Router, Turbopack, React 19),
TypeScript, Prisma 6 on SQLite (Postgres-portable), Tailwind v4, Recharts, Geist
font. Local dev at `http://localhost:3000`.

**Product positioning (decided with the user):** multi-broker *aggregation is
table stakes* — a user sees their holdings better in the broker's own app. The
moat is doing things **no single broker will build**: cross-broker analytics and
tax planning. Every new feature should pass the test *"impossible or unwanted on a
single broker site."*

---

## 2. Current state — what's BUILT and verified

Everything below is implemented, `tsc --noEmit` clean, and smoke-tested live.

### Core (Phases 0–8)
- File-import-first onboarding (no paid broker APIs). Holdings parsers: Zerodha,
  Groww, generic CSV.
- Live quotes via `yahoo-finance2` (NSE `.NS` / BSE `.BO`), fund NAV via free
  `mfapi.in`. Cache-first `QuoteCache`.
- Dashboard: metrics, P&L, day change, sector/broker allocation, concentration.
- **AI insights ladder** (`rule-based` → Gemini → OpenRouter → Claude): works with
  zero API keys, auto-upgrades when keys present. Same typed `InsightPayload` from
  every engine; snapshot-hash caching; graceful fallback.
- Self-hosted **OAuth 2.0** (Google) + email/password cookie sessions (bcryptjs).
- Live homepage market panel (indices, cap-bucket movers, funds).

### Phase 9 — analytics + hardening + theme
- **Stock detail pages** (`/stock/[symbol]`) — price chart (1M/6M/1Y/5Y),
  fundamentals, profile, watchlist toggle. Holdings rows link here.
- **Watchlist** (`/watchlist`) — typeahead add, live rows, remove.
- **Transactions & P&L** (`/transactions`) — tradebook import → FIFO realized P&L,
  live-valued open positions, invested-over-time chart, **XIRR**.
- **Background quote refresh** — in-process market-hours timer + secret-protected
  `/api/cron/refresh` for serverless.
- **Production hardening** — `TTLCache` (Redis swap-point), per-user rate limiting
  + LLM concurrency `Semaphore`, `setErrorReporter` monitoring seam, themed
  error/404 pages.
- **Theme** — Geist font + `challan-check` light/dark CSS-variable system, amber
  accent, persisted `ThemeToggle` (defaults dark).

### Phase 10 — the differentiation round (most recent work)
- **Capital-gains & tax intelligence** (`/tax`, `lib/tax.ts`, `/api/tax`) — THE
  flagship differentiator. FIFO-dates disposals → **STCG/LTCG** split, realized
  tax per **financial year** (Apr–Mar), **₹1.25L LTCG free-allowance** meter, and
  three planning levers: **tax-loss harvesting**, **tax-free-LTCG to book**,
  **holding-period countdown** (STCG winners near the 12-month line). Tax rates in
  `TAX_RULES` (post-Jul-2024: STCG 20%, LTCG 12.5% over ₹1.25L). Verified: imported
  Zerodha P&L → realized STCG ₹341.22, tax ₹68.24.
- **Clickable index detail** (`/index/[slug]`) — dashboard index cards now link to
  a detail page (chart + day/52w range). `INDEX_REGISTRY` is the slug↔symbol
  whitelist. (User-requested: "we cannot click Nifty to see more details".)
- **Zerodha P&L-statement import** — importer reads the Tax P&L statement (not just
  tradebooks); `parseZerodhaPnl` decomposes aggregated rows into synthetic
  BUY/SELL transactions (warns XIRR is an estimate since the statement has no
  per-trade dates).
- **Bug fixes:** commit idempotency (dedup key quantizes qty/price — SQLite floats
  round-trip lossily); Edge-runtime boot (split `instrumentation-node.ts` out so
  `node:dns` isn't in the Edge bundle).

### Phase 11 — cross-broker analytics (most recent work)
- **Cross-broker analytics** (`/analytics`, `lib/analytics.ts`, `/api/analytics`)
  — roadmap #1. Three pillars, all verified live:
  - **True cross-broker exposure** — `computeCrossBroker()` collapses broker-tagged
    `Holding` rows into one *real* position per stock (the dashboard keeps them as
    separate rows, which **understates** true concentration). Surfaces the
    merged-across-brokers position table, a "held across brokers" overlap callout
    ("your real IDEA exposure is X% across Zerodha + Other"), and **true** top-1/3/5
    + HHI computed on the merged positions.
  - **Market-cap allocation** — large/mid/small/unclassified donut from live
    `marketCap`. Absolute INR bands in `CAP_TIERS` (large ≥ ₹50,000 Cr, mid ≥
    ₹15,000 Cr) — a rough SEBI approximation; one place to retune. (Quirk: penny
    stocks with huge share counts, e.g. Vodafone Idea, can land in "Large cap" by
    absolute market cap — expected, not a bug.)
  - **XIRR vs Nifty 50 benchmark** — `benchmarkVsNifty()` replays the user's exact
    buy/sell cashflows (same ₹, same dates) into the Nifty index (`^NSEI` daily
    closes, last-close-on-or-before each trade), then compares **money-weighted
    XIRR** + alpha. Reuses `computeXirr` + `computePnl` from `pnl.ts` for the actual
    side so the figure matches the transactions page. Caveat: heavy intra-period
    trading can make the simulated terminal `niftyValue` diverge (sells valued at
    index, not stock, price) — XIRR is the honest headline; the UI disclaimer says so.
- Verified live (Zerodha holdings + a generic 2nd-broker CSV overlapping IDEA +
  a tradebook): merge correct (4 rows → 3 positions, 2 brokers), cap split 94.8/5.2,
  HHI 6277, benchmark XIRR 18.8% vs Nifty 2.6% (+16.2pp). `tsc` clean, page 200,
  auth gate 307. **MF overlap deferred** (see roadmap) — no fund holdings imported
  and no free fund-constituent data source.

### Phase 12 — mutual funds as a first-class asset + CAS import (most recent work)
- **Mutual funds + CAS / MF-Central import** — roadmap #2. The app's first non-stock
  asset class. New `FundHolding` + `FundSchemeMap` models, `lib/funds.ts`,
  `parsers/funds.ts`, a unified import dispatcher, and fund surfacing on the dashboard.
  - **Unified import** — `parseImportFile()` (in `parsers/index.ts`) is the new entry
    point: returns a discriminated `{kind:"HOLDINGS"|"FUNDS"}`. CSV/XLSX tries broker
    stock parsers → MF-CSV → generic stock; PDFs go to the CAS parser. The parse route
    routes funds to a new `/api/import/funds/commit` (holdings commit unchanged).
  - **MF CSV** (`parseFundsCsv`) — generic fund CSV: scheme + units (+ avg-NAV or
    invested; optional isin/folio/amc). **Fully verified live.**
  - **CAMS/KFintech CAS PDF** — `pdfToText()` (pdfjs-dist, password-aware) +
    `parseCamsCasText()` (pure text→funds, per-scheme blocks by ISIN, reads closing
    units / NAV / cost value). **Best-effort, no real sample tested** — the pure text
    parser is unit-verified against a synthetic CAMS blob; pdfToText is verified on a
    real PDF; only the encrypted-real-CAS composition is unproven. Password flow:
    `PdfPasswordError` → parse route returns `{needsPassword}` → UI prompts.
  - **Valuation** — `resolveScheme()` maps scheme name/ISIN → mfapi.in scheme code
    (cached in `FundSchemeMap`); `computeFundMetrics()` prices units at live NAV,
    derives P&L + AMC allocation. Dashboard now shows a combined **Net worth**
    (stocks + funds), a **Mutual funds** table, and handles funds-only portfolios.
- Verified live (MF CSV: PPFAS + UTI Nifty 50): parse→commit→NAV resolution→dashboard.
  Both schemes priced (UTI NAV 165.52, PPFAS 89.29), categories resolved, idempotent
  re-import (count stays 2), dashboard 200 funds-only, non-CAS PDF → clean 422. `tsc` clean.

### Phase 13 — deepen tax: loss set-off, carry-forward & ITR report (most recent work)
- **Loss set-off + carry-forward engine** (`lib/tax.ts`, `runSetOff()`) — the tax
  engine used to tax only positive gains; now it applies the real Indian rules across
  financial years: within-head netting, **current-year STCL → LTCG**, **brought-forward
  STCL → STCG (higher rate) then LTCG**, **LTCL → LTCG only**, **8-year carry-forward**
  (oldest used first, then expires; loss booked in FY Y lapses after FY Y+8). The
  ₹1.25L LTCG exemption now applies to taxable LTCG *after* set-off. `TaxSummary.realized`
  gained `netStcg`/`netLtcg`/`setOff`; new top-level `carryForward` ledger (by origin FY
  + expiry). `TaxView` shows a "Loss set-off & carry-forward" panel (shown only when
  there's set-off/carry-forward — hidden on a gains-only/empty FY).
- **CG report download was built then removed** — a per-broker, single-year CSV
  duplicated what the broker's own Tax P&L already gives. The *engine* (cross-broker
  consolidation + multi-year set-off/carry-forward) is the moat-aligned value, not the
  export; the on-screen set-off/carry-forward panel keeps that. If a CG export returns,
  it must foreground what a broker can't: consolidated-across-brokers + the carry-forward
  schedule (and not overclaim "ITR-ready" — no 31-Jan-2018 grandfathering / Schedule 112A).
- **Debt/gold classification deferred** — the tax engine runs off the *stock* transaction
  ledger (all equity, STT-paid); funds have no transaction ledger yet, so there's nothing
  to classify. Revisit when fund transactions exist.
- Verified: unit-tested `runSetOff` (STCL offsets STCG first, LTCL never touches STCG,
  8yr expiry 2023-24→2031-32) AND live (import 8 trades → `/api/tax?fy=2024-25`: bf STCL
  2000 + bf LTCL 2000, net 3000/1000, tax ₹600). Gains-only FYs unchanged (net=gross),
  so the earlier ₹68.24 verification still holds. `tsc` clean.

---

## 3. Discussed but NOT yet built (the roadmap)

Ranked product differentiators. Done: **Tax intelligence** (Phase 10),
**Cross-broker analytics** (Phase 11), **Mutual funds + CAS/MF import** (Phase 12),
**Deepen tax — loss set-off & carry-forward** (Phase 13). Remaining build order:

1. **Mutual-fund look-through overlap** — "your real RELIANCE exposure across direct
   + 3 funds is 11%." **Now half-unblocked:** fund holdings exist (Phase 12), so only
   the **fund-constituent data source** remains — mfapi.in gives NAV only. Needs a
   constituent dataset (AMC monthly portfolio disclosures, or deterministic index-fund
   baskets as a first cut) joined onto `FundHolding` to compute look-through exposure
   against `Holding`. This would extend the `/analytics` page.
2. **NSDL/CDSL demat CAS** — the other half of CAS import: all demat (stock/ETF)
   holdings across brokers in one PDF. The PDF pipeline (`pdfToText` + a CAS parser)
   exists; needs an NSDL/CDSL text parser emitting `HOLDINGS`. (Mostly overlaps the
   stock import; value is all-brokers-in-one-file.) **Validate Phase 12's CAMS parser
   against a real statement first** — it's untested on a real file.
3. **Net worth + alerts** — manual FD/EPF/gold/real-estate → true net worth (funds
   already counted); price/drawdown/dividend alerts for daily-habit retention.
4. **Deepen tax — debt/gold classification** (the remaining slice; set-off &
   carry-forward shipped in Phase 13). Needs instrument-type tagging +
   the post-Apr-2023 debt-fund rules (no LTCG benefit, slab rate). Blocked until funds
   have a transaction ledger — the tax engine is transaction-based and today's ledger
   is all equity.

Also previously offered (lower priority): scheduled insight pre-generation,
dividends/corporate actions in P&L, per-stock news, live broker sync (Kite Connect).

---

## 4. Where things live (quick map)

```
src/lib/         analytics.ts  funds.ts  tax.ts  pnl.ts  metrics.ts  quotes.ts
                 market.ts  parsers/ (holdings + transactions + funds; index.ts
                   exposes parseImportFile — the unified HOLDINGS|FUNDS dispatcher)
                 insights/ (rules|gemini|openrouter|claude + dispatcher)
                 cache.ts  rate-limit.ts  log.ts  format.ts  auth.ts  oauth.ts
src/app/api/     analytics  tax  transactions(+parse/commit)  stock/[symbol]
                 index/[slug]  watchlist  search/stocks  market  portfolio
                 import/(parse | commit | funds/commit)
                 insights  cron/refresh  auth/(login|signup|logout|oauth)
src/app/(app)/   dashboard  analytics  stock/[symbol]  index/[slug]  watchlist
                 transactions  tax  import  insights
src/components/  AnalyticsView  TaxView  FundsTable  IndexDetailView
                 StockDetailView  TransactionsView  DashboardView  ImportFlow
                 IndicesStrip  Nav  ThemeToggle ...
src/instrumentation.ts + instrumentation-node.ts   (boot: DNS + refresh timer)
proxy.ts         auth gate (Next 16's renamed middleware)
prisma/schema.prisma   User Portfolio Holding Transaction WatchlistItem FundHolding
                       FundSchemeMap ImportBatch QuoteCache SymbolMap Insight
                       OAuthAccount Session
ARCHITECTURE.md  full design + phase log
```

---

## 5. Dev environment gotchas (Windows)

- **Prisma is pinned to v6** — v7 moved the datasource URL out of the schema; do
  not upgrade without migrating.
- `npx prisma db push` fails with **EPERM** if the dev server is running (SQLite
  file lock) — stop node first.
- To restart the dev server: `Get-Process node | Stop-Process -Force`, then start
  via the Bash tool in background (`npm run dev`). `Start-Process npm
  -RedirectStandardOutput` has failed here ("%1 is not a valid Win32 application").
- **IPv4-first DNS** is forced at boot (`instrumentation-node.ts`) — undici/`fetch`
  stalls on `api.mfapi.in`'s broken IPv6 path otherwise.
- **`pdfjs-dist` must stay in `serverExternalPackages`** (`next.config.ts`) — if
  Turbopack bundles it, its runtime worker resolution fails ("Setting up fake worker
  failed … cannot find pdf.worker.mjs") and PDF parsing 500s. `pdfToText` dynamic-
  imports the legacy build (`pdfjs-dist/legacy/build/pdf.mjs`).
- `.env` holds all secrets (DB URL, AUTH_SECRET, Google OAuth, OpenRouter key, etc.)
  — never commit it; it is the only place secrets live. Insights work with no keys.
- Test accounts created during verification are cleaned up — none persist in the DB.

### Run it
```bash
npm install
npx prisma db push        # node stopped first
npm run dev               # http://localhost:3000
```

---

## 6. Verification habit

After changes: `npx tsc --noEmit` must be clean, then smoke-test live routes via
curl (signup → import a file → hit the relevant API) and confirm pages return 200.
The Zerodha P&L file used for tax verification:
`C:\Users\panth\Downloads\pnl-QRX866.xlsx` (realized total ₹341.22).

> AI output is generated analysis, tax figures are estimates — **not** investment
> or tax advice. Market data may be delayed.
