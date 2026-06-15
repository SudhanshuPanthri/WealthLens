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

---

## 3. Discussed but NOT yet built (the roadmap)

Ranked product differentiators (the user picked **Tax intelligence** first — done).
Build order proposed:

1. **Cross-broker analytics** — unified allocation across all brokers + funds,
   **mutual-fund overlap/concentration** ("your real RELIANCE exposure across
   direct + 3 funds is 11%"), **XIRR vs Nifty** benchmarking.
2. **CAS / MF Central import** — one-upload onboarding: NSDL/CDSL **CAS** (all
   demat holdings, any broker, one file) + CAMS/KFintech (all mutual funds).
3. **Net worth + alerts** — manual FD/EPF/gold/real-estate → true net worth;
   price/drawdown/dividend alerts for daily-habit retention.
4. **Deepen tax** — loss carry-forward & set-off rules, debt/gold instrument
   classification, downloadable ITR-ready capital-gains report.

Also previously offered (lower priority): scheduled insight pre-generation,
dividends/corporate actions in P&L, per-stock news, live broker sync (Kite Connect).

---

## 4. Where things live (quick map)

```
src/lib/         tax.ts  pnl.ts  metrics.ts  quotes.ts  market.ts
                 parsers/ (holdings + transactions incl. parseZerodhaPnl)
                 insights/ (rules|gemini|openrouter|claude + dispatcher)
                 cache.ts  rate-limit.ts  log.ts  format.ts  auth.ts  oauth.ts
src/app/api/     tax  transactions(+parse/commit)  stock/[symbol]  index/[slug]
                 watchlist  search/stocks  market  portfolio  insights
                 cron/refresh  auth/(login|signup|logout|oauth)
src/app/(app)/   dashboard  stock/[symbol]  index/[slug]  watchlist
                 transactions  tax  import  insights
src/components/  TaxView  IndexDetailView  StockDetailView  TransactionsView
                 IndicesStrip  DashboardView  Nav  ThemeToggle  PriceChart ...
src/instrumentation.ts + instrumentation-node.ts   (boot: DNS + refresh timer)
proxy.ts         auth gate (Next 16's renamed middleware)
prisma/schema.prisma   User Portfolio Holding Transaction WatchlistItem
                       ImportBatch QuoteCache SymbolMap Insight OAuthAccount Session
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
