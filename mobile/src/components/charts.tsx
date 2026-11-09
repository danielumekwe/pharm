// Lightweight charts drawn with plain native views (fast on low-end phones, no extra native modules).
import { StyleSheet, Text, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { naira } from '@/lib/format';

const short = (value: number) => (value >= 1_000_000 ? `₦${(value / 1_000_000).toFixed(1)}m` : value >= 1_000 ? `₦${Math.round(value / 1_000)}k` : `₦${Math.round(value)}`);

/** Vertical bars over time, e.g. daily net sales. The highest bar is labelled. */
export function TrendBars({ points, height = 150 }: { points: { label: string; value: number }[]; height?: number }) {
  const theme = useTheme();
  const max = Math.max(1, ...points.map((point) => point.value));
  const peak = points.reduce((best, point, index) => (point.value > (points[best]?.value ?? -1) ? index : best), 0);
  const every = Math.max(1, Math.ceil(points.length / 6));
  if (!points.length) return <Text style={{ color: theme.textSecondary }}>No sales in this period.</Text>;
  return (
    <View accessible accessibilityLabel={`Sales trend, highest ${naira(points[peak]?.value)} on ${points[peak]?.label}`}>
      <View style={[styles.bars, { height }]}>
        {points.map((point, index) => (
          <View key={`${point.label}-${index}`} style={styles.barSlot}>
            {index === peak && point.value > 0 ? <Text style={[styles.peak, { color: theme.text }]} numberOfLines={1}>{short(point.value)}</Text> : null}
            <View style={{ height: Math.max(2, (point.value / max) * (height - 18)), backgroundColor: index === peak ? theme.primary : theme.accent, borderRadius: 4, width: '100%' }} />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {points.map((point, index) => (
          <Text key={`${point.label}-axis-${index}`} style={[styles.axisLabel, { color: theme.textSecondary }]} numberOfLines={1}>{index % every === 0 ? point.label : ''}</Text>
        ))}
      </View>
    </View>
  );
}

/** Ranked horizontal bars, e.g. sales by outlet or top products. */
export function BarList({ rows, format = naira, empty = 'Nothing yet.' }: { rows: { name: string; value: number; note?: string }[]; format?: (value: number) => string; empty?: string }) {
  const theme = useTheme();
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (!rows.length) return <Text style={{ color: theme.textSecondary }}>{empty}</Text>;
  return (
    <View style={{ gap: Spacing.three }}>
      {rows.map((row, index) => (
        <View key={`${row.name}-${index}`} style={{ gap: 4 }}>
          <View style={styles.listHead}>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flexShrink: 1 }} numberOfLines={1}>{row.name}</Text>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{format(row.value)}</Text>
          </View>
          <View style={[styles.track, { backgroundColor: theme.background }]}>
            <View style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, height: '100%', borderRadius: 4, backgroundColor: index === 0 ? theme.primary : theme.accent }} />
          </View>
          {row.note ? <Text style={{ color: theme.textSecondary, fontSize: 12 }} numberOfLines={1}>{row.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const MIX_COLORS = ['#0D6A33', '#A3E635', '#38BDF8', '#F59E0B', '#A78BFA'];

/** One bar split by share, with a legend: e.g. cash / POS / transfer. */
export function MixBar({ rows }: { rows: { name: string; value: number }[] }) {
  const theme = useTheme();
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <Text style={{ color: theme.textSecondary }}>No payments in this period.</Text>;
  return (
    <View style={{ gap: Spacing.three }}>
      <View style={styles.mix}>
        {rows.map((row, index) => <View key={row.name} style={{ flex: row.value, backgroundColor: MIX_COLORS[index % MIX_COLORS.length] }} />)}
      </View>
      {rows.map((row, index) => (
        <View key={row.name} style={styles.legend}>
          <View style={[styles.swatch, { backgroundColor: MIX_COLORS[index % MIX_COLORS.length] }]} />
          <Text style={{ color: theme.text, flex: 1, fontSize: 14 }}>{row.name}</Text>
          <Text style={{ color: theme.textSecondary, fontSize: 13, marginRight: Spacing.two }}>{Math.round((row.value / total) * 100)}%</Text>
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{naira(row.value)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  peak: { fontSize: 10, fontWeight: '700', marginBottom: 2, width: 60, textAlign: 'center' },
  axis: { flexDirection: 'row', gap: 4, marginTop: 4 },
  axisLabel: { flex: 1, fontSize: 9, textAlign: 'center' },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  mix: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden' },
  legend: { flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 12, height: 12, borderRadius: 3, marginRight: Spacing.two },
});
