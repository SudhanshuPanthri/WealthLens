"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Plus, X, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import type { WatchlistRow } from "@/app/api/watchlist/route";
import type { Exchange } from "@/lib/types";
import { formatINR, formatPct } from "@/lib/format";

const POLL_MS = 30_000;
type SearchHit = { symbol: string; exchange: Exchange; name: string | null };

export default function WatchlistView({ initialItems }: { initialItems: WatchlistRow[] }) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    const res = await fetch("/api/watchlist");
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items)) setItems(data.items);
    }
  }

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/stocks?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setHits(Array.isArray(data.results) ? data.results : []);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query]);

  const owned = new Set(items.map((i) => `${i.symbol}:${i.exchange}`));

  async function add(hit: SearchHit) {
    setAdding(`${hit.symbol}:${hit.exchange}`);
    try {
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hit),
      });
      setQuery("");
      setHits([]);
      await refresh();
    } finally {
      setAdding(null);
    }
  }

  async function remove(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="mt-1 text-sm text-muted">Track stocks you don&apos;t own yet. Live prices, auto-refreshing.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a stock to add (e.g. TATAMOTORS, HDFC Bank)…"
          className="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-10 text-sm outline-none focus:border-accent"
        />
        {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />}

        {hits.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-border bg-surface-2 shadow-xl">
            {hits.map((h) => {
              const key = `${h.symbol}:${h.exchange}`;
              const already = owned.has(key);
              return (
                <li key={key}>
                  <button
                    onClick={() => !already && add(h)}
                    disabled={already || adding === key}
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface disabled:opacity-50"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{h.symbol}</span>
                      <span className="ml-2 truncate text-xs text-muted">{h.name}</span>
                    </span>
                    <span className="ml-3 flex items-center gap-1 text-xs text-muted">
                      <span className="rounded bg-bg px-1.5 py-0.5">{h.exchange}</span>
                      {already ? "Added" : adding === key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-16 text-center text-muted">
          Your watchlist is empty. Search above to add a stock.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 text-left">Stock</th>
                <th className="px-4 py-2.5 text-right">Price</th>
                <th className="px-4 py-2.5 text-right">Day</th>
                <th className="px-4 py-2.5 text-right">52w range</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const up = (i.dayChangePct ?? 0) >= 0;
                return (
                  <tr key={i.id} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-3">
                      <a href={`/stock/${i.symbol}?exchange=${i.exchange}`} className="block">
                        <span className="font-semibold hover:text-accent">{i.symbol}</span>
                        <span className="block max-w-48 truncate text-xs text-muted">{i.name ?? i.exchange}</span>
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{formatINR(i.price, true)}</td>
                    <td className={`px-4 py-3 text-right font-mono ${up ? "text-gain" : "text-loss"}`}>
                      <span className="inline-flex items-center gap-0.5">
                        {i.dayChangePct !== null && (up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                        {formatPct(i.dayChangePct)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-muted">
                      {formatINR(i.low52, true)} – {formatINR(i.high52, true)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => remove(i.id)}
                        title="Remove"
                        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-loss"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
