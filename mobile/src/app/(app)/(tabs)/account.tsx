import Constants from 'expo-constants';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Muted, Row } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function AccountScreen() {
  const theme = useTheme();
  const { session, signOut } = useAuth();
  const user = session?.user;
  const location = session?.pharmacy?.locations.find((entry) => entry.id === (user?.outletId ?? 'HQ'))?.name ?? 'Head Office';

  function confirmSignOut(reason: 'switch' | 'out') {
    Alert.alert(reason === 'switch' ? 'Change pharmacy or location?' : 'Sign out?', reason === 'switch' ? 'You will sign in again and choose where to work.' : 'You will need your password to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: reason === 'switch' ? 'Continue' : 'Sign out', style: reason === 'out' ? 'destructive' : 'default', onPress: () => void signOut() },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '800' }}>{user?.name}</Text>
          <Muted>{user?.email || 'Staff account'}</Muted>
          <Row label="Role" value={session?.pharmacy?.role ?? user?.role ?? ''} />
          <Row label="Pharmacy" value={session?.pharmacy?.name ?? '—'} />
          <Row label="Location" value={location} />
          <Row label="Signed in until" value={session ? new Date(session.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'} />
        </Card>
        <Button label="Change pharmacy or location" tone="secondary" onPress={() => confirmSignOut('switch')} />
        <Button label="Sign out" tone="danger" onPress={() => confirmSignOut('out')} />
        <Muted style={{ textAlign: 'center' }}>PharmaERP {Constants.expoConfig?.version} · {API_URL.replace(/^https?:\/\//, '')}</Muted>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.four, gap: Spacing.four },
});
