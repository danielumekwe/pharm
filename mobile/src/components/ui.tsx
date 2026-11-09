// Shared building blocks so every screen looks and behaves the same.
import type { ComponentRef, ReactNode, Ref } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.title, { color: theme.text }]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  const theme = useTheme();
  return <Text style={[styles.muted, { color: theme.textSecondary }, style]}>{children}</Text>;
}

export function Button({ label, onPress, busy, disabled, tone = 'primary' }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'secondary' | 'danger' }) {
  const theme = useTheme();
  const off = disabled || busy;
  const background = tone === 'primary' ? theme.primary : 'transparent';
  const color = tone === 'primary' ? theme.onPrimary : tone === 'danger' ? theme.danger : theme.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: pressed && tone === 'primary' ? theme.primaryPressed : background, borderColor: tone === 'primary' ? background : tone === 'danger' ? theme.danger : theme.border, opacity: off ? 0.6 : 1 },
      ]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.buttonText, { color }]}>{label}</Text>}
    </Pressable>
  );
}

/** A labelled text input. React 19: ref is an ordinary prop. */
export function Field({ label, style, ref, ...props }: TextInputProps & { label: string; ref?: Ref<ComponentRef<typeof TextInput>> }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        style={[styles.input, { color: theme.text, backgroundColor: theme.inputBackground, borderColor: theme.border }, style]}
        {...props}
      />
    </View>
  );
}

export function Banner({ tone, children }: { tone: 'danger' | 'warning' | 'success'; children: ReactNode }) {
  const theme = useTheme();
  const soft = tone === 'danger' ? theme.dangerSoft : tone === 'warning' ? theme.warningSoft : theme.successSoft;
  const strong = tone === 'danger' ? theme.danger : tone === 'warning' ? theme.warning : theme.success;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: soft, borderColor: strong }]}>
      <Text style={{ color: strong, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'warning' }) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.danger : tone === 'warning' ? theme.warning : theme.text;
  return (
    <Card style={styles.stat}>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {hint ? <Text style={[styles.muted, { color: theme.textSecondary }]} numberOfLines={1}>{hint}</Text> : null}
    </Card>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Text style={{ color: theme.textSecondary, fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: 15, fontWeight: strong ? '700' : '500', fontVariant: ['tabular-nums'] }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.large, borderWidth: StyleSheet.hairlineWidth, padding: Spacing.four, gap: Spacing.two },
  title: { fontSize: 17, fontWeight: '700' },
  muted: { fontSize: 13, lineHeight: 18 },
  button: { minHeight: 52, borderRadius: Radius.medium, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four },
  buttonText: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 52, borderRadius: Radius.medium, borderWidth: 1, paddingHorizontal: Spacing.four, fontSize: 16 },
  banner: { borderRadius: Radius.medium, borderWidth: 1, padding: Spacing.three },
  stat: { flex: 1, minWidth: 140, gap: Spacing.one },
  statLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  statValue: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.two },
});
