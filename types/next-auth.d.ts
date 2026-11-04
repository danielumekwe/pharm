import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    role?: string;
    outletId?: string | null;
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
  }
}
