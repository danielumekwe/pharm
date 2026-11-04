import { saveDocument } from "@/lib/erp/regulatory";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

export async function POST(request: Request) {
  return guarded(
    "regulatory.manage",
    async (actor) => {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new DomainError("Choose a file to upload.");
      return saveDocument(
        actor,
        {
          title: String(form.get("title") ?? ""),
          category: String(form.get("category") ?? ""),
          relatedTo: String(form.get("relatedTo") ?? ""),
          expiresOn: String(form.get("expiresOn") ?? "") || undefined,
        },
        file,
      );
    },
    201,
  );
}
