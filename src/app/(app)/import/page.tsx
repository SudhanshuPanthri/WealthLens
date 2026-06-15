import ImportFlow from "@/components/ImportFlow";

export const metadata = { title: "Import — WealthLens" };

export default function ImportPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Import holdings &amp; funds</h1>
      <p className="mt-1 text-sm text-muted">
        Upload a broker holdings export, a mutual-fund CSV, or a CAMS/KFintech CAS — WealthLens
        detects the format and merges it into your portfolio. Re-importing updates your positions.
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
            <span className="text-ink">Mutual funds (CAS)</span> — a Consolidated Account
            Statement PDF from{" "}
            <span className="text-ink">camsonline.com</span> (CAS → Statement) or{" "}
            <span className="text-ink">MF Central</span>. These are password-protected — you&apos;ll
            be asked for the password.
          </li>
          <li>
            <span className="text-ink">Any other broker / fund house</span> — a stock CSV with{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">symbol, quantity, avg_price</code>,
            or a fund CSV with{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">scheme, units, invested</code>{" "}
            (optional: isin, folio, amc).
          </li>
        </ul>
      </div>
    </div>
  );
}
