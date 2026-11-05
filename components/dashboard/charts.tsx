"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const naira = (value: unknown) => `₦${Math.round(Number(Array.isArray(value) ? value[0] : value ?? 0)).toLocaleString()}`;
const compact = (value: number) => (Math.abs(value) >= 1_000_000 ? `₦${(value / 1_000_000).toFixed(1)}m` : Math.abs(value) >= 1000 ? `₦${Math.round(value / 1000)}k` : `₦${value}`);

/** Net sales over time. */
export function TrendChart({ data, label = "Net sales", height = 260 }: { data: { label: string; value: number }[]; label?: string; height?: number }) {
  if (data.length === 0) return <p className="py-10 text-center text-sm text-slate-500">No sales in this period yet.</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" vertical={false} />
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={56} />
          <Tooltip formatter={(value) => [naira(value), label]} contentStyle={{ borderRadius: 12, borderColor: "#e5e9f0", fontSize: 12 }} />
          <Area type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2.5} fill="url(#trendFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const COLORS = ["#2563eb", "#0ea5e9", "#14b8a6", "#f59e0b", "#8b5cf6", "#64748b"];

/** Share of a total, e.g. payment methods. */
export function DonutChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <p className="py-10 text-center text-sm text-slate-500">No payments yet.</p>;
  return (
    <div className="grid items-center gap-4">
      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={44} outerRadius={70} paddingAngle={2} stroke="none">
              {data.map((row, index) => <Cell key={row.name} fill={COLORS[index % COLORS.length]} />)}
            </Pie>
            <Tooltip formatter={(value) => naira(value)} contentStyle={{ borderRadius: 12, borderColor: "#e5e9f0", fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-2 text-sm">
        {data.map((row, index) => (
          <li key={row.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[index % COLORS.length] }} />{row.name}</span>
            <span className="tabular-nums text-white">{naira(row.value)} <span className="text-xs text-slate-500">{Math.round((row.value / total) * 100)}%</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
