import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, type TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Button, Card, Field, Muted } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { pendingSignIn } from '@/lib/pending-sign-in';

type InputHandle = React.ComponentRef<typeof TextInput>;

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, activate } = useAuth();
  const [mode, setMode] = useState<'email' | 'staff'>('email');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<InputHandle>(null);

  async function submit() {
    setError('');
    if (identifier.trim().length < 3 || password.length < 6) {
      setError(mode === 'email' ? 'Enter your email and password.' : 'Enter your staff ID and password.');
      return;
    }
    setBusy(true);
    try {
      const result = await signIn({ identifier: identifier.trim(), password });
      if (result.kind === 'choose-pharmacy') {
        pendingSignIn.set({ identifier: identifier.trim(), password, pharmacies: result.pharmacies, session: null });
        router.push('/choose');
        return;
      }
      const locations = result.session.pharmacy?.locations ?? [];
      if (locations.length > 1) {
        pendingSignIn.set({ identifier: identifier.trim(), password, pharmacies: result.session.pharmacy ? [result.session.pharmacy] : [], session: result.session });
        router.push('/choose');
        return;
      }
      await activate(result.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.hero, { backgroundColor: theme.primaryPressed }]}>
            <Image source={require('@/assets/images/pharmaerp-icon.png')} style={styles.logo} contentFit="contain" accessibilityLabel="PharmaERP" />
            <Text style={styles.heroTitle}>PharmaERP</Text>
            <Text style={styles.heroText}>Sales, stock and alerts for your pharmacy, in your pocket.</Text>
          </View>

          <Card style={styles.card}>
            <View style={[styles.segment, { backgroundColor: theme.background }]}>
              {(['email', 'staff'] as const).map((value) => (
                <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)} style={[styles.segmentItem, mode === value && { backgroundColor: theme.card }]}>
                  <Text style={{ color: mode === value ? theme.primary : theme.textSecondary, fontWeight: '700' }}>{value === 'email' ? 'Email' : 'Staff ID'}</Text>
                </Pressable>
              ))}
            </View>
            <Field
              label={mode === 'email' ? 'Email address' : 'Staff ID'}
              value={identifier}
              onChangeText={setIdentifier}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={mode === 'email' ? 'email-address' : 'default'}
              autoComplete={mode === 'email' ? 'email' : 'username'}
              textContentType={mode === 'email' ? 'emailAddress' : 'username'}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              placeholder={mode === 'email' ? 'you@pharmacy.ng' : 'e.g. STF-0012'}
            />
            <View>
              <Field ref={passwordRef} label="Password" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
              <Pressable accessibilityRole="button" onPress={() => setShowPassword((value) => !value)} style={styles.show} hitSlop={8}>
                <Text style={{ color: theme.primary, fontWeight: '600' }}>{showPassword ? 'Hide' : 'Show'}</Text>
              </Pressable>
            </View>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <Button label="Sign in" onPress={() => void submit()} busy={busy} />
            <Muted style={{ textAlign: 'center' }}>Forgot your password? Reset it on the PharmaERP website, or ask your pharmacy&apos;s Super Admin.</Muted>
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, padding: Spacing.four, gap: Spacing.four, justifyContent: 'center' },
  hero: { borderRadius: 24, padding: Spacing.five, alignItems: 'center', gap: Spacing.two },
  logo: { width: 72, height: 72, borderRadius: 18, backgroundColor: '#FFFFFF' },
  heroTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '800' },
  heroText: { color: '#D9F99D', fontSize: 15, textAlign: 'center' },
  card: { gap: Spacing.four },
  segment: { flexDirection: 'row', borderRadius: 12, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10 },
  show: { position: 'absolute', right: Spacing.four, bottom: 16 },
});
