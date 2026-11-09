import Constants from 'expo-constants';
import { Redirect, router, usePathname } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader, Icon, type IconName } from '@/components/app-header';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

const RAIL = '#0A2E1A';
const RAIL_ACTIVE = '#12813C';

type Href = '/' | '/alerts' | '/support' | '/account' | '/pos' | '/sales' | '/products' | '/transfers' | '/reports';
type Item = { label: string; icon: IconName; href: Href; permission?: string[] };
const ITEMS: Item[] = [
  { label: 'Dashboard', icon: 'home-variant', href: '/' },
  { label: 'Point of sale', icon: 'cash-register', href: '/pos', permission: ['sales.create'] },
  { label: 'Sales', icon: 'receipt-text-outline', href: '/sales', permission: ['sales.view'] },
  { label: 'Products', icon: 'pill', href: '/products', permission: ['stock.levels', 'stock.view'] },
  { label: 'Stock alerts', icon: 'bell-alert', href: '/alerts', permission: ['alerts.view'] },
  { label: 'Transfers', icon: 'swap-horizontal', href: '/transfers', permission: ['stock.view'] },
  { label: 'Reports', icon: 'chart-box', href: '/reports', permission: ['reports.consolidated'] },
  { label: 'Support', icon: 'headset', href: '/support' },
  { label: 'Settings', icon: 'cog', href: '/account' },
];

/** Icon rail with every module (filtered by permission). Modules still to come say so when tapped. */
function Rail({ close }: { close: () => void }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { can } = useAuth();
  const open = (item: Item) => {
    close();
    router.navigate(item.href);
  };
  return (
    <View style={[styles.rail, { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.three }]}>
      <ScrollView contentContainerStyle={{ gap: Spacing.two, paddingHorizontal: Spacing.two }} showsVerticalScrollIndicator={false}>
        {ITEMS.filter((item) => !item.permission || item.permission.some((permission) => can(permission))).map((item) => {
          const active = item.href ? (item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)) : false;
          return (
            <Pressable key={item.label} accessibilityRole="menuitem" accessibilityState={{ selected: active }} onPress={() => open(item)} style={({ pressed }) => [styles.item, active && styles.itemActive, pressed && { opacity: 0.75 }]}>
              <Icon name={item.icon} size={28} color="#FFFFFF" />
              <Text style={[styles.label, { color: '#FFFFFF' }]} numberOfLines={2}>{item.label}</Text>
            </Pressable>
          );
        })}
        <View style={styles.divider} />
        <View style={styles.help}>
          <Icon name="headset" size={26} color="#D9F99D" />
          <Text style={styles.helpTitle}>Need help?</Text>
          <Pressable accessibilityRole="button" onPress={() => { close(); router.navigate('/support'); }} style={styles.helpButton}>
            <Text style={styles.helpButtonText}>Get help</Text>
          </Pressable>
        </View>
        <Text style={styles.version}>PharmaERP v{Constants.expoConfig?.version}</Text>
      </ScrollView>
    </View>
  );
}

export default function AppLayout() {
  const { session } = useAuth();
  // Second barrier next to Stack.Protected: never show the app without a session.
  if (!session) return <Redirect href="/sign-in" />;
  return (
    <Drawer
      drawerContent={(props) => <Rail close={() => props.navigation.closeDrawer()} />}
      screenOptions={{
        drawerType: 'slide',
        drawerStyle: { width: 128, backgroundColor: RAIL },
        overlayColor: 'rgba(0,0,0,0.25)',
        header: (props) => <AppHeader openMenu={() => props.navigation.openDrawer()} title={props.route.name === '(tabs)' ? undefined : props.options.title} />,
      }}>
      <Drawer.Screen name="(tabs)" />
      <Drawer.Screen name="pos" options={{ title: 'Point of sale' }} />
      <Drawer.Screen name="sales" options={{ title: 'Sales history' }} />
      <Drawer.Screen name="products" options={{ title: 'Products & stock' }} />
      <Drawer.Screen name="transfers" options={{ title: 'Transfers' }} />
      <Drawer.Screen name="reports" options={{ title: 'Daily report' }} />
    </Drawer>
  );
}

const styles = StyleSheet.create({
  rail: { flex: 1, backgroundColor: RAIL },
  item: { alignItems: 'center', gap: 4, paddingVertical: Spacing.three, paddingHorizontal: Spacing.one, borderRadius: 16 },
  itemActive: { backgroundColor: RAIL_ACTIVE },
  label: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: Spacing.two, marginHorizontal: Spacing.three },
  help: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: Spacing.three, alignItems: 'center', gap: 4 },
  helpTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  helpButton: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, marginTop: 4 },
  helpButtonText: { color: '#0A4D29', fontWeight: '800', fontSize: 12 },
  version: { color: '#8FB39D', fontSize: 10, textAlign: 'center', marginTop: Spacing.two },
});
