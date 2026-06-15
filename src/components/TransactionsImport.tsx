"use client";

import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";
import type { TransactionParseResult, ParsedTransaction } from "@/lib/types";
import { formatINR, formatQty } from "@/lib/format";

type Parsed = TransactionParseResult & { fileName: string };

type State =
  | { step: "idle" }
  | { step: "parsing" }
  | { step: "preview"; parsed: Parsed }
  | { step: "committing"; parsed: Parsed }
  | { step: "done"; imported: number; skipped: number; unresolved: string[] };

export default function TransactionsImport({ onDone }: { onDone?: () => void }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    setState({ step: "parsing" });
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/transactions/parse", { method: "POST", body: form });
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
    const res = await fetch("/api/transactions/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        broker: parsed.broker,
        fileName: parsed.fileName,
        transactions: parsed.transactions,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      setState({ step: "preview", parsed });
      return;
    }
    setState({
      step: "done",
      imported: data.imported,
      skipped: data.skipped ?? 0,
      unresolved: data.unresolved ?? [],
    });
    onDone?.();
  }

  if (state.step === "done") {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-gain" />
        <h3 className="mt-3 text-lg font-bold">{state.imported} trades imported</h3>
        {state.skipped > 0 && (
          <p className="mt-1 text-sm text-muted">{state.skipped} duplicate trade(s) skipped.</p>
        )}
        {state.unresolved.length > 0 && (
          <p className="mx-auto mt-2 max-w-md text-sm text-warn">
            Couldn&apos;t match {state.unresolved.length} stock(s): {state.unresolved.slice(0, 8).join(", ")}
          </p>
        )}
        <button
          onClick={() => setState({ step: "idle" })}
          className="mt-4 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2"
        >
          Import another tradebook
        </button>
      </div>
    );
  }

  if (state.step === "preview" || state.step === "committing") {
    const { parsed } = state;
    const buys = parsed.transactions.filter((t) => t.type === "BUY").length;
    const sells = parsed.transactions.length - buys;
    return (
      <div className="rounded-2xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-accent" />
            <div>
              <p className="text-sm font-semibold">{parsed.fileName}</p>
              <p className="text-xs text-muted">
                <span className="text-accent">{parsed.brokerLabel}</span> · {parsed.transactions.length} trades
                ({buys} buys, {sells} sells)
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
            {parsed.warnings.slice(0, 4).map((w, i) => (
              <p key={i} className="flex items-start gap-2 text-xs text-warn">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-5 py-2">Date</th>
                <th className="px-3 py-2">Stock</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-5 py-2 text-right">Price</th>
              </tr>
            </thead>
            <tbody>
              {parsed.transactions.slice(0, 200).map((t: ParsedTransaction, i: number) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-1.5 font-mono text-xs text-muted">{t.tradedAt}</td>
                  <td className="px-3 py-1.5 font-semibold">{t.symbol ?? t.name}</td>
                  <td className="px-3 py-1.5">
                    <span className={`text-xs font-medium ${t.type === "BUY" ? "text-gain" : "text-loss"}`}>
                      {t.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{formatQty(t.quantity)}</td>
                  <td className="px-5 py-1.5 text-right font-mono">{formatINR(t.price, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          {error ? <p className="text-sm text-loss">{error}</p> : <span className="text-xs text-muted">Duplicate trades are skipped automatically.</span>}
          <button
            onClick={() => commit(parsed)}
            disabled={state.step === "committing"}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-60"
          >
            {state.step === "committing" && <Loader2 className="h-4 w-4 animate-spin" />}
            {state.step === "committing" ? "Importing…" : `Import ${parsed.transactions.length} trades`}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
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
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/5" : "border-border bg-surface hover:border-accent/50"
        }`}
      >
        {state.step === "parsing" ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
            <p className="mt-3 text-sm text-muted">Reading tradebook…</p>
          </>
        ) : (
          <>
            <Upload className="h-7 w-7 text-muted" />
            <p className="mt-3 font-semibold">Drop your tradebook or P&L statement here</p>
            <p className="mt-1 text-sm text-muted">
              Zerodha Tradebook or P&L statement, or a CSV with date · symbol · type · quantity · price
            </p>
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
