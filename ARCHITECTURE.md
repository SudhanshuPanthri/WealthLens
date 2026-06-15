# WealthLens — Architecture & Development Log

WealthLens is a multi-user web app that unifies your stock holdings from any
broker (Zerodha, Groww, or a generic CSV), prices them live, and runs an
AI-powered portfolio review (health score, concentration risks, red flags,
prioritized suggestions) using the Claude API.

This document covers the system architecture and the phased development that
produced it.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Next.js 16** (App Router, Turbopack, React 19) | Server components for data-heavy pages, route handlers for the API, one deployable. |
| Language | **TypeScript** (strict) | Type safety across the parser → metrics → insights pipeline. |
| DB / ORM | **Prisma 6** on **SQLite** (dev) | Zero-setup local DB; schema is Postgres-portable (see Scaling). |
| AI | Engine ladder: **rule-based** (no key) → **Google Gemini** (free tier) → **Anthropic Claude** | Insights work with zero keys and auto-upgrade as keys are added. |
| Auth | Self-hosted **OAuth 2.0** (Google) + email/password sessions | Multi-provider sign-in, no vendor lock-in, scales to paid on your own infra. |
| Market data | **yahoo-finance2** (quotes, indices, charts, profiles) + **mfapi.in** (fund NAV) | Free live data for NSE/BSE (`.NS` / `.BO`) and mutual funds. |
| File parsing | **papaparse** (CSV) + **exceljs** (XLSX) | Broker holdings & tradebook exports come as both. |
| Validation | **zod** | Request validation + LLM structured-output schema. |
| Auth | Cookie sessions + **bcryptjs** | Simple, self-contained multi-user auth. |
| UI | **Tailwind v4** + **Recharts** + **lucide-react** + **Geist** font | Light/dark finance dashboard (amber accent), donut/concentration/price charts. |

---

## 2. High-level flow

```
Broker export (CSV/XLSX)
        │  upload
        ▼
 /api/import/parse ──► parsers/ (auto-detect broker) ──► preview in UI
        │  confirm
        ▼
 /api/import/commit ──► resolveIsin() ──► Holding rows (Prisma)
        │
        ▼
   Dashboard (server component)
        │  computeMetrics()
        ▼
   getQuotes() ◄──► QuoteCache (10-min TTL) ◄──► Yahoo Finance
        │
        ▼
   /api/insights ──► generateInsights() ──► Claude (structured JSON) ──► Insight cache
```

---

## 3. Data model (`prisma/schema.prisma`)

- **User** → has many **Portfolio** (one created at signup) → has many **Holding**.
- **Session** — opaque token in an httpOnly cookie; 30-day expiry.
- **Holding** — one position, keyed unique on `(portfolioId, symbol, broker)` so
  the same stock at two brokers stays as two broker-tagged rows, and re-importing
  from the same broker **upserts** instead of duplicating.
- **ImportBatch** — audit record of each file import.
- **QuoteCache** — last-fetched price + fundamentals per Yahoo symbol (price TTL
  10 min; sector/industry backfilled and kept across price refreshes).
- **SymbolMap** — permanent ISIN → trading-symbol resolution cache (Groww gives
  only name + ISIN, so each ISIN is resolved against Yahoo search once).
- **Insight** — stored AI analysis (records which `engine` produced it), keyed by
  a **position snapshot hash** so re-opening the page reuses the analysis until
  holdings actually change.
- **OAuthAccount** — links a User to an external identity (e.g. Google) by
  `(provider, providerAccountId)`; a user can have several, all resolving to one
  account. `User.passwordHash` is nullable so OAuth-only users need no password.
- **WatchlistItem** — a tracked (not necessarily owned) stock, unique on
  `(portfolioId, symbol, exchange)`.
- **Transaction** — one executed buy/sell (`type`, `quantity`, `price`, `fees`,
  `tradedAt`). The ledger powers FIFO realized P&L, XIRR, and the invested-over-
  time chart, independent of the current-holdings view. `ImportBatch.kind`
  distinguishes `HOLDINGS` from `TRANSACTIONS` imports.

---

## 4. Key modules (`src/lib`)

