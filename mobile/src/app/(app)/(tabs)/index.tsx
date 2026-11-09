import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/app-header';
import { BarList, MixBar, TrendBars } from '@/components/charts';
import { Banner, Card, Muted, Row } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { PERIODS, useDashboard, type Period } from '@/lib/dashboard';
import { greeting, naira } from '@/lib/format';


function SectionTitle({ icon, title, action, onAction }: { icon: IconName; title: string; action?: string; onAction?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionLeft}>
        <Icon name={icon} size={22} color={theme.primary} />
        <Text style={[styles.sectionTitle, { color: theme.text }]}>{title}</Text>
      </View>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text style={{ color: theme.primary, fontWeight: '700' }}>{action}</Text>
          <Icon name="arrow-right" size={18} color={theme.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Tile with an icon box, big number, label and arrow (the mockup's stat cards). */
function Tile({ icon, value, label, color, soft, onPress }: { icon: IconName; value: string; label: string; color: string; soft: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.tile, { backgroundColor: soft, borderColor: theme.border, opacity: pressed ? 0.8 : 1 }]}>
      <View style={[styles.tileIcon, { backgroundColor: theme.card }]}><Icon name={icon} size={26} color={color} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.tileValue, { color: theme.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13 }} numberOfLines={1}>{label}</Text>
      </View>
      {onPress ? <View style={[styles.chevron, { backgroundColor: theme.card }]}><Icon name="chevron-right" size={20} color={color} /></View> : null}
    </Pressable>
  );
}

function Action({ icon, label, color, soft, onPress }: { icon: IconName; label: string; color: string; soft: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: soft, opacity: pressed ? 0.8 : 1 }]}>
      <Icon name={icon} size={30} color={color} />
      <Text style={[styles.actionLabel, { color }]} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

