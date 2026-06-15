"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/lib/metrics";
import { formatINR, BROKER_LABELS } from "@/lib/format";

const COLORS = [
  "#f59e0b", "#818cf8", "#f472b6", "#34d399", "#60a5fa",
  "#fb923c", "#a78bfa", "#facc15", "#2dd4bf", "#4fd1c5",
  "#f87171", "#94a3b8",
];

interface Props {
  sector: AllocationSlice[];
  broker: AllocationSlice[];
  concentration: { top1Pct: number; top3Pct: number; top5Pct: number; hhi: number };
}

export default function AllocationCharts({ sector, broker, concentration }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Donut title="By sector" slices={sector} />
      <Donut title="By broker" slices={broker.map((b) => ({ ...b, label: BROKER_LABELS[b.label] ?? b.label }))} />
      <div className="rounded-2xl border border-border bg-surface p-5">
        <h3 className="text-sm font-semibold">Concentration</h3>
        <dl className="mt-4 space-y-3">
          <Meter label="Largest holding" pct={concentration.top1Pct} warnAt={10} />
          <Meter label="Top 3 holdings" pct={concentration.top3Pct} warnAt={35} />
          <Meter label="Top 5 holdings" pct={concentration.top5Pct} warnAt={50} />
        </dl>
        <p className="mt-4 text-xs text-muted">
          Herfindahl index:{" "}
          <span className={`font-mono ${concentration.hhi > 1500 ? "text-warn" : "text-ink"}`}>
            {concentration.hhi}
          </span>{" "}
          {concentration.hhi > 2500 ? "(highly concentrated)" : concentration.hhi > 1500 ? "(concentrated)" : "(diversified)"}
        </p>
      </div>
    </div>
  );
}

function Donut({ title, slices }: { title: string; slices: AllocationSlice[] }) {
  const top = slices.slice(0, 11);
  const rest = slices.slice(11);
  const data = rest.length
    ? [...top, { label: "Others", value: rest.reduce((s, x) => s + x.value, 0), pct: rest.reduce((s, x) => s + x.pct, 0) }]
    : top;

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 flex items-center gap-4">
        <div className="h-40 w-40 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius={42} outerRadius={70} strokeWidth={0}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatINR(Number(value))}
                contentStyle={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--fg)",
                }}
                itemStyle={{ color: "var(--fg)" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {data.slice(0, 6).map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="truncate text-muted">{s.label}</span>
              <span className="ml-auto font-mono">{s.pct.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Meter({ label, pct, warnAt }: { label: string; pct: number; warnAt: number }) {
  const over = pct > warnAt;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <dt className="text-muted">{label}</dt>
        <dd className={`font-mono ${over ? "text-warn" : ""}`}>{pct.toFixed(1)}%</dd>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full ${over ? "bg-warn" : "bg-accent"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