| Module | Responsibility |
|---|---|
| `db.ts` | Singleton PrismaClient (avoids dev hot-reload connection leaks). |
| `auth.ts` | Password hashing, session create/clear, `getSessionUser()`, and `upsertOAuthUser()` (find/link/create from an OAuth profile). |
| `oauth.ts` | Self-hosted OAuth 2.0 layer: a `PROVIDERS` registry (Google now), authorize-URL building, code exchange, profile fetch, and `configuredProviders()` (drives which buttons the UI shows). Add a provider = one registry entry. |
| `parsers/` | `utils.ts` (CSV/XLSX → rows, header detection, number cleaning), holdings parsers per broker (`zerodha`, `groww`, `generic`), and **transaction parsers** (`transactions.ts`: Zerodha tradebook, **Zerodha Tax P&L statement**, generic tradebook). `index.ts` auto-detects format for both `parsePortfolioFile()` and `parseTransactionsFile()`. Adding a broker = one new parser + one line in `index.ts`. |
| `quotes.ts` | `getQuotes()` (cache-first batch fetch), `getStockDetail()` (quote + profile + price history for the detail page), `searchStocks()` (watchlist typeahead), `resolveIsin()`, `toYahooSymbol()`. |
| `market.ts` | Public homepage data: NSE/BSE indices, top movers per cap bucket, and mutual-fund NAV/returns (via free `mfapi.in`), through the shared `cache.ts` TTL store. `INDEX_REGISTRY` (slug↔symbol whitelist) + `getIndexDetail()` power the clickable index detail pages. |
| `metrics.ts` | `computeMetrics()` — enriches holdings with live data and derives totals, P&L, day change, sector/broker allocation, and concentration (top-1/3/5, Herfindahl index). Pure function over `Holding[]`. |
| `pnl.ts` | `computePnl()` — FIFO realized P&L, open positions valued live, an invested-over-time series, and `computeXirr()` (Newton-Raphson + bisection). Pure over `Transaction[]` (+ live quotes). |
| `analytics.ts` | **Cross-broker analytics.** `computeCrossBroker()` merges broker-tagged `Holding` rows into true per-stock positions → market-cap allocation (`CAP_TIERS`), real single-stock concentration, and the stocks split across brokers. `benchmarkVsNifty()` replays the user's exact buy/sell cashflows into the Nifty 50 (`^NSEI`) and compares money-weighted XIRR + alpha (reuses `computePnl`/`computeXirr`). |
| `tax.ts` | `computeTax()` — capital-gains intelligence over `Transaction[]`. FIFO-dates each disposal to classify **STCG vs LTCG** (Indian FY, 12-month rule), computes realized gains/tax per FY, tracks the **₹1.25L LTCG free allowance**, and surfaces three planning levers: **tax-loss harvesting**, **tax-free-LTCG to book**, and a **holding-period countdown** (STCG winners nearing the LTCG line). Rates/thresholds live in `TAX_RULES` (post-Jul-2024 regime; one place to update). |
| `refresh.ts` | `refreshAllQuotes()` warms the QuoteCache + market snapshot for every held/watchlisted symbol; `isMarketLikelyOpen()` gates off-hours. Driven by the boot timer and `/api/cron/refresh`. |
| `cache.ts` | `TTLCache` — single-instance TTL cache with serve-stale-on-failure; the swap point for a Redis-backed store. |
| `rate-limit.ts` | `rateLimit()` (fixed-window, per-user) + `Semaphore` (`llmQueue` bounds concurrent LLM calls). |
| `log.ts` | `logError()` + `setErrorReporter()` — one seam to wire a monitor (Sentry/Axiom/Datadog). |
| `insights/` | The AI engine, split into a shared `schema.ts` (zod schema, snapshot builder, system prompt), engines (`rules.ts`, `openrouter.ts`, `gemini.ts`, `claude.ts`), and `index.ts` (the dispatcher: picks the best available engine, caches, and degrades gracefully). |
| `format.ts` | INR / percent / P&L / crore formatting shared across the UI. |
| `instrumentation.ts` (`src/`) | Runs at server boot. `register()` is runtime-agnostic; Node-only work lives in `instrumentation-node.ts` (imported only when `NEXT_RUNTIME==="nodejs"`) — forces IPv4-first DNS and starts the background quote refresher (single-instance; disable with `BACKGROUND_REFRESH=off`). This split keeps the Edge bundle from compiling the forbidden `node:dns` import. |

