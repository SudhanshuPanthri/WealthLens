"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { ParseResult, ParsedHolding } from "@/lib/types";
import { formatINR, formatQty } from "@/lib/format";

type Parsed = ParseResult & { fileName: string };

type State =
  | { step: "idle" }
  | { step: "parsing" }
  | { step: "preview"; parsed: Parsed }
  | { step: "committing"; parsed: Parsed }
  | { step: "done"; imported: number; unresolved: string[] };

export default function ImportFlow() {
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    setError(null);
    setState({ step: "parsing" });
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/import/parse", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to parse the file.");
      setState({ step: "idle" });
      return;
    }
    setState({ step: "preview", parsed: data as Parsed });
  }

  async function commit(parsed: Parsed) {
    setError(null);
    setState({ step: "committing", parsed });
    const res = await fetch("/api/import/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broker: parsed.broker,
        fileName: parsed.fileName,
        holdings: parsed.holdings,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      setState({ step: "preview", parsed });
      return;
    }
    setState({ step: "done", imported: data.imported, unresolved: data.unresolved ?? [] });
    router.refresh();
  }

  if (state.step === "done") {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-surface p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-gain" />
        <h2 className="mt-4 text-xl font-bold">{state.imported} holdings imported</h2>
        {state.unresolved.length > 0 && (
          <p className="mx-auto mt-2 max-w-md text-sm text-warn">
            Couldn&apos;t match {state.unresolved.length} stock(s) to a listed symbol:{" "}
            {state.unresolved.join(", ")}
          </p>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <a href="/dashboard" className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90">
            View dashboard
          </a>
          <button
            onClick={() => setState({ step: "idle" })}
            className="rounded-lg border border-border px-5 py-2.5 text-sm hover:bg-surface-2"
          >
            Import another file
          </button>
        </div>
      </div>
    );
  }

  if (state.step === "preview" || state.step === "committing") {
    const { parsed } = state;
    return (
      <div className="mt-8 rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-accent" />
            <div>
              <p className="text-sm font-semibold">{parsed.fileName}</p>
              <p className="text-xs text-muted">
                Detected: <span className="text-accent">{parsed.brokerLabel}</span> ·{" "}
                {parsed.holdings.length} holdings
              </p>
            </div>
          </div>
          <button
            onClick={() => setState({ step: "idle" })}
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink"
            disabled={state.step === "committing"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {parsed.warnings.length > 0 && (
          <div className="border-b border-border bg-warn/5 px-5 py-3">
            {parsed.warnings.slice(0, 5).map((w, i) => (
              <p key={i} className="flex items-start gap-2 text-xs text-warn">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2">Stock</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Avg price</th>
                <th className="px-5 py-2 text-right">Invested</th>
              </tr>
            </thead>
            <tbody>
              {parsed.holdings.map((h: ParsedHolding, i: number) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-2">
                    <span className="font-semibold">{h.symbol ?? h.name}</span>
                    {!h.symbol && (
                      <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-muted">
                        via ISIN
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatQty(h.quantity)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatINR(h.avgPrice, true)}</td>
                  <td className="px-5 py-2 text-right font-mono">{formatINR(h.quantity * h.avgPrice)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          {error ? <p className="text-sm text-loss">{error}</p> : <span />}
          <button
            onClick={() => commit(parsed)}
            disabled={state.step === "committing"}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-60"
          >
            {state.step === "committing" && <Loader2 className="h-4 w-4 animate-spin" />}
            {state.step === "committing" ? "Importing…" : `Import ${parsed.holdings.length} holdings`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-accent/50"
        }`}
      >
        {state.step === "parsing" ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="mt-4 text-sm text-muted">Reading file…</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-muted" />
            <p className="mt-4 font-semibold">Drop your holdings file here</p>
            <p className="mt-1 text-sm text-muted">or click to browse — CSV or XLSX, up to 5 MB</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-3 text-sm text-loss">{error}</p>}
    </div>
  );
}
