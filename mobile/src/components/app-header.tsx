import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/use-data';

export const Icon = MaterialCommunityIcons;
export type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export function initials(name: string | undefined) {
  return (name ?? '?').split(' ').filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

/** Top bar: menu, PharmaERP wordmark, alerts bell with the open-alert count, and the person's avatar. */
export function AppHeader({ openMenu, title }: { openMenu: () => void; title?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, can } = useAuth();
  const alerts = useData<{ summary: { unacknowledged: number } }>(can('alerts.view') ? '/api/alerts' : null);
  const count = alerts.data?.summary.unacknowledged ?? 0;
  return (
    <View style={[styles.bar, { paddingTop: insets.top + Spacing.two, backgroundColor: theme.card, borderBottomColor: theme.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open menu" onPress={openMenu} hitSlop={10} style={styles.iconButton}>
        <Icon name="menu" size={28} color={theme.text} />
      </Pressable>
      <View style={styles.brand}>
        <Image source={require('@/assets/images/pharmaerp-icon.png')} style={styles.logo} contentFit="contain" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.word, { color: theme.text }]}>Pharma<Text style={{ color: theme.primary }}>ERP</Text></Text>
          <Text style={[styles.tag, { color: theme.textSecondary }]} numberOfLines={1}>{title ?? session?.pharmacy?.name ?? 'Pharmacy'}</Text>
        </View>
      </View>
      {can('alerts.view') ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${count} open alerts`} onPress={() => router.navigate('/alerts')} hitSlop={8} style={styles.iconButton}>
          <Icon name="bell-outline" size={26} color={theme.text} />
          {count ? <View style={[styles.badge, { backgroundColor: theme.danger, borderColor: theme.card }]}><Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text></View> : null}
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="My account" onPress={() => router.navigate('/account')} style={styles.avatarRow} hitSlop={6}>
        <View style={[styles.avatar, { backgroundColor: theme.primary }]}><Text style={styles.avatarText}>{initials(session?.user.name)}</Text></View>
        <Icon name="chevron-down" size={20} color={theme.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingHorizontal: Spacing.four, paddingBottom: Spacing.three, borderBottomWidth: StyleSheet.hairlineWidth },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  logo: { width: 38, height: 38, borderRadius: 10 },
  word: { fontSize: 19, fontWeight: '800', letterSpacing: -0.3 },
  tag: { fontSize: 12, flexShrink: 1 },
  badge: { position: 'absolute', top: 0, right: -2, minWidth: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