### The insights engine (the core feature)

A **provider ladder** so insights always work and improve as keys are added.
`activeEngine()` picks the highest-quality engine whose credentials are present:

```
ANTHROPIC_API_KEY set ─► claude   (top quality)
else GEMINI_API_KEY set ─► gemini  (free tier)
else ───────────────────► rule-based  (no key, always available)
```

- All three emit the **same typed `InsightPayload`** — `healthScore`, `headline`,
  `summary`, `strengths`, `risks[]` (severity-ranked), `redFlags[]`,
  `diversification`, `suggestions[]` — so the UI is engine-agnostic. The
  `engine` used is stored and shown as a badge.
- **Rule-based** (`rules.ts`): a deterministic engine that derives the score and
  all sections from the metrics using Indian-market portfolio heuristics
  (single-stock >10–25%, top-5 >45–70%, HHI bands, sector tilt >30–45%, holding
  count, deep losers, rich P/E). Zero keys, zero cost, works offline.
- **Gemini** (`gemini.ts`): calls the `gemini-2.5-flash` REST API in JSON mode and
  validates the result against the zod schema (retries once).
- **Claude** (`claude.ts`): `claude-opus-4-8` with adaptive thinking + structured
  outputs (`messages.parse()` with the zod schema).
- All engines share one **system prompt** that encodes the same heuristics and
  forbids invented numbers or buy/sell advice. The snapshot sent is a
  **rounded, minimal JSON** view of the portfolio, not raw rows.
- **Graceful degradation:** if the chosen LLM engine fails (quota/network), the
  dispatcher falls back to the rule-based engine rather than erroring.
- **Caching:** keyed on a hash of positions (broker/symbol/qty/avg), so price
  jitter doesn't trigger regeneration; "Regenerate" forces a fresh run.

---

