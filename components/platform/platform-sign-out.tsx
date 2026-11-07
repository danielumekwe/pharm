"use client";

import { useRouter } from "next/navigation";

export function PlatformSignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/platform/logout", { method: "POST" });
        router.push("/platform/login");
        router.refresh();
      }}
      className="rounded-md border border-white/20 px-3 py-1.5 hover:bg-white/10"
    >
      Sign out
    </button>
  );
}
