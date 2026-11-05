"use client";

import { CheckCheck } from "lucide-react";

import { ActionButton } from "@/components/erp/fields";
import { useAction } from "@/components/erp/use-action";

export function MarkAllRead() {
  const { run, busy } = useAction();
  return (
    <ActionButton tone="secondary" disabled={busy} onClick={() => void run("/api/notifications", "PATCH", { ids: "all" })}>
      <CheckCheck className="h-4 w-4" /> Mark all read
    </ActionButton>
  );
}
