import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/app-header';
import { BarList, MixBar } from '@/components/charts';
import { Banner, Card, Muted, Row, Stat } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { naira, todayWAT } from '@/lib/format';
import { useData } from '@/lib/use-data';

type Daily = {
  day: string; pharmacy: string; totalSales: number; transactions: number; financial: boolean;
  byOutlet: { id: string; name: string; revenue: number; invoices: number }[];
  byMethod: { method: string; amount: number; invoices: number }[];
  expenses: number | null; expenseLines: { category: string; count: number; amount: number }[]; grossProfit: number | null;
  topProducts: { name: string; quantity: number; revenue: number }[];
  lowStock: number; outOfStock: number; expiredBatches: number; expiredValue: number; nearExpiry: number;
};

const shift = (day: string, delta: number) => new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/** The daily pharmacy report (same figures as the web page and the WhatsApp summary). */
export default function ReportsScreen() {
  const theme = useTheme();
  const [day, setDay] = useState(() => shift(todayWAT(), -1));
  const report = useData<Daily>(`/api/reports/daily?date=${day}`);
  const data = report.data;
  const today = todayWAT();
  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={report.refreshing} onRefresh={() => void report.refresh()} colors={[theme.primary]} />}>
      <Card style={styles.dayRow}>
        <Pressable accessibilityLabel="Previous day" onPress={() => setDay(shift(day, -1))} hitSlop={10}><Icon name="chevron-left" size={30} color={theme.primary} /></Pressable>
        <View style={{ alignItems: 'center', flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 17, fontWeight: '800' }}>{new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</Text>
          <Muted>{data?.pharmacy ?? 'Daily report'} · all outlets</Muted>
        </View>
        <Pressable accessibilityLabel="Next day" disabled={day >= today} onPress={() => setDay(shift(day, 1))} hitSlop={10} style={{ opacity: day >= today ? 0.3 : 1 }}><Icon name="chevron-right" size={30} color={theme.primary} /></Pressable>
      </Card>
      {report.error ? <Banner tone="danger">{report.error}</Banner> : null}
      {report.loading || !data ? (report.loading ? <ActivityIndicator color={theme.primary} /> : null) : (
        <>
          <View style={styles.grid}>
            <Stat label="Total sales" value={naira(data.totalSales)} />
            <Stat label="Transactions" value={String(data.transactions)} />
            {data.financial ? <Stat label="Expenses" value={naira(data.expenses)} /> : null}
            {data.financial ? <Stat label="Gross profit" value={data.grossProfit === null ? 'n/a' : naira(data.grossProfit)} hint={data.grossProfit === null ? 'some costs missing' : undefined} /> : null}
          </View>
          <Card><Text style={[styles.title, { color: theme.text }]}>Sales by outlet</Text><BarList rows={data.byOutlet.map((row) => ({ name: row.name, value: row.revenue, note: `${row.invoices} sale(s)` }))} empty="No sales." /></Card>
          <Card><Text style={[styles.title, { color: theme.text }]}>Payments</Text><MixBar rows={data.byMethod.map((row) => ({ name: row.method, value: row.amount }))} /></Card>
          <Card><Text style={[styles.title, { color: theme.text }]}>Top-selling products</Text><BarList rows={data.topProducts.map((row) => ({ name: row.name, value: row.revenue, note: `${row.quantity} sold` }))} empty="No sales." /></Card>
          {data.financial && data.expenseLines.length ? <Card><Text style={[styles.title, { color: theme.text }]}>Expenses</Text>{data.expenseLines.map((row) => <Row key={row.category} label={`${row.category} (${row.count})`} value={naira(row.amount)} />)}</Card> : null}
          <Card>
            <Text style={[styles.title, { color: theme.text }]}>Stock and expiry (now)</Text>
            <Row label="Low-stock products" value={`${data.lowStock} (${data.outOfStock} out)`} />
            <Row label="Expired batches" value={`${data.expiredBatches} · ${naira(data.expiredValue)}`} />
            <Row label="Products nearing expiry" value={String(data.nearExpiry)} />
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  dayRow: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  title: { fontSize: 17, fontWeight: '800' },
});
