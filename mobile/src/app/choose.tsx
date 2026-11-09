import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Muted, Title } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth, type PharmacyChoice } from '@/lib/auth';
import { pendingSignIn } from '@/lib/pending-sign-in';

/** Step 2 of sign-in: the pharmacy (if the account has several) and the location to work at. */
export default function ChooseScreen() {
  const theme = useTheme();
  const { signIn, activate } = useAuth();
  const pending = pendingSignIn.get();
  const [pharmacy, setPharmacy] = useState<PharmacyChoice | null>(pending?.pharmacies.length === 1 ? pending.pharmacies[0] : null);
  const [location, setLocation] = useState<string | null>(pending?.session?.user.outletId ?? pending?.session?.pharmacy?.defaultLocationId ?? null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) router.replace('/sign-in');
    return () => {
      // Leaving sign-in (back button or finished): forget the password.
      pendingSignIn.clear();
    };
  }, [pending]);

  if (!pending) return null;

  function pickPharmacy(entry: PharmacyChoice) {
    setPharmacy(entry);
    setLocation(entry.defaultLocationId ?? entry.locations[0]?.id ?? null);
    setError('');
  }

  async function continueTo() {
    if (!pending || !pharmacy || !location) return;
    setBusy(true);
    setError('');
    try {
      const already = pending.session && pending.session.user.tenantId === pharmacy.tenantId && (pending.session.user.outletId ?? 'HQ') === location;
      if (already && pending.session) {
        await activate(pending.session);
      } else {
        const result = await signIn({ identifier: pending.identifier, password: pending.password, tenantId: pharmacy.tenantId, outletId: location });
        if (result.kind !== 'signed-in') throw new Error('Choose a pharmacy.');
        await activate(result.session);
      }
      pendingSignIn.clear();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  const option = (key: string, label: string, detail: string | null, selected: boolean, onPress: () => void) => (
    <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.option, { borderColor: selected ? theme.primary : theme.border, backgroundColor: theme.card }]}>
      <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.border }]}>{selected ? <View style={[styles.dot, { backgroundColor: theme.primary }]} /> : null}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.scroll}>
      {pending.pharmacies.length > 1 ? (
        <View style={styles.group}>
          <Title>Pharmacy</Title>
          {pending.pharmacies.map((entry) => option(entry.tenantId, entry.name, entry.role, pharmacy?.tenantId === entry.tenantId, () => pickPharmacy(entry)))}
        </View>
      ) : null}
      {pharmacy ? (
        <View style={styles.group}>
          <Title>Location</Title>
          <Muted>{pharmacy.name} · {pharmacy.role}</Muted>
          {pharmacy.locations.map((entry) => option(entry.id, entry.name, entry.id === pharmacy.defaultLocationId ? 'Your usual location' : null, location === entry.id, () => setLocation(entry.id)))}
        </View>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Button label="Continue" onPress={() => void continueTo()} busy={busy} disabled={!pharmacy || !location} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.four, gap: Spacing.five },
  group: { gap: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1.5, borderRadius: Radius.medium, padding: Spacing.four, minHeight: 60 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
