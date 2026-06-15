"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Sparkles, Loader2, RefreshCw, AlertTriangle, ShieldAlert,
  CheckCircle2, Lightbulb, ScatterChart,
} from "lucide-react";
import type { StoredInsight, InsightPayload, InsightEngine } from "@/lib/insights";

const ENGINE_META: Record<InsightEngine, { label: string; cls: string }> = {
  claude: { label: "Claude", cls: "border-accent/40 bg-accent/10 text-accent" },
  openrouter: { label: "OpenRouter", cls: "border-accent/40 bg-accent/10 text-accent" },
  gemini: { label: "Gemini", cls: "border-accent/40 bg-accent/10 text-accent" },
  "rule-based": { label: "Rule-based", cls: "border-border bg-surface-2 text-muted" },
};

function EngineBadge({ engine }: { engine: InsightEngine }) {
  const meta = ENGINE_META[engine] ?? ENGINE_META["rule-based"];
  return (
    <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>{meta.label}</span>
  );
}

const SEVERITY = {
  high: { label: "High", cls: "text-loss border-loss/40 bg-loss/10" },
  medium: { label: "Medium", cls: "text-warn border-warn/40 bg-warn/10" },
  low: { label: "Low", cls: "text-accent border-accent/40 bg-accent/10" },
} as const;

export default function InsightsView({
  initialInsight,
  holdingsCount,
}: {
  initialInsight: StoredInsight | null;
  holdingsCount: number;
}) {
  const [insight, setInsight] = useState<StoredInsight | null>(initialInsight);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate(force: boolean) {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Failed to generate insights.");
      setLoading(false);
      return;
    }
    setInsight(data.insight);
    setLoading(false);
  }

  if (holdingsCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface px-6 py-24 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-muted" />
        <h1 className="mt-6 text-2xl font-bold">No portfolio to analyze yet</h1>
        <p className="mt-2 text-muted">Import your holdings first, then come back for AI insights.</p>
        <Link href="/import" className="mt-8 inline-block rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90">
          Import holdings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-accent" /> AI Insights
            {insight && <EngineBadge engine={insight.engine} />}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {insight
              ? `Generated ${new Date(insight.createdAt).toLocaleString("en-IN")} · ${insight.model}`
              : "A rigorous, number-backed review of your portfolio."}
          </p>
        </div>
        {insight && (
          <button
            onClick={() => generate(true)}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Regenerate
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-loss/40 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {insight?.note && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {insight.note}
        </div>
      )}

      {!insight ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-20 text-center">
          {loading ? (
            <>
              <Loader2 className="mx-auto h-10 w-10 animate-spin text-accent" />
              <p className="mt-6 font-semibold">Analyzing your portfolio…</p>
              <p className="mt-1 text-sm text-muted">
                Claude is reviewing concentration, sector tilts, and per-stock risk. This can take
                up to a minute.
              </p>
            </>
          ) : (
            <>
              <Sparkles className="mx-auto h-10 w-10 text-accent" />
              <p className="mt-6 font-semibold">Ready when you are</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted">
                Run an AI review of your {holdingsCount} holdings — health score, risks, red flags,
                and prioritized suggestions.
              </p>
              <button
                onClick={() => generate(false)}
                className="mt-8 rounded-xl bg-accent px-6 py-3 font-semibold text-bg hover:opacity-90"
              >
                Generate insights
              </button>
            </>
          )}
        </div>
      ) : (
        <InsightReport payload={insight.payload} loading={loading} />
      )}
    </div>
  );
}

function InsightReport({ payload, loading }: { payload: InsightPayload; loading: boolean }) {
  return (
    <div className={`space-y-6 ${loading ? "opacity-50" : ""}`}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <ScoreDial score={payload.healthScore} />
        <div className="rounded-2xl border border-border bg-surface p-6 md:col-span-2">
          <h2 className="text-lg font-bold">{payload.headline}</h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
            {payload.summary}
          </p>
        </div>
      </div>

      {payload.redFlags.length > 0 && (
        <section className="rounded-2xl border border-loss/40 bg-loss/5 p-6">
          <h3 className="flex items-center gap-2 font-bold text-loss">
            <ShieldAlert className="h-5 w-5" /> Red flags
          </h3>
          <ul className="mt-3 space-y-2">
            {payload.redFlags.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-loss" />
                {f}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="flex items-center gap-2 font-bold">
            <CheckCircle2 className="h-5 w-5 text-gain" /> Strengths
          </h3>
          <ul className="mt-3 space-y-2">
            {payload.strengths.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gain" />
                {s}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6">
          <h3 className="flex items-center gap-2 font-bold">
            <ScatterChart className="h-5 w-5 text-accent" /> Diversification
          </h3>
          <p className="mt-3 text-sm font-semibold">{payload.diversification.verdict}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{payload.diversification.detail}</p>
        </section>
      </div>

      <section>
        <h3 className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-5 w-5 text-warn" /> Risks
        </h3>
        <div className="mt-3 space-y-3">
          {payload.risks.map((r, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center gap-2">
                <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${SEVERITY[r.severity].cls}`}>
                  {SEVERITY[r.severity].label}
                </span>
                <h4 className="font-semibold">{r.title}</h4>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{r.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="flex items-center gap-2 font-bold">
          <Lightbulb className="h-5 w-5 text-accent" /> Suggestions
        </h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {payload.suggestions.map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-surface p-4">
              <h4 className="font-semibold">{s.title}</h4>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.rationale}</p>
              <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="font-medium text-accent">Action: </span>
                {s.action}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const tone = score >= 70 ? "var(--color-gain)" : score >= 45 ? "var(--color-warn)" : "var(--color-loss)";
  const label = score >= 70 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk";
  const circumference = 2 * Math.PI * 52;
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-6">
      <div className="relative h-36 w-36">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--color-surface-2)" strokeWidth="10" />
          <circle
            cx="60" cy="60" r="52" fill="none" stroke={tone} strokeWidth="10" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-4xl font-bold">{score}</span>
          <span className="text-xs text-muted">/ 100</span>
        </div>
      </div>
      <p className="mt-3 font-semibold" style={{ color: tone }}>{label}</p>
      <p className="text-xs text-muted">Portfolio health</p>
    </div>
  );
}
