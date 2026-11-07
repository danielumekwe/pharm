import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    outletId?: string | null;
    tenantId?: string;
  }

  interface Session {
    user: {
      id: string;
      role: string;
      /** Active outlet (null = all outlets, central roles only). */
      outletId: string | null;
      /** Outlets the user may switch between. */
      outletIds: string[];
      /** Live effective permissions, recomputed on every session read. */
      permissions: string[];
      staffId: string | null;
      /** Names of the outlets in outletIds (from the database). */
      outlets: { id: string; name: string }[];
      /** The pharmacy (tenant) this session works in; null when the membership is gone. */
      tenantId: string | null;
      tenantName: string | null;
      /** Pharmacies the account may switch to (active memberships). */
      pharmacies: { id: string; name: string }[];
      /** Set while a Super Administrator is acting as this user. */
      impersonation: { sessionId: string; adminId: string; adminName: string; startedAt: string; expiresAt: string } | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    outletId?: string | null;
    impersonationId?: string;
    adminOutletId?: string | null;
    /** The pharmacy the session belongs to; checked against the live membership on every request. */
    tenantId?: string;
    /** When the user signed in (ms); sessions older than the last password change are refused. */
    signedInAt?: number;
    /** Set once the session has been signed out by a password change. */
    revoked?: boolean;
  }
}
