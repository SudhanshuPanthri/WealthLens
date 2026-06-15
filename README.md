# WealthLens

**Unify your investments across every Indian broker — then do the things your broker app won't.**

WealthLens imports your holdings and trades from any broker (Zerodha, Groww, or a
generic CSV), prices them live, and layers on analytics brokers don't offer: an
AI-powered portfolio review, full transaction history with FIFO P&L and XIRR, and
**capital-gains tax intelligence** (loss harvesting, the ₹1.25L LTCG allowance,
and holding-period planning).

> Built with Next.js 16, TypeScript, Prisma, and live NSE/BSE + mutual-fund data —
> no paid broker APIs required. Works fully offline-capable for AI insights (a
> rule-based engine needs zero API keys).

---

## ✨ Features

### 📥 Multi-broker import
- Auto-detects and parses **Zerodha**, **Groww**, and **generic CSV** holdings exports.
- Imports **tradebooks** and **Zerodha Tax P&L statements** for full trade history.
- ISIN → trading-symbol resolution, idempotent re-imports (no double-counting).

### 📊 Live portfolio dashboard
- Real-time NSE/BSE quotes; total value, P&L, day change.
- Sector / broker allocation and concentration analysis (top-1/3/5, Herfindahl index).
- Clickable holdings → **stock detail pages** (price chart, fundamentals, profile).
- Clickable market indices → **index detail pages** (Nifty 50, Sensex, Bank, IT).
- A live homepage market panel: indices, top movers, mutual-fund NAV/returns.

### 🤖 AI portfolio insights
- A **provider ladder** — works with **zero API keys** (deterministic rule-based
  engine) and auto-upgrades to **Gemini → OpenRouter → Claude** when keys are added.
- Health score, strengths, severity-ranked risks, red flags, and actionable
  suggestions — every engine emits the same typed payload.

### 💰 Transactions, P&L & tax
- FIFO **realized P&L**, live-valued open positions, invested-over-time chart, **XIRR**.
- **Capital-gains tax intelligence:** STCG/LTCG split and estimated tax per
  financial year, the **₹1.25L LTCG free-allowance** meter, **tax-loss
  harvesting**, **tax-free-LTCG-to-book** suggestions, and a **holding-period
  countdown** (short-term winners nearing the 12-month long-term line).

### 🔐 Accounts
- Self-hosted **OAuth 2.0** (Google) + email/password sessions. No vendor lock-in.

### 🎨 Polish
- Light/dark themes (Geist font, amber accent, persisted toggle), themed error/404
  pages, per-user rate limiting, and a background quote-refresh worker.

---

## 🧱 Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, React 19) |
| Language | TypeScript (strict) |
| Database | Prisma 6 + SQLite (dev) — **Postgres-portable** |
| Market data | `yahoo-finance2` (NSE/BSE quotes, charts, indices) + `mfapi.in` (fund NAV) |
| AI | rule-based → Gemini → OpenRouter → Claude (any/none) |
| Auth | Self-hosted OAuth 2.0 + cookie sessions (bcryptjs) |
| UI | Tailwind v4, Recharts, lucide-react, Geist |

---

## 🚀 Getting started

```bash
# 1. Install dependencies
npm install

# 2. Create the local database (SQLite)
npx prisma db push

# 3. Configure environment (copy the example and fill in what you want)
cp .env.example .env      # then edit — all keys are optional except DATABASE_URL & AUTH_SECRET

# 4. Run the dev server
npm run dev
```

Open **http://localhost:3000**, create an account, and import a broker export.

> A fresh clone has **no database** (it's git-ignored). Run `npx prisma db push`
> to create it. Stop the dev server first if `db push` reports a file lock.

### Environment variables

All optional except the first two. Insights work with **no keys** (rule-based engine).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma datasource (`file:./dev.db` for SQLite). |
| `AUTH_SECRET` | Signs session tokens — any long random string. |
| `APP_URL` | Base URL, used to build OAuth redirect URIs. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Enables "Continue with Google". Redirect URI: `<APP_URL>/api/auth/oauth/google/callback`. |
| `ANTHROPIC_API_KEY` | Use Claude for insights (highest quality). |
| `OPENROUTER_API_KEY` | Use OpenRouter (has free models). |
| `GEMINI_API_KEY` | Use Google Gemini (free tier). |
| `BACKGROUND_REFRESH` / `QUOTE_REFRESH_MS` | Tune the in-process quote refresher (`off` to disable). |
| `CRON_SECRET` | Protects `/api/cron/refresh` (required in production). |
| `LLM_CONCURRENCY` / `INSIGHTS_RATE_LIMIT` | Production tuning for AI generation. |

> **Never commit `.env`** — it's git-ignored. Secrets live only there.

---

## 📚 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — full system design, data model, module
  map, HTTP surface, and the phased development log.
- **[MEMORY.md](./MEMORY.md)** — project context, current state, and the roadmap.

---

## 🗺️ Roadmap

- **Cross-broker analytics** — unified allocation, mutual-fund overlap, XIRR vs Nifty.
- **CAS / MF Central import** — one upload for all demat holdings + all mutual funds.
- **Net worth + alerts** — FDs/EPF/gold/real estate; price & dividend alerts.
- **Deeper tax** — loss carry-forward & set-off, debt/gold classification, ITR-ready report.

---

## ⚠️ Disclaimer

WealthLens is for informational purposes only. AI output is **generated analysis**
and tax figures are **estimates** — **not** investment or tax advice. Market data
may be delayed. Tax rules are modelled for listed equity/equity funds (STT-paid)
under the post-July-2024 regime and may not fit your situation. Consult a
SEBI-registered advisor and a qualified tax professional before acting.

## 📄 License

Released under the MIT License — see [LICENSE](./LICENSE) if present, or add one
before publishing.
