import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Banner, Card, Muted } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { periodRange, PERIODS, type Period } from '@/lib/dashboard';
import { naira } from '@/lib/format';
import { useData } from '@/lib/use-data';

type Sale = { id: string; number: string; date: string; customer: string; cashier: string; outlet: string; items: number; net: number; total: number; paymentLabel: string; status: string };
type History = { rows: Sale[]; totals: { transactions: number; net: number; returns: number; voided: number } };

/** Sales history for a period (cashiers see their own sales; the server decides). */
export default function SalesScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<Period>('today');
  const { from, to } = periodRange(period);
  const feed = useData<History>(`/api/sales?from=${from}&to=${to}`);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.top, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={styles.periods}>
          {PERIODS.map(([key, label]) => (
            <Pressable key={key} onPress={() => setPeriod(key)} style={[styles.chip, { backgroundColor: period === key ? theme.primary : theme.background, borderColor: period === key ? theme.primary : theme.border }]}>
              <Text style={{ color: period === key ? theme.onPrimary : theme.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {feed.data ? <Text style={{ color: theme.text, fontWeight: '700' }}>{feed.data.totals.transactions} sales · {naira(feed.data.totals.net)} net{feed.data.totals.voided ? ` · ${feed.data.totals.voided} voided` : ''}</Text> : null}
      </View>
      {feed.loading ? <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.primary} /> : (
        <FlatList
          data={feed.data?.rows ?? []}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} colors={[theme.primary]} />}
          ListHeaderComponent={feed.error ? <Banner tone="danger">{feed.error}</Banner> : undefined}
          ListEmptyComponent={<Card><Muted>No sales in this period.</Muted></Card>}
          renderItem={({ item }) => (
            <Card style={{ opacity: item.status === 'Voided' ? 0.6 : 1 }}>
              <View style={styles.row}>
                <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{item.number}</Text>
                <Text style={{ color: item.status === 'Voided' ? theme.danger : theme.text, fontWeight: '800', fontSize: 16 }}>{item.status === 'Voided' ? 'Voided' : naira(item.total)}</Text>
              </View>
              <Muted>{new Date(item.date).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {item.items} item(s) · {item.paymentLabel}</Muted>
              <Muted>{item.customer} · {item.cashier} · {item.outlet}</Muted>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  periods: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: Radius.large, paddingVertical: 8 },
  list: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
