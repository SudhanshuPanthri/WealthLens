/**
 * Tiny logging seam. Everything funnels through `logError` so a real monitor
 * (Sentry, Axiom, Datadog…) can be wired in one place via `setErrorReporter`
 * — e.g. in instrumentation.ts: setErrorReporter((s, e, m) => Sentry.captureException(e, ...)).
 */
export type ErrorReporter = (scope: string, error: unknown, meta?: Record<string, unknown>) => void;

let reporter: ErrorReporter | null = null;

export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

export function logError(scope: string, error: unknown, meta?: Record<string, unknown>): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[${scope}] ${detail}`, meta ?? "");
  try {
    reporter?.(scope, error, meta);
  } catch {
    // a broken reporter must never mask the original error
  }
}
