import { ActivityIndicator, FlatList, Linking, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/app-header';
import { Banner, Button, Card, Muted } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_URL } from '@/lib/api';
import { useData } from '@/lib/use-data';

type Ticket = { id: string; number: number; subject: string; category: string; status: string; priority: string; createdBy: string; updatedAt: string; lastReplyBy: string | null };

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  OPEN: { label: 'Open', tone: 'warning' }, IN_PROGRESS: { label: 'In progress', tone: 'warning' }, WAITING_CUSTOMER: { label: 'Waiting for you', tone: 'warning' },
  RESOLVED: { label: 'Resolved', tone: 'success' }, CLOSED: { label: 'Closed', tone: 'muted' },
};

/** This pharmacy's support tickets with Web365 (the server shows each person only what they may see). */
export default function SupportScreen() {
  const theme = useTheme();
  const feed = useData<{ tickets: Ticket[] }>('/api/support/tickets');
  const tone = (status: string) => {
    const kind = STATUS[status]?.tone ?? 'muted';
    return kind === 'success' ? { fg: theme.success, bg: theme.successSoft } : kind === 'warning' ? { fg: theme.warning, bg: theme.warningSoft } : { fg: theme.textSecondary, bg: theme.background };
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {feed.loading ? <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.primary} /> : (
        <FlatList
          data={feed.data?.tickets ?? []}
          keyExtractor={(ticket) => ticket.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} colors={[theme.primary]} tintColor={theme.primary} />}
          ListHeaderComponent={
            <View style={{ gap: Spacing.three }}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.three }}>
                <View style={[styles.iconBox, { backgroundColor: theme.successSoft }]}><Icon name="headset" size={28} color={theme.primary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }}>Web365 support</Text>
                  <Muted>Raise and follow tickets with the PharmaERP team.</Muted>
                </View>
              </Card>
              <Button label="Open a new ticket on the website" tone="secondary" onPress={() => void Linking.openURL(`${API_URL}/support`)} />
              {feed.error ? <Banner tone="danger">{feed.error}</Banner> : null}
            </View>
          }
          ListEmptyComponent={<Card><Muted>No support tickets yet.</Muted></Card>}
          renderItem={({ item }) => {
            const colors = tone(item.status);
            return (
              <Card>
                <View style={styles.head}>
                  <Text style={{ color: theme.textSecondary, fontWeight: '700' }}>#{item.number}</Text>
                  <Text style={[styles.pill, { color: colors.fg, backgroundColor: colors.bg }]}>{STATUS[item.status]?.label ?? item.status}</Text>
                </View>
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }} numberOfLines={2}>{item.subject}</Text>
                <Muted>{item.category} · {item.createdBy} · updated {new Date(item.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</Muted>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.six },
  iconBox: { width: 52, height: 52, borderRadius: Radius.medium, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: { fontSize: 12, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' },
});
