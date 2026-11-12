"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { day: string; value: number; note?: string };

/**
 * One series per day (the chart's title names it, so there is no legend). Thin rounded bars on a recessive
 * grid, one axis, and a tooltip on hover. Used for coins, provider cost and revenue — each in its own chart.
 */
export function DailyBars({ data, format, label, color = "#16803a", height = 220 }: { data: Point[]; format: (value: number) => string; label: string; color?: string; height?: number }) {
  const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const empty = data.every((point) => point.value === 0);
  return (
    <figure className="w-full min-w-0" aria-label={label}>
      <div style={{ height }} className="w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 320, height }}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
            <CartesianGrid stroke="currentColor" strokeOpacity={0.12} vertical={false} />
            <XAxis dataKey="day" tickFormatter={short} tickLine={false} axisLine={false} minTickGap={16} tick={{ fill: "currentColor", fillOpacity: 0.6, fontSize: 11 }} />
            <YAxis tickFormatter={(value: number) => format(value)} tickLine={false} axisLine={false} width={64} tick={{ fill: "currentColor", fillOpacity: 0.6, fontSize: 11 }} allowDecimals />
            <Tooltip
              cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as Point;
                return (
                  <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg">
                    <p className="font-semibold">{new Date(`${point.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" })}</p>
                    <p>
                      {label}: {format(point.value)}
                      {point.note ? ` · ${point.note}` : ""}
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {empty ? <figcaption className="mt-1 text-xs opacity-60">No activity in this period.</figcaption> : null}
      {/* Table view of the same numbers, for screen readers. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.day}>
              <th scope="row">{point.day}</th>
              <td>{format(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
