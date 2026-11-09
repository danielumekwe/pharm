import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/app-header';
import { Banner, Button, Card, Muted, Row } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/use-data';

type Transfer = {
  id: string; reference: string; fromOutletId: string; toOutletId: string; status: string; createdAt: string; createdBy: string; notes?: string;
  lines: { productName: string; quantity: number; batchNumber?: string }[];
  history: { at: string; actor: string; action: string; note?: string }[];
};
type Outlets = Record<string, string>;

/** Which actions the server might accept in each status. It checks the person's permission and outlet. */
const NEXT: Record<string, [string, string][]> = {
  Draft: [['submit', 'Submit for approval'], ['cancel', 'Cancel']],
  'Pending approval': [['approve', 'Approve'], ['reject', 'Reject'], ['cancel', 'Cancel']],
  Approved: [['dispatch', 'Mark as dispatched'], ['cancel', 'Cancel']],
};

export default function TransfersScreen() {
  const theme = useTheme();
  const feed = useData<Transfer[]>('/api/transfers');
  const { session } = useAuth();
  const names: Outlets = Object.fromEntries((session?.pharmacy?.locations ?? []).map((row) => [row.id, row.name]));
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const name = (id: string) => names[id] ?? id;
  const tone = (status: string) => (['Received'].includes(status) ? theme.success : ['Cancelled', 'Rejected'].includes(status) ? theme.danger : theme.warning);

  async function act(transfer: Transfer, action: string) {
    const run = async (note?: string) => {
      setBusy(transfer.id);
      setError('');
      try {
        await api(`/api/transfers/${transfer.id}`, { method: 'PATCH', body: { action, ...(note ? { note } : {}) } });
        await feed.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update the transfer.');
      } finally {
        setBusy(null);
      }
    };
    if (action === 'reject') return Alert.alert('Reject transfer?', `${transfer.reference} will be rejected.`, [{ text: 'Back', style: 'cancel' }, { text: 'Reject', style: 'destructive', onPress: () => void run('Rejected from the mobile app') }]);
    if (action === 'cancel') return Alert.alert('Cancel transfer?', `${transfer.reference} will be cancelled.`, [{ text: 'Back', style: 'cancel' }, { text: 'Cancel transfer', style: 'destructive', onPress: () => void run() }]);
    return run();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {feed.loading ? <ActivityIndicator style={{ marginTop: Spacing.six }} color={theme.primary} /> : (
        <FlatList
          data={[...(feed.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
          keyExtractor={(row) => row.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={feed.refreshing} onRefresh={() => void feed.refresh()} colors={[theme.primary]} />}
          ListHeaderComponent={<>{feed.error ? <Banner tone="danger">{feed.error}</Banner> : null}{error ? <Banner tone="danger">{error}</Banner> : null}<Muted>Receiving with batch checks is done on the website for now.</Muted></>}
          ListEmptyComponent={<Card><Muted>No transfers.</Muted></Card>}
          renderItem={({ item }) => {
            const expanded = open === item.id;
            return (
              <Card>
                <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setOpen(expanded ? null : item.id)} style={{ gap: 4 }}>
                  <View style={styles.row}>
                    <Text style={{ color: theme.text, fontWeight: '800', fontSize: 15 }}>{item.reference}</Text>
                    <Text style={{ color: tone(item.status), fontWeight: '800', fontSize: 13 }}>{item.status}</Text>
                  </View>
                  <View style={styles.route}>
                    <Text style={{ color: theme.text, flexShrink: 1 }} numberOfLines={1}>{name(item.fromOutletId)}</Text>
                    <Icon name="arrow-right" size={16} color={theme.textSecondary} />
                    <Text style={{ color: theme.text, flexShrink: 1 }} numberOfLines={1}>{name(item.toOutletId)}</Text>
                  </View>
                  <Muted>{item.lines.length} item(s) · {new Date(item.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {item.createdBy}</Muted>
                </Pressable>
                {expanded ? (
                  <View style={{ gap: Spacing.two, marginTop: Spacing.two }}>
                    {item.lines.map((line, index) => <Row key={index} label={`${line.productName}${line.batchNumber ? ` · ${line.batchNumber}` : ''}`} value={String(line.quantity)} />)}
                    {item.notes ? <Muted>Note: {item.notes}</Muted> : null}
                    <Muted>History</Muted>
                    {item.history.slice(-5).map((entry, index) => <Muted key={index}>{new Date(entry.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {entry.actor}: {entry.action}{entry.note ? ` (${entry.note})` : ''}</Muted>)}
                    {(NEXT[item.status] ?? []).map(([action, label]) => <Button key={action} label={label} tone={action === 'reject' || action === 'cancel' ? 'danger' : action === 'approve' || action === 'dispatch' || action === 'submit' ? 'primary' : 'secondary'} busy={busy === item.id} onPress={() => void act(item, action)} />)}
                  </View>
                ) : null}
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
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  route: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