## 5. HTTP surface

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/signup` `/login` `/logout` | POST | Cookie-session auth (zod-validated; login is timing-safe). |
| `/api/auth/oauth/[provider]` | GET | Starts OAuth: sets a CSRF state cookie, redirects to the provider. |
| `/api/auth/oauth/[provider]/callback` | GET | Verifies state, exchanges code, provisions/links user, starts session. |
| `/api/import/parse` | POST | multipart upload → detect broker → return parsed preview (no DB write). |
| `/api/import/commit` | POST | Resolve symbols, merge dupes, upsert Holdings. |
| `/api/insights` | GET / POST | Fetch latest / generate insight. Per-user rate-limited; LLM calls run through a concurrency queue. `maxDuration=300`. |
| `/api/market` | GET | Public homepage snapshot (indices, movers, funds); server-cached. |
| `/api/portfolio` | GET | Live portfolio metrics for the dashboard's 30s poll. |
| `/api/stock/[symbol]` | GET | Live detail + price history for one stock (range param). |
| `/api/index/[slug]` | GET | Live detail + price history for one market index (slug validated against `INDEX_REGISTRY`). |
| `/api/search/stocks` | GET | Auth-gated NSE/BSE typeahead for the watchlist. |
| `/api/watchlist` | GET / POST / DELETE | List (live), add, remove watchlist stocks. |
| `/api/transactions` | GET | P&L summary + ledger; polled by the transactions page. |
| `/api/transactions/parse` `/commit` | POST | Tradebook **or P&L statement** upload → preview → idempotent commit (dedup key quantizes qty/price to absorb float round-trip). |
| `/api/tax` | GET | Capital-gains tax summary for a financial year (`?fy=`); polled by the tax page. |
| `/api/analytics` | GET | Cross-broker merged positions + market-cap allocation (holdings) and the Nifty 50 benchmark (transactions); polled by the analytics page for live prices. |
| `/api/cron/refresh` | GET | Secret-protected quote refresh for serverless schedulers. |

`proxy.ts` (Next 16's renamed middleware) is a fast cookie-presence gate that
redirects unauthenticated users away from the protected pages
(`/dashboard|/analytics|/import|/insights|/watchlist|/stock|/index|/transactions|/tax`) and
authenticated users away from `/login|/signup`. Real session validation (DB
lookup) happens in `getSessionUser()` in the app layout and every API route.

---

## 6. UI structure (`src/app`)

- `page.tsx` — public landing (redirects to dashboard if signed in); includes the
  live `MarketPanel` (indices, cap-bucket movers, mutual funds; auto-refreshes).
- `(auth)/login`, `(auth)/signup` — `AuthForm` client component with email/password
  plus a "Continue with Google" button (shown only when Google OAuth is configured).
- `(app)/layout.tsx` — auth-guarded shell with `Nav`; redirects to `/login` if no session.
- `(app)/dashboard` — `DashboardView` (client): live `IndicesStrip` (cards link
  to the index detail page), summary stat cards, `AllocationCharts`, sortable
  `HoldingsTable` (rows link to the stock page); polls `/api/portfolio` every 30s.
- `(app)/stock/[symbol]` — `StockDetailView`: price chart (1M/6M/1Y/5Y),
  fundamentals, company profile, add-to-watchlist toggle.
- `(app)/index/[slug]` — `IndexDetailView`: index price chart (1M/6M/1Y/5Y),
  day range, 52-week range, distance-from-high. Reached by clicking a dashboard index.
- `(app)/watchlist` — `WatchlistView`: typeahead add, live auto-refreshing rows, remove.
- `(app)/transactions` — `TransactionsView`: P&L stat cards (open invested,
  current value, unrealized, realized, XIRR), capital-over-time chart, positions
  and ledger tables, and the tradebook / P&L-statement import.
- `(app)/analytics` — `AnalyticsView`: the Nifty 50 benchmark hero (your XIRR vs
  Nifty + alpha), true cross-broker concentration, a "held across brokers" overlap
  card, market-cap + sector donuts, and the merged-positions table. Polls live.
- `(app)/tax` — `TaxView`: FY selector, realized STCG/LTCG + estimated-tax cards,
  the ₹1.25L LTCG-allowance meter, three harvesting panels (loss harvesting,
  tax-free-LTCG to book, almost-long-term countdown), and the realized-disposals table.
- `(app)/import` — `ImportFlow` (drag-drop → preview table → commit → result).
- `(app)/insights` — `InsightsView` (score dial, summary, red flags, strengths,
  diversification, severity-ranked risks, actionable suggestions).
- Theming: root `layout.tsx` sets the `.dark` class before paint (defaults dark);
  `ThemeToggle` flips light/dark and persists to `localStorage`. Colors are CSS
  variables (`:root` light, `.dark` dark) mapped to Tailwind tokens in `globals.css`.
- `error.tsx` / `global-error.tsx` / `not-found.tsx` provide themed error and 404 pages.

---

## 7. Development phases

**Phase 0 — Discovery & decisions.** Confirmed the build target with the user:
file-import-first (works for every broker, no paid APIs), Claude-powered
insights, multi-user product with accounts. Scaffolded a fresh Next.js 16 app
(the existing `portfolio/` dir was an unrelated site) and read the bundled
Next.js 16 docs for breaking changes (async `cookies()`/`params`, `proxy.ts`
replacing middleware, no implicit fetch caching).

**Phase 1 — Data & persistence.** Designed the Prisma schema (users, sessions,
portfolios, holdings, import batches, quote/symbol caches, insights). Pinned
Prisma 6 (Prisma 7 moved the datasource URL out of the schema). Created the
SQLite DB.

**Phase 2 — Import pipeline.** Built the file readers and broker-specific
parsers with header auto-detection, plus a generic CSV fallback. Each parser
emits a normalized `ParsedHolding[]`.

**Phase 3 — Market data & metrics.** Wrote the cache-first Yahoo quote layer,
ISIN→symbol resolution, and the pure `computeMetrics()` function (totals, P&L,
allocations, concentration).

**Phase 4 — AI insights engine.** Built the structured-output insights module on
the Claude SDK with snapshot caching and the Indian-market analysis prompt.

**Phase 5 — HTTP layer.** Auth routes, import parse/commit routes, insights
route, and the `proxy.ts` route gate.

**Phase 6 — UI.** Dark finance theme, landing + auth pages, the authenticated
shell, and the dashboard / import / insights screens with Recharts visuals.

**Phase 7 — Verification.** `tsc --noEmit` clean, production build green (13
routes). Smoke-tested end-to-end against the running server: signup, generic +
Zerodha + Groww parsing, commit with live pricing on the dashboard, the
no-API-key insights error path, and the proxy redirect.

### Phase 8 — OAuth, live-market homepage, and a free-AI insights ladder

A second build round driven by three follow-up requests:

**8a — Real multi-provider auth.** Added a self-hosted OAuth 2.0 layer
(`oauth.ts` + the two `/api/auth/oauth/[provider]` routes) on top of the existing
session system — "Continue with Google" now, extensible to more providers by
adding a registry entry. Chose self-hosted over a managed SDK (Clerk/Auth.js) to
avoid per-user pricing and vendor lock-in, and to avoid SDK/Next-16 compatibility
risk. Schema gained `OAuthAccount` and a nullable `passwordHash`. The Google
button only renders when `GOOGLE_CLIENT_ID/SECRET` are set; email/password stays.

**8b — Free-AI insights ladder.** Refactored the single Claude module into an
engine ladder (`rule-based` → `gemini` → `claude`) behind one dispatcher, so
insights work with **zero keys** today and auto-upgrade when a Gemini or Claude
key is added. Built the deterministic rule-based engine and the Gemini
(`gemini-2.5-flash`, JSON mode) engine; added graceful fallback and an engine
badge in the UI.

**8c — Homepage live-market panel.** `market.ts` + `/api/market` + the
`MarketPanel` client component: NSE/BSE indices (Nifty 50, Sensex, Nifty Bank,
Nifty IT), top movers across large/mid/small-cap buckets (curated lists ranked by
day change), and mutual-fund NAV/1-year returns via the free `mfapi.in`. Process-
level TTL caching; auto-refreshes each minute.

**8d — Verification & a real bug found.** Rebuilt green (16 routes) and
smoke-tested live: indices/movers/funds populated, login, rule-based insights
end-to-end (engine + score + risks), the OAuth config gate (unconfigured provider
→ clean redirect, not a crash), and the landing panel. Debugging empty funds
surfaced a genuine issue: Node's `fetch` (undici) **timed out on concurrent
connects to `api.mfapi.in`** over a broken IPv6 path, and the cache had pinned the
empty result. Fixed both — `src/instrumentation.ts` forces IPv4-first DNS at boot,
and `getFunds()` never caches an empty list (serves stale instead). Funds then
returned all five with live 1-year figures.

### Phase 9 — Stock pages, transactions/P&L, background refresh, hardening & re-theme

A product round expanding WealthLens from a single-portfolio dashboard into a
fuller analytics tool, plus production groundwork.

**9a — Stock detail pages & watchlist.** Added `getStockDetail()` (quote +
profile + daily-close history) and `searchStocks()` to `quotes.ts`; the
`/stock/[symbol]` page (`StockDetailView` with a range-switchable `PriceChart`,
fundamentals, and a watchlist toggle); the `WatchlistItem` model with
`/api/watchlist` (list/add/remove, IDOR-safe via portfolio-scoped deletes) and an
auth-gated `/api/search/stocks` typeahead; and a `/watchlist` page. Holdings rows
became clickable.

**9b — Transactions & P&L over time.** Added the `Transaction` model and a
tradebook parser (Zerodha Console + generic CSV, with a tolerant date parser);
`/api/transactions/parse` + `/commit` (ISIN resolution, idempotent re-import that
skips identical trades); and `pnl.ts` — FIFO realized P&L, live-valued open
positions, an invested-over-time series, and XIRR (Newton-Raphson with a
bisection fallback). The `/transactions` page shows stat cards, the capital
chart, positions, and the ledger. Verified against a hand-computed FIFO scenario.

**9c — Background quote refresh.** `refresh.ts` refreshes the QuoteCache and warms
the market snapshot for every held/watchlisted symbol. An in-process timer
(started in `instrumentation.ts`, market-hours-gated, survives dev hot-reloads,
`unref`'d) keeps data warm on a long-lived server; `BACKGROUND_REFRESH=off` plus
the secret-protected `/api/cron/refresh` covers serverless deploys.

**9d — Production hardening.** `cache.ts` (a `TTLCache` Redis swap-point that
`market.ts` now uses); `rate-limit.ts` (per-user fixed-window limiter +
`Semaphore` `llmQueue`) applied to insight generation (429 on abuse, bounded
concurrent LLM calls); `log.ts` (a `setErrorReporter` seam for Sentry/Axiom);
themed `error.tsx` / `global-error.tsx` / `not-found.tsx`; and documented Postgres
migration (provider swap + `migrate deploy`) and tuning env vars.

**9e — UI re-theme.** Adopted the `challan-check` look exactly: **Geist Sans +
Geist Mono**, and the `:root` / `.dark` / `@theme inline` CSS-variable structure
(warm-paper light theme, deep-navy dark theme, amber accent) with a persisted
light/dark `ThemeToggle` (defaults dark). Existing Tailwind token names are kept
as aliases over the new variables; charts use CSS variables so they follow the theme.

### Phase 10 — Tax intelligence, index detail, P&L-statement import

A differentiation round: the product's edge can't be "aggregation" (brokers show
their own holdings better) — it has to be things **no single broker will build**.

**10a — Capital-gains & tax intelligence (the flagship differentiator).** New
`tax.ts` engine + `/api/tax` + `/tax` page (`TaxView`). Brokers give a tax *record*;
this gives tax *planning*. It FIFO-dates every disposal to split **STCG/LTCG**,
computes realized gains + estimated tax per **financial year** (Apr–Mar), tracks
the **₹1.25L LTCG free allowance**, and surfaces three levers: **tax-loss
harvesting** (open losers that can offset realized gains), **tax-free LTCG to
book** (long-term winners that fit the remaining allowance), and a **holding-
period countdown** (short-term winners near the 12-month line, where waiting cuts
20%→12.5%). Rates/thresholds are isolated in `TAX_RULES`. Verified against the
imported Zerodha P&L: realized STCG **₹341.22**, tax **₹68.24** (= 341.22 × 20%).

**10b — Clickable index detail.** Dashboard indices were dead text; now each card
links to `/index/[slug]` (`IndexDetailView`) with a range-switchable chart, day
range, 52-week range, and distance-from-high. `INDEX_REGISTRY` doubles as the
slug↔symbol whitelist the route validates against (no arbitrary symbol fetch).

**10c — Zerodha P&L-statement import.** Beyond tradebooks, the importer now reads
the **Zerodha Tax P&L statement** (`parseZerodhaPnl`): it decomposes each
aggregated row into synthetic BUY/SELL transactions (realized leg + open leg),
dating buys to the statement start and sells to its end (with a warning that XIRR
is therefore an estimate). Found & fixed an **idempotency bug** in commit — the
dedup key embedded a raw float, but SQLite round-trips a computed `Float` to a
last-ULP-different double, so re-imports double-counted; the key now quantizes
qty/price to 4 dp.

**10d — Edge-runtime boot fix.** Split `instrumentation.ts` so Node-only startup
(`node:dns`, refresh timer) lives in `instrumentation-node.ts`, dynamically
imported only under the Node runtime — the Edge bundle was failing to compile on
the `node:dns` import.

### Phase 11 — cross-broker analytics

The second differentiation round (roadmap #1): the insights a single broker's app
*cannot* show because it only ever sees its own slice.

**11a — True cross-broker exposure.** `computeCrossBroker()` (in `analytics.ts`)
collapses the broker-tagged `Holding` rows — which the dashboard deliberately keeps
separate — into one real position per stock. This corrects a genuine blind spot:
holding RELIANCE at two brokers shows up as two sub-10% rows on the dashboard but is
one larger position in reality, so the dashboard *understates* concentration. The
analytics page recomputes top-1/3/5 + HHI on the merged set and calls out every
stock split across brokers with its combined weight.

**11b — Market-cap allocation.** A large/mid/small/unclassified donut from live
`marketCap`, using absolute INR bands in `CAP_TIERS` (a rough SEBI approximation;
the one place to retune). The dashboard had sector + broker allocation but no
cap-tier view.

**11c — XIRR vs Nifty 50 benchmark.** `benchmarkVsNifty()` answers "would I have
done better just buying the Nifty?" It replays the user's exact buy/sell cashflows
(same rupees, same dates) into the index — buying/selling Nifty units at each trade
date's close (`^NSEI` daily history, last-close-on-or-before) — then compares the
money-weighted XIRR and reports the alpha. The actual-side XIRR reuses `computePnl`
so it matches the transactions page exactly. Known limitation: heavy intra-period
trading can make the simulated terminal value diverge (sells are valued at the index
price, not the stock's), so XIRR is the headline and the UI disclaims the rest.

**11d — Verification.** `tsc` clean. Smoke-tested live end-to-end: Zerodha holdings
+ a generic second-broker CSV overlapping IDEA + a Zerodha tradebook → merge correct
(4 rows → 3 positions across 2 brokers, IDEA flagged), cap split 94.8/5.2%, HHI 6277,
benchmark XIRR 18.8% vs Nifty 2.6% (+16.2pp). Page returns 200; the proxy gate
redirects (307) unauthenticated. **MF look-through overlap was deferred** — funds
aren't imported as holdings and there's no free fund-constituent data source.

---

## 8. Running it

```bash
npm install
npx prisma db push          # create/sync the SQLite DB
# (optional) set GEMINI_API_KEY in .env for AI insights — works without it
npm run dev                 # http://localhost:3000
```

`.env` keys (all optional except the first two): `DATABASE_URL`, `AUTH_SECRET`,
`APP_URL`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`. Insights run on the rule-based engine with no keys at all;
add `GEMINI_API_KEY` (free) or `ANTHROPIC_API_KEY` to upgrade. Add the Google
OAuth pair to enable "Continue with Google" (redirect URI:
`<APP_URL>/api/auth/oauth/google/callback`).

