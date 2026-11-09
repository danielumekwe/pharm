import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();
// Development-only notices raised inside the drawer's animation library (not app code).
LogBox.ignoreLogs(['[Reanimated] Dependencies should only be used on the web', "It looks like you might be using shared value's .value inside reanimated inline style"]);

export default function RootLayout() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? Colors.dark : Colors.light;
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider value={{ ...base, colors: { ...base.colors, primary: palette.primary, background: palette.background, card: palette.card, text: palette.text, border: palette.border } }}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Screens />
      </AuthProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/** Signed out: only sign-in. Signed in: only the app. The server checks every request as well. */
function Screens() {
  const { ready, session } = useAuth();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="choose" options={{ headerShown: true, title: 'Choose where to work', presentation: 'card' }} />
      </Stack.Protected>
      <Stack.Protected guard={Boolean(session)}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
