import { templateFile } from "@/lib/erp/import-file";
import { IMPORT_KINDS, type ImportKind } from "@/lib/erp/import-format";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

/** GET ?kind=catalogue|stock|both&format=xlsx|csv → template with sample rows (and a column guide in Excel). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "both";
  const format = url.searchParams.get("format") === "csv" ? "csv" : "xlsx";
  return guarded("inventory.import", async () => {
    if (!IMPORT_KINDS.includes(kind as ImportKind)) throw new DomainError("Unknown template.");
    const file = await templateFile(kind as ImportKind, format);
    return new Response(file.body, { headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.name}"`, "Cache-Control": "no-store" } });
  });
}
