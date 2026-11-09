// Holds the sign-in in progress (in memory only) while the person picks a pharmacy or location.
// The password never leaves memory and is cleared as soon as sign-in finishes or is abandoned.
import type { PharmacyChoice, Session } from '@/lib/auth';

type Pending = { identifier: string; password: string; pharmacies: PharmacyChoice[]; session: Session | null };

let pending: Pending | null = null;

export const pendingSignIn = {
  set(next: Pending) {
    pending = next;
  },
  get() {
    return pending;
  },
  clear() {
    pending = null;
  },
};
