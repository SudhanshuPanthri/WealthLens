"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ChartPoint } from "@/lib/quotes";

/** Daily-close area chart for a single stock. Color tracks gain/loss over range. */
export default function PriceChart({ data }: { data: ChartPoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted">
        No price history available.
      </div>
    );
  }
  const up = data[data.length - 1].close >= data[0].close;
  const color = up ? "var(--success)" : "var(--danger)";

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickFormatter={(d: string) => d.slice(2)}
          />
          <YAxis
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: "var(--muted)" }}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={(v: number) => `₹${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0)}`}
          />
          <Tooltip
            formatter={(value) => [`₹${Number(value).toFixed(2)}`, "Close"]}
            labelStyle={{ color: "var(--muted)" }}
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--fg)",
            }}
          />
          <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill="url(#priceFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
