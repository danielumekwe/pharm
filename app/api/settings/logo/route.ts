import { removeLogo, saveLogo } from "@/lib/erp/branding";
import { DomainError } from "@/lib/erp/services";
import { guarded } from "@/lib/session";

export async function POST(request: Request) {
  return guarded("settings.manage", async (actor) => {
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new DomainError("Choose an image to upload.");
    return saveLogo(actor, file);
  });
}

export async function DELETE() {
  return guarded("settings.manage", (actor) => removeLogo(actor));
}
