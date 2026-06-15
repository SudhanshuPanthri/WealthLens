"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Surfaced in the browser console; server-side errors are logged via lib/log.
    console.error("Render error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <AlertTriangle className="h-10 w-10 text-warn" />
      <h1 className="mt-6 text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 max-w-md text-muted">
        An unexpected error occurred. You can retry, or head back to your dashboard.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Ref: {error.digest}</p>}
      <div className="mt-8 flex gap-3">
        <button
          onClick={reset}
          className="rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
        >
          Try again
        </button>
        <a href="/dashboard" className="rounded-xl border border-border px-6 py-3 hover:bg-surface-2">
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
