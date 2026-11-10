"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const formatCurrency = (value: number | string | readonly (number | string)[] | undefined) => {
  const normalized = Array.isArray(value) ? value[0] : value;
  const numericValue = typeof normalized === "number" ? normalized : Number(normalized ?? 0);
  return `₦${numericValue.toLocaleString()}`;
};

export function SalesAreaChart({ data }: { data: { month: string; sales: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="salesColor" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#16803a" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#16803a" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
          <XAxis dataKey="month" stroke="#64748b" />
          <YAxis stroke="#64748b" tickFormatter={(value) => `₦${value / 1000}k`} />
          <Tooltip formatter={(value) => [formatCurrency(value), "Sales"]} />
          <Area type="monotone" dataKey="sales" stroke="#0f6b30" fill="url(#salesColor)" strokeWidth={3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function OutletBarChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" />
          <XAxis dataKey="name" stroke="#64748b" />
          <YAxis stroke="#64748b" tickFormatter={(value) => `₦${value / 1000}k`} />
          <Tooltip formatter={(value) => [formatCurrency(value), "Revenue"]} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#16803a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InventoryPieChart({ data }: { data: { name: string; value: number }[] }) {
  const colors = ["#0f6b30", "#16803a", "#45ad69", "#0ea5e9", "#f59e0b"];

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
            {data.map((entry, index) => (
              <Cell key={`${entry.name}-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [`${Number(value ?? 0)}%`, "Share"]} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
