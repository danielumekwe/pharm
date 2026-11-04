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
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe6" />
          <XAxis dataKey="month" stroke="#5a6a63" />
          <YAxis stroke="#5a6a63" tickFormatter={(value) => `₦${value / 1000}k`} />
          <Tooltip formatter={(value) => [formatCurrency(value), "Sales"]} />
          <Area type="monotone" dataKey="sales" stroke="#15803d" fill="url(#salesColor)" strokeWidth={3} />
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
          <CartesianGrid strokeDasharray="3 3" stroke="#e3ebe6" />
          <XAxis dataKey="name" stroke="#5a6a63" />
          <YAxis stroke="#5a6a63" tickFormatter={(value) => `₦${value / 1000}k`} />
          <Tooltip formatter={(value) => [formatCurrency(value), "Revenue"]} />
          <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#16a34a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function InventoryPieChart({ data }: { data: { name: string; value: number }[] }) {
  const colors = ["#15803d", "#16a34a", "#84cc16", "#0d9488", "#f59e0b"];

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