---

## 9. Scaling & next steps

- **Postgres:** change the `datasource` provider to `postgresql`, point
  `DATABASE_URL` at the instance, and run `npx prisma migrate deploy` — the schema
  is already portable.
- **Shared cache (multi-instance):** the in-process `TTLCache` (`cache.ts`) and
  the `rate-limit.ts` window/semaphore are single-instance. Implement the same
  contracts against Redis to run multiple instances; every caller already routes
  through these modules.
- **Background refresh on serverless:** set `BACKGROUND_REFRESH=off` and point an
  external scheduler at `/api/cron/refresh` with `CRON_SECRET`.
- **Monitoring:** register a reporter via `setErrorReporter()` in
  `instrumentation.ts` to forward `logError()` calls to Sentry/Axiom/Datadog.
- **Live broker sync:** the parser layer is a connector interface; a Zerodha
  Kite Connect connector could populate the same `Holding`/`Transaction` rows
  without changing metrics/insights.
- **More OAuth providers:** add a registry entry in `oauth.ts` (GitHub, Apple…).
- **Next up (product differentiators, ranked):** Done so far — tax intelligence
  (Phase 10) and cross-broker analytics (Phase 11).
  1. **Mutual-fund look-through overlap** — the deferred slice of cross-broker
     analytics ("your real RELIANCE exposure across direct + 3 funds is 11%").
     Blocked on importing funds as holdings *and* on a fund-constituent data source
     (mfapi.in is NAV-only); index-fund baskets are a deterministic first cut.
  2. **CAS / MF Central import** — one-upload onboarding: NSDL/CDSL CAS for all
     demat holdings + CAMS/KFintech for all mutual funds (also unblocks #1).
  3. **Net worth + alerts** — manual FD/EPF/gold/real-estate entries for true net
     worth; price/drawdown/dividend alerts for daily-habit retention.
  4. Deepen tax: short/long-term **loss carry-forward & set-off** rules, debt/gold
     instrument classification, downloadable ITR-ready CG report.
  - Also open: scheduled insight pre-generation, dividends/corporate actions in
    P&L, per-stock news, and live broker sync (Kite Connect).

> AI output is generated analysis, **not** investment advice. Market data may be
> delayed. Consult a SEBI-registered advisor before acting.
