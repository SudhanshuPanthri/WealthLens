# Deploying WealthLens to Vercel

The app is configured for **Postgres (Neon)** + **Vercel**. SQLite (the old local
default) does not work on Vercel — its filesystem is ephemeral and read-only.

## 1. Create a Neon Postgres database

1. Sign up at [neon.tech](https://neon.tech) and create a project (region close to
   your Vercel region).
2. From **Connection Details**, copy two strings:
   - **Pooled** (host contains `-pooler`) → this is `DATABASE_URL`
   - **Direct** (no `-pooler`) → this is `DIRECT_URL`
   Both should end with `?sslmode=require`.

## 2. Initialize the schema (run once, locally)

Put both URLs in your local `.env`, then create and apply the first migration:

```bash
# .env now has DATABASE_URL (pooled) and DIRECT_URL (direct)
npx prisma migrate dev --name init   # creates prisma/migrations/ and the tables in Neon
git add prisma/migrations && git commit -m "Add initial Postgres migration" && git push
```

This migration folder is what Vercel's build replays with `prisma migrate deploy`.
(Your local dev now also uses Neon — `npm run dev` reads the same `.env`.)

## 3. Import the repo on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import
   `SudhanshuPanthri/WealthLens`. Framework preset: **Next.js** (auto-detected).
   Leave the build command as the default — `package.json` already runs
   `prisma generate && prisma migrate deploy && next build`.
2. Add **Environment Variables** (Project → Settings → Environment Variables):

   | Variable | Value | Required |
   |---|---|---|
   | `DATABASE_URL` | Neon **pooled** string | ✅ |
   | `DIRECT_URL` | Neon **direct** string | ✅ |
   | `AUTH_SECRET` | a long random string (`openssl rand -base64 32`) | ✅ |
   | `APP_URL` | `https://<your-app>.vercel.app` (set after first deploy, then redeploy) | ✅ |
   | `BACKGROUND_REFRESH` | `off` (serverless has no long-lived timer) | ✅ |
   | `CRON_SECRET` | a random string (only if you add the cron in step 5) | ➖ |
   | `GEMINI_API_KEY` | free Gemini key for AI insights | ➖ |
   | `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY` | better AI engines | ➖ |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google" | ➖ |

   Insights work with **no** AI keys (rule-based engine).
3. Click **Deploy**.

## 4. Post-deploy

- Set `APP_URL` to the real `https://<app>.vercel.app` and **redeploy** (needed for
  correct OAuth redirect URIs).
- If using Google sign-in, add `<APP_URL>/api/auth/oauth/google/callback` to the
  authorized redirect URIs in Google Cloud Console.

## 5. (Optional) Scheduled quote refresh

`getQuotes` is cache-first per request, so the app works without a scheduler — this
just pre-warms the cache.

- **Vercel Pro:** add `vercel.json` with
  `{ "crons": [{ "path": "/api/cron/refresh", "schedule": "0 4 * * 1-5" }] }`.
  Vercel sends `Authorization: Bearer $CRON_SECRET` automatically, which the route
  checks. (Hobby plan limits cron frequency — daily is the safe ceiling.)
- **Any plan:** point a free external scheduler (e.g. cron-job.org) at
  `https://<app>.vercel.app/api/cron/refresh?secret=<CRON_SECRET>` every ~10 min
  during market hours.

## 6. (Optional) Tax-loss-harvesting reminder email

Emails users who opted in (tax page → "Email me a reminder") when they have a
worthwhile harvest before the 31-Mar deadline. Needs `RESEND_API_KEY` (see §
email) and `CRON_SECRET`. The route self-guards (only sends within 90 days of
the deadline and above ₹1,000 estimated saving), so a daily schedule is safe.

- **Vercel Pro:** add to `vercel.json` crons:
  `{ "path": "/api/cron/harvest-reminder", "schedule": "0 9 * * *" }`.
- **Any plan:** point a scheduler at
  `https://<app>.vercel.app/api/cron/harvest-reminder?secret=<CRON_SECRET>` once
  a day (most useful Jan–Mar).

## Notes

- The Prisma generator includes the `rhel-openssl-3.0.x` binary target Vercel needs.
- Future schema changes: `npx prisma migrate dev --name <change>` locally, commit the
  migration, push — Vercel's build applies it with `migrate deploy`.
