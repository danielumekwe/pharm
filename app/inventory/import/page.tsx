import { DashboardShell } from "@/components/dashboard-shell";
import { outlets } from "@/lib/data";
import { FIELDS, IMPORT_KIND_LABELS } from "@/lib/erp/import-format";
import { MAX_FILE_BYTES, MAX_ROWS } from "@/lib/erp/import-file";
import { outletName } from "@/lib/erp/services";
import { can, isOutletScoped } from "@/lib/rbac";
import { pageData } from "@/lib/session";

import { ImportWorkspace } from "./import-workspace";

export default async function BulkImportPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  return pageData("inventory.import", "/inventory/import", (actor) => {
    // Outlet staff import into their active outlet only; central roles choose any open outlet.
    const choices = outlets
      .filter((outlet) => outlet.status !== "CLOSED")
      .filter((outlet) => !isOutletScoped(actor.role) || outlet.id === actor.outletId)
      .map((outlet) => ({ id: outlet.id, name: outlet.name, code: outlet.code }));
    return (
      <DashboardShell>
        <ImportWorkspace
          initialId={id ?? null}
          outlets={choices}
          defaultOutletId={actor.outletId ?? choices[0]?.id ?? ""}
          scope={actor.outletId ? outletName(actor.outletId) : undefined}
          fields={FIELDS.map(({ key, label, modes, description }) => ({ key, label, modes: [...modes], description }))}
          kindLabels={IMPORT_KIND_LABELS}
          limits={{ maxBytes: MAX_FILE_BYTES, maxRows: MAX_ROWS }}
          canAddCatalog={can(actor, "catalog.manage")}
        />
      </DashboardShell>
    );
  });
}
