"use client";

import Link from "next/link";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { ActionButton, FormError, TextInput } from "@/components/erp/fields";
import { PageHeader } from "@/components/erp/page-header";
import { Panel } from "@/components/erp/stat-card";
import { useAction } from "@/components/erp/use-action";
import type { ProductCatalogLists } from "@/lib/erp/types";

const LISTS: { key: keyof ProductCatalogLists; title: string; description: string }[] = [
  { key: "categories", title: "Product categories", description: "Therapeutic and merchandising groups used to file and filter products." },
  { key: "dosageForms", title: "Dosage forms", description: "Tablet, capsule, syrup, injection, cream, soap…" },
  { key: "productTypes", title: "Product types", description: "Prescription-only, OTC, supplement, device…" },
  { key: "packagingTypes", title: "Packaging types", description: "Suggested names for packaging levels (carton, pack, strip, sachet…)." },
];

/** Configurable catalogue lists. Entries still used by products cannot be removed. */
export function CategoriesEditor({ catalog, usage, canEdit }: { catalog: ProductCatalogLists; usage: Record<keyof ProductCatalogLists, Record<string, number>>; canEdit: boolean }) {
  const { run, error, busy } = useAction();
  const [lists, setLists] = useState(catalog);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(lists) !== JSON.stringify(catalog);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inventory & supply"
        title="Categories & catalogue lists"
        description="Lists offered on the product registration form. Only users with the catalogue permission can change them; entries in use cannot be deleted."
        actions={canEdit ? <ActionButton disabled={busy || !dirty} onClick={() => void run("/api/catalog", "PATCH", lists)}>Save changes</ActionButton> : <Link href="/products" className="text-sm text-blue-600 hover:underline">Back to products</Link>}
      />
      <FormError message={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        {LISTS.map(({ key, title, description }) => (
          <Panel key={key} title={title} description={description}>
            <ul className="flex flex-wrap gap-2">
              {lists[key].map((value) => (
                <li key={value} className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-950 py-1 pl-3 pr-1 text-sm text-slate-300">
                  {value}
                  {usage[key][value] ? <span className="rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-blue-700">{usage[key][value]}</span> : null}
                  {canEdit && !usage[key][value] ? (
                    <button type="button" onClick={() => setLists((current) => ({ ...current, [key]: current[key].filter((item) => item !== value) }))} className="rounded-full p-0.5 text-slate-500 hover:text-rose-300" aria-label={`Remove ${value}`}><X className="h-3.5 w-3.5" /></button>
                  ) : <span className="w-1" />}
                </li>
              ))}
            </ul>
            {canEdit ? (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = (drafts[key] ?? "").trim();
                  if (!value || lists[key].some((item) => item.toLowerCase() === value.toLowerCase())) return;
                  setLists((current) => ({ ...current, [key]: [...current[key], value] }));
                  setDrafts((current) => ({ ...current, [key]: "" }));
                }}
              >
                <TextInput value={drafts[key] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))} placeholder={`Add to ${title.toLowerCase()}`} />
                <ActionButton type="submit" tone="secondary"><Plus className="h-4 w-4" /> Add</ActionButton>
              </form>
            ) : null}
          </Panel>
        ))}
      </div>
    </div>
  );
}
