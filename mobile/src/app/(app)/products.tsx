import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/app-header';
import { Banner, Card, Muted } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useData } from '@/lib/use-data';

type Level = { id: string; name: string; strength?: string; category: string; outlet: string; unit: string; available: number; packs: string; status: string; rxOnly: boolean; nextExpiry: string | null };
const FILTERS = ['All', 'In stock', 'Low stock', 'Out of stock'] as const;

/** Products and what is in stock, per outlet the person may see. */
export default function ProductsScreen() {
  const theme = useTheme();
  const feed = useData<Level[]>('/api/stock-levels');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (feed.data ?? []).filter((row) => (filter === 'All' || row.status === filter) && (!q || row.name.toLowerCase().includes(q) || row.category.toLowerCase().includes(q)));
  }, [feed.data, query, filter]);
  const tone = (status: string) => (status === 'Out of stock' ? theme.danger : status === 'Low stock' ? theme.warning : status === 'In stock' ? theme.success : theme.textSecondary);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={[styles.top, { backgroundColor: theme.card, borderBottomColor: theme.border }]}>
        <View style={[styles.search, { backgroundColor: theme.background, borderColor: theme.border }]}>
          <Icon name="magnify" size={22} color={theme.textSecondary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Search products or categories" placeholderTextColor={theme.textSecondary} style={{ flex: 1, color: theme.text, fontSize: 16, minHeight: 44 }} autoCorrect={false} />
        </View>
        <View style={styles.filters}>
          {FILTERS.map((key) => (
            <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, { backgroundColor: filter === key ? theme.primary : theme.background, borderColor: filter === key ? theme.primary : theme.border }]}>
              <Text style={{ color: filter === key ? theme.onPrimary : theme.text, fontWeight: '700', fontSize: 12 }} numberOfLines={1}>{key}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {feed.loading ? <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.primary} /> : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          initialNumToRender={15}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} colors={[theme.primary]} />}
          ListHeaderComponent={feed.error ? <Banner tone="danger">{feed.error}</Banner> : <Muted>{rows.length} product(s)</Muted>}
          ListEmptyComponent={<Card><Muted>No products match.</Muted></Card>}
          renderItem={({ item }) => (
            <Card style={styles.item}>
              <View style={[styles.pill, { backgroundColor: theme.successSoft }]}><Icon name="pill" size={22} color={theme.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }} numberOfLines={2}>{item.name}{item.strength ? ` ${item.strength}` : ''}{item.rxOnly ? '  ℞' : ''}</Text>
                <Muted>{item.category} · {item.outlet}{item.nextExpiry ? ` · exp ${item.nextExpiry}` : ''}</Muted>
                {item.packs ? <Muted>{item.packs}</Muted> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>{item.available}</Text>
                <Text style={{ color: tone(item.status), fontSize: 12, fontWeight: '700' }}>{item.status}</Text>
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { padding: Spacing.three, gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three },
  filters: { flexDirection: 'row', gap: 6 },
  chip: { flex: 1, alignItems: 'center', borderWidth: 1, borderRadius: Radius.large, paddingVertical: 7 },
  list: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  pill: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
