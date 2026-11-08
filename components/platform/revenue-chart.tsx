"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { month: string; label: string; amount: number; payments: number };

/** Successful subscription payments per month (one series: the title names it, so no legend). */
export function RevenueChart({ data, currency }: { data: Point[]; currency: string }) {
  const money = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  const compact = (value: number) => new Intl.NumberFormat("en-NG", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  return (
    <div className="h-64 w-full" data-revenue-chart>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "#64748b", fontSize: 12 }} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} width={64} tick={{ fill: "#64748b", fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: "#94a3b8", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as Point;
              return (
                <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                  <p className="font-semibold">{point.month}</p>
                  <p>{money(point.amount)} · {point.payments} payment{point.payments === 1 ? "" : "s"}</p>
                </div>
              );
            }}
          />
          <Area type="monotone" dataKey="amount" stroke="#2563eb" strokeWidth={2} fill="url(#revenueFill)" dot={{ r: 4, fill: "#2563eb", stroke: "#ffffff", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "#ffffff", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
