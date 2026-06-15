/**
 * Node.js-only server startup logic. Imported dynamically from
 * instrumentation.ts ONLY when NEXT_RUNTIME === "nodejs", so the Edge bundle
 * never sees the `node:dns` import (which the Edge runtime forbids).
 *
 * 1. Forces IPv4-first DNS resolution because some upstreams (e.g. api.mfapi.in)
 *    advertise an AAAA record whose IPv6 path stalls under concurrent connects,
 *    making Node's fetch (undici) time out even though the host is reachable
 *    over IPv4.
 * 2. Starts a background quote refresher so the QuoteCache (and market snapshot)
 *    stay warm even when no browser is open — the dashboard then paints instantly
 *    and prices aren't stale. Disable with BACKGROUND_REFRESH=off (e.g. on
 *    serverless, where the secret-protected /api/cron/refresh route is used
 *    instead). Single-instance only; see ARCHITECTURE Scaling.
 */
import dns from "node:dns";

export function start() {
  dns.setDefaultResultOrder("ipv4first");

  if (process.env.BACKGROUND_REFRESH === "off") return;

  // Guard against an empty string (Number("") === 0 → tight loop). Floor at 30s.
  const REFRESH_MS = Math.max(30_000, Number(process.env.QUOTE_REFRESH_MS) || 5 * 60 * 1000);
  const g = globalThis as typeof globalThis & { __wlRefreshTimer?: NodeJS.Timeout };
  if (g.__wlRefreshTimer) return; // survive dev hot-reloads without stacking timers

  const run = async () => {
    try {
      const { refreshAllQuotes, isMarketLikelyOpen } = await import("./lib/refresh");
      if (!isMarketLikelyOpen()) return;
      const r = await refreshAllQuotes();
      if (r.symbols > 0) console.log(`[refresh] updated ${r.refreshed}/${r.symbols} symbols`);
    } catch (err) {
      console.error("[refresh] background refresh failed:", err);
    }
  };

  // Warm shortly after boot, then on the interval.
  const warmup = setTimeout(run, 10_000);
  warmup.unref?.();
  g.__wlRefreshTimer = setInterval(run, REFRESH_MS);
  g.__wlRefreshTimer.unref?.(); // don't keep the process alive just for this
}
