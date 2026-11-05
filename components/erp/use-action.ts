"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

/** Sends a JSON (or multipart FormData) mutation to an API route, surfaces the error message, and refreshes server data. */
export function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const run = useCallback(
    async <T = unknown>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T | null> => {
      setBusy(true);
      setError(null);
      try {
        // FormData (file uploads) is sent as multipart; anything else as JSON.
        const multipart = body instanceof FormData;
        const response = await fetch(url, {
          method,
          headers: body === undefined || multipart ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
        });
        const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
        if (!response.ok) {
          setError(payload.error ?? `Request failed (${response.status}).`);
          return null;
        }
        startTransition(() => router.refresh());
        return payload;
      } catch {
        setError("Network error. Check your connection and retry.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  return { run, error, setError, busy };
}