export default function DashboardScreen() {
  const theme = useTheme();
  const { session, can } = useAuth();
  const [period, setPeriod] = useState<Period>('7d');
  const board = useDashboard(period);
  const user = session?.user;
  const locations = session?.pharmacy?.locations ?? [];
  const location = locations.find((entry) => entry.id === (user?.outletId ?? 'HQ'))?.name ?? 'Head Office';
  const outletCount = locations.filter((entry) => entry.id !== 'HQ').length;
  const periodLabel = PERIODS.find(([key]) => key === period)?.[1] ?? '';
  const palette = {
    green: { color: theme.primary, soft: theme.successSoft },
    amber: { color: theme.warning, soft: theme.warningSoft },
    red: { color: theme.danger, soft: theme.dangerSoft },
    blue: { color: '#0369A1', soft: theme.card === '#FFFFFF' ? '#E0F2FE' : '#0C2A3D' },
    violet: { color: '#7C3AED', soft: theme.card === '#FFFFFF' ? '#EDE9FE' : '#2A1E45' },
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={board.refreshing} onRefresh={() => void board.refresh()} colors={[theme.primary]} tintColor={theme.primary} />}>
      {/* Pharmacy card */}
      <Card style={styles.pharmacy}>
        <View style={[styles.storeIcon, { backgroundColor: theme.successSoft }]}><Icon name="storefront" size={40} color={theme.primary} /></View>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={[styles.pharmacyName, { color: theme.text }]} numberOfLines={2}>{session?.pharmacy?.name ?? 'Your pharmacy'}</Text>
          <View style={styles.chips}>
            <View style={[styles.chip, { backgroundColor: theme.successSoft }]}><Icon name="check-circle" size={14} color={theme.success} /><Text style={[styles.chipText, { color: theme.success }]}>Active</Text></View>
            <View style={[styles.chip, { backgroundColor: palette.violet.soft }]}><Icon name="crown" size={14} color={palette.violet.color} /><Text style={[styles.chipText, { color: palette.violet.color }]} numberOfLines={1}>{session?.pharmacy?.role ?? user?.role}</Text></View>
          </View>
          <View style={styles.inline}><Icon name="map-marker-outline" size={16} color={theme.textSecondary} /><Muted>{location} · {greeting()}, {user?.name.split(' ')[0]}</Muted></View>
        </View>
      </Card>

      {board.error ? <Banner tone="danger">{board.error}</Banner> : null}

      {/* Stat tiles */}
      <View style={styles.tiles}>
        <Tile icon="storefront-outline" value={String(outletCount || 1)} label="Outlets" {...palette.blue} />
        {board.alerts ? (
          <>
            <Tile icon="package-variant" value={String(board.alerts.lowStock)} label="Low stock" {...palette.amber} onPress={() => router.navigate('/alerts')} />
            <Tile icon="package-variant-remove" value={String(board.alerts.outOfStock)} label="Out of stock" {...palette.red} onPress={() => router.navigate('/alerts')} />
            {board.alerts.showExpiry ? <Tile icon="calendar-alert" value={String(board.alerts.expiredBatches + board.alerts.nearExpiryProducts)} label="Expiry alerts" {...palette.violet} onPress={() => router.navigate('/alerts')} /> : null}
          </>
        ) : board.totals ? <Tile icon="receipt-text-outline" value={board.totals.transactions.toLocaleString('en-NG')} label="Transactions" {...palette.green} /> : null}
      </View>

      {/* Sales hero card */}
      {board.totals || board.loading ? (
        <View style={[styles.hero, { backgroundColor: theme.primaryPressed }]}>
          <View style={styles.heroGlow} />
          <View style={styles.heroTop}>
            <Icon name="chart-line-variant" size={34} color="#D9F99D" />
            <View style={{ flex: 1 }}>
              <Text style={styles.heroLabel}>Net sales · {periodLabel}</Text>
              {board.loading || !board.totals ? <ActivityIndicator color="#FFFFFF" style={{ alignSelf: 'flex-start', marginTop: 8 }} /> : <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>{naira(board.totals.net)}</Text>}
            </View>
            {board.totals ? <View style={styles.heroBadge}><Text style={styles.heroBadgeText}>{board.totals.transactions} sales</Text></View> : null}
          </View>
          {board.totals ? <Text style={styles.heroSub}>Average basket {naira(board.totals.avgBasket)} · returns {naira(board.totals.returns)}</Text> : null}
          <View style={styles.periods}>
            {PERIODS.map(([key, label]) => (
              <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: period === key }} onPress={() => setPeriod(key)} style={[styles.period, period === key ? styles.periodActive : styles.periodIdle]}>
                <Text style={{ color: period === key ? '#0A4D29' : '#FFFFFF', fontWeight: '700', fontSize: 12 }} numberOfLines={1}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Quick actions */}
      <Card>
        <SectionTitle icon="lightning-bolt" title="Quick actions" />
        <View style={styles.actions}>
          {can('sales.create') ? <Action icon="cash-register" label="New sale" {...palette.green} onPress={() => router.navigate('/pos')} /> : null}
          {can('alerts.view') ? <Action icon="bell-alert-outline" label="Stock alerts" {...palette.amber} onPress={() => router.navigate('/alerts')} /> : null}
          <Action icon="swap-horizontal" label="Transfers" {...palette.blue} onPress={() => router.navigate('/transfers')} />
          {can('reports.consolidated') ? <Action icon="file-chart-outline" label="Daily report" {...palette.violet} onPress={() => router.navigate('/reports')} /> : <Action icon="headset" label="Get support" {...palette.violet} onPress={() => router.navigate('/support')} />}
        </View>
      </Card>

      {board.totals ? (
        <>
          <Card><SectionTitle icon="chart-bar" title="Sales trend" /><Muted>Net sales per day · {board.from} to {board.to}</Muted><TrendBars points={board.trend} /></Card>
          <Card><SectionTitle icon="credit-card-outline" title="Payment mix" /><MixBar rows={board.paymentMix} /></Card>
          {board.byOutlet.length > 1 ? <Card><SectionTitle icon="store-outline" title="Sales by outlet" /><BarList rows={board.byOutlet} /></Card> : null}
          {board.topProducts ? <Card><SectionTitle icon="trophy-outline" title="Top-selling products" /><BarList rows={board.topProducts} empty="No sales in this period." /></Card> : null}
          {board.byCashier.length ? <Card><SectionTitle icon="account-group-outline" title="Sales by cashier" /><BarList rows={board.byCashier.slice(0, 6)} /></Card> : null}
        </>
      ) : null}

      {board.stock ? (
        <Card>
          <SectionTitle icon="warehouse" title="Stock position" action="Alerts" onAction={() => router.navigate('/alerts')} />
          <Row label="Stock value at cost" value={naira(board.stock.valueAtCost)} strong />
          <Row label="Stock value at retail" value={naira(board.stock.valueAtRetail)} />
          <Muted style={{ marginTop: Spacing.two }}>Below minimum ({board.stock.lowCount})</Muted>
          {board.stock.low.length ? board.stock.low.slice(0, 5).map((row) => <Row key={row.id} label={`${row.name} · ${row.outlet}`} value={`${row.stock} / ${row.minStock}`} />) : <Muted>Nothing below its minimum.</Muted>}
          <Muted style={{ marginTop: Spacing.two }}>Expiring within {board.stock.nearExpiryDays} days ({board.stock.expiringCount}) · expired {board.stock.expiredCount} ({naira(board.stock.expiredValue)})</Muted>
          {board.stock.expiring.slice(0, 5).map((row) => <Row key={row.id} label={`${row.product} · ${row.batchNumber}`} value={`${row.days} days`} />)}
        </Card>
      ) : null}

      {board.transfers && board.transfers.count ? (
        <Card>
          <SectionTitle icon="truck-delivery-outline" title={`Transfers in progress (${board.transfers.count})`} />
          {board.transfers.rows.map((row) => <Row key={row.id} label={`${row.reference} · ${row.from} → ${row.to}`} value={row.status} />)}
        </Card>
      ) : null}

      {/* Recent activity timeline */}
      {board.alerts?.recent.length ? (
        <Card>
          <SectionTitle icon="timeline-clock-outline" title="Recent activity" action="View all" onAction={() => router.navigate('/alerts')} />
          {board.alerts.recent.slice(0, 6).map((alert, index, list) => {
            const expired = alert.type === 'EXPIRED';
            const out = alert.type === 'LOW_STOCK' && alert.snapshot.available <= 0;
            const tone = expired || out ? palette.red : alert.type === 'NEAR_EXPIRY' ? palette.violet : palette.amber;
            const title = expired ? 'Expired batch' : out ? 'Out of stock' : alert.type === 'NEAR_EXPIRY' ? 'Nearing expiry' : 'Low stock';
            return (
              <View key={alert.id} style={styles.event}>
                <View style={styles.rail}>
                  <View style={[styles.eventIcon, { backgroundColor: tone.soft }]}><Icon name={expired ? 'calendar-remove' : out ? 'package-variant-remove' : alert.type === 'NEAR_EXPIRY' ? 'calendar-clock' : 'package-down'} size={20} color={tone.color} /></View>
                  {index < list.length - 1 ? <View style={[styles.line, { backgroundColor: theme.border }]} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: Spacing.three }}>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{title}: {alert.productName}</Text>
                  <Muted>{ago(alert.updatedAt)}</Muted>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {!board.loading && !board.totals && !board.alerts ? <Card><Muted>Your role has no dashboard figures yet.</Muted></Card> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.six },
  pharmacy: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four },
  storeIcon: { width: 76, height: 76, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pharmacyName: { fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 200 },
  chipText: { fontSize: 13, fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  tile: { flexGrow: 1, flexBasis: '46%', minHeight: 92, borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.large, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  tileIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileValue: { fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
  chevron: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  hero: { borderRadius: 24, padding: Spacing.five, gap: Spacing.three, overflow: 'hidden' },
  heroGlow: { position: 'absolute', right: -60, bottom: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(163,230,53,0.18)' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  heroLabel: { color: '#D9F99D', fontSize: 15, fontWeight: '600' },
  heroValue: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroBadge: { backgroundColor: '#D9F99D', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  heroBadgeText: { color: '#0A4D29', fontWeight: '800', fontSize: 12 },
  heroSub: { color: '#E6F4EA', fontSize: 14 },
  periods: { flexDirection: 'row', gap: 6 },
  period: { flex: 1, alignItems: 'center', borderRadius: 14, paddingHorizontal: 4, paddingVertical: 8, borderWidth: 1 },
  periodActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  periodIdle: { borderColor: 'rgba(255,255,255,0.5)' },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.one },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  action: { flexGrow: 1, flexBasis: '46%', minHeight: 96, borderRadius: Radius.large, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, padding: Spacing.three },
  actionLabel: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  event: { flexDirection: 'row', gap: Spacing.three },
  rail: { alignItems: 'center' },
  eventIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, marginVertical: 2 },
});
