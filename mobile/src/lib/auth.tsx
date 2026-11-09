// Sign-in state. The bearer token and profile are kept in the phone's encrypted storage (SecureStore),
// so the app opens signed in; a token the server rejects signs the person out.
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, ApiError, configureApi } from '@/lib/api';

export type Location = { id: string; name: string };
export type PharmacyChoice = { tenantId: string; name: string; role: string; locations: Location[]; defaultLocationId?: string | null };
export type Session = {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; email: string; role: string; tenantId: string; outletId: string | null; outlets: Location[]; permissions: string[] };
  pharmacy: PharmacyChoice | null;
};

type LoginResponse = Omit<Session, 'pharmacy'> & { pharmacy: PharmacyChoice | null };
export type LoginResult = { kind: 'signed-in'; session: Session } | { kind: 'choose-pharmacy'; pharmacies: PharmacyChoice[] };

const KEY = 'pharmaerp.session';

type AuthValue = {
  ready: boolean;
  session: Session | null;
  /** Checks the password; may ask which pharmacy to use. outletId: a location other than the default. */
  signIn: (input: { identifier: string; password: string; tenantId?: string; outletId?: string }) => Promise<LoginResult>;
  /** Makes a session from signIn the active one (after any location choice). */
  activate: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  const signOut = useCallback(async () => {
    configureApi({ token: null });
    setSession(null);
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  }, []);

  useEffect(() => {
    configureApi({ token: null, onUnauthorized: () => void signOut() });
    SecureStore.getItemAsync(KEY)
      .then((raw) => {
        const saved = raw ? (JSON.parse(raw) as Session) : null;
        if (saved && Date.parse(saved.expiresAt) > Date.now()) {
          configureApi({ token: saved.token });
          setSession(saved);
        }
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [signOut]);

  const signIn = useCallback<AuthValue['signIn']>(async (input) => {
    try {
      const result = await api<LoginResponse>('/api/mobile/login', { method: 'POST', body: input, auth: false });
      return { kind: 'signed-in', session: result };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && Array.isArray(error.body.pharmacies)) {
        return { kind: 'choose-pharmacy', pharmacies: error.body.pharmacies as PharmacyChoice[] };
      }
      throw error;
    }
  }, []);

  const activate = useCallback(async (next: Session) => {
    configureApi({ token: next.token });
    setSession(next);
    await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const value = useMemo<AuthValue>(() => ({
    ready,
    session,
    signIn,
    activate,
    signOut,
    can: (permission) => Boolean(session?.user.permissions.includes(permission)),
  }), [ready, session, signIn, activate, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
