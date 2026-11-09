import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Banner, Card, Muted } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/use-data';

type Alert = {
  id: string; type: 'LOW_STOCK' | 'EXPIRED' | 'NEAR_EXPIRY'; severity: 'critical' | 'warning' | 'info'; status: string; productName: string; batchNumber?: string; outletName: string; updatedAt: string;
  snapshot: { available: number; minStock?: number; expiryDate?: string; daysToExpiry?: number };
};
type Feed = { alerts: Alert[] };
type Filter = 'all' | 'out' | 'low' | 'expired' | 'near';

const FILTERS: [Filter, string][] = [['all', 'All'], ['out', 'Out of stock'], ['low', 'Low stock'], ['expired', 'Expired'], ['near', 'Near expiry']];

function matches(alert: Alert, filter: Filter) {
  if (filter === 'all') return true;
  if (filter === 'out') return alert.type === 'LOW_STOCK' && alert.snapshot.available <= 0;
  if (filter === 'low') return alert.type === 'LOW_STOCK' && alert.snapshot.available > 0;
  if (filter === 'expired') return alert.type === 'EXPIRED';
  return alert.type === 'NEAR_EXPIRY';
}

function describe(alert: Alert) {
  if (alert.type === 'LOW_STOCK') return alert.snapshot.available <= 0 ? `Out of stock (minimum ${alert.snapshot.minStock ?? '—'})` : `${alert.snapshot.available} left (minimum ${alert.snapshot.minStock ?? '—'})`;
  const batch = alert.batchNumber ? `Batch ${alert.batchNumber} · ` : '';
  if (alert.type === 'EXPIRED') return `${batch}expired ${alert.snapshot.expiryDate ?? ''} · ${alert.snapshot.available} units`;
  return `${batch}expires ${alert.snapshot.expiryDate ?? ''} (${alert.snapshot.daysToExpiry ?? '?'} days) · ${alert.snapshot.available} units`;
}

export default function AlertsScreen() {
  const theme = useTheme();
  const { can } = useAuth();
  const allowed = can('alerts.view');
  const feed = useData<Feed>(allowed ? '/api/alerts' : null);
  const [filter, setFilter] = useState<Filter>('all');
  const rows = useMemo(() => (feed.data?.alerts ?? []).filter((alert) => alert.status !== 'RESOLVED' && matches(alert, filter)), [feed.data, filter]);
  const tone = (alert: Alert) => (alert.severity === 'critical' ? theme.danger : alert.severity === 'warning' ? theme.warning : theme.textSecondary);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={styles.top}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTERS}
          keyExtractor={([key]) => key}
          contentContainerStyle={{ gap: Spacing.two }}
          renderItem={({ item: [key, label] }) => (
            <Pressable accessibilityRole="tab" accessibilityState={{ selected: filter === key }} onPress={() => setFilter(key)} style={[styles.chip, { backgroundColor: filter === key ? theme.primary : theme.card, borderColor: filter === key ? theme.primary : theme.border }]}>
              <Text style={{ color: filter === key ? theme.onPrimary : theme.text, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          )}
        />
      </View>
      {!allowed ? <View style={styles.pad}><Card><Muted>Your role does not include stock alerts.</Muted></Card></View> : feed.loading ? <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.primary} /> : (
        <FlatList
          data={rows}
          keyExtractor={(alert) => alert.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} colors={[theme.primary]} tintColor={theme.primary} />}
          ListHeaderComponent={feed.error ? <Banner tone="danger">{feed.error}</Banner> : undefined}
          ListEmptyComponent={<Card><Muted>No open alerts here. Pull down to refresh.</Muted></Card>}
          renderItem={({ item }) => (
            <Card style={{ borderLeftWidth: 4, borderLeftColor: tone(item) }}>
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{item.productName}</Text>
              <Text style={{ color: tone(item), fontSize: 14, fontWeight: '600' }}>{describe(item)}</Text>
              <Muted>{item.outletName}</Muted>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: Spacing.four, paddingTop: Spacing.four, gap: Spacing.three },
  chip: { borderWidth: 1, borderRadius: Radius.large, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  list: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  pad: { padding: Spacing.four },
});
