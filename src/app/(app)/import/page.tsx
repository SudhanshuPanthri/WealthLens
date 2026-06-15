import ImportFlow from "@/components/ImportFlow";

export const metadata = { title: "Import — WealthLens" };

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Import holdings</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a holdings export and WealthLens will detect the broker and merge it into your
        portfolio. Re-importing from the same broker updates your positions.
      </p>
      <ImportFlow />
      <div className="mt-10 rounded-2xl border border-border bg-surface p-6 text-sm">
        <h2 className="font-semibold">Where do I get the file?</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
          <li>
            <span className="text-ink">Zerodha</span> — console.zerodha.com → Portfolio →
            Holdings → download (CSV/XLSX), or the download icon on kite.zerodha.com → Holdings.
          </li>
          <li>
            <span className="text-ink">Groww</span> — app/web → Reports → Stock Reports →
            Holdings statement (XLSX).
          </li>
          <li>
            <span className="text-ink">Any other broker</span> — a CSV with columns:{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
              symbol, quantity, avg_price
            </code>{" "}
            (optional: exchange, isin, name).
          </li>
        </ul>
      </div>
    </div>
  );
}
