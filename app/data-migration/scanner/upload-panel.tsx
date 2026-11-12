"use client";

import { ArrowDown, ArrowUp, Camera, Crop as CropIcon, FileText, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ActionButton, FormError } from "@/components/erp/fields";

import { FULL_CROP, pdfPages, preparePage, uploadWithProgress, type Edit } from "./image-tools";
import { PageEditor } from "./page-editor";

type Item = {
  key: string;
  file: Blob;
  name: string;
  type: "image" | "pdf";
  documentId: string;
  documentName: string;
  edit: Edit;
  thumb: string;
  progress: number;
  error: string | null;
  uploading: boolean;
};

const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 4 * 1024 * 1024;

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Pages chosen on this device, edited and uploaded one by one (nothing is sent until "Upload"). */
export function UploadPanel({ jobId, remaining, maxPageBytes, disabled, onUploaded }: { jobId: string; remaining: number; maxPageBytes: number; disabled: boolean; onUploaded: () => Promise<void> | void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [originals, setOriginals] = useState<{ documentId: string; name: string; file: Blob }[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [dragging, setDragging] = useState(false);
  const browse = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.thumb)), []);

  const addFiles = async (files: FileList | File[]) => {
    setProblem(null);
    const list = [...files];
    const added: Item[] = [];
    const problems: string[] = [];
    let room = remaining - items.length;
    for (const file of list) {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      const isImage = file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp)$/i.test(file.name);
      if (!isPdf && !isImage) {
        problems.push(`${file.name}: only photos (JPEG, PNG) and PDF scans can be added.`);
        continue;
      }
      if (isImage && file.size > MAX_SOURCE_BYTES) {
        problems.push(`${file.name}: the photo is larger than 30 MB.`);
        continue;
      }
      if (isPdf && file.size > MAX_PDF_BYTES) {
        problems.push(`${file.name}: the PDF is larger than 50 MB. Split it into smaller files.`);
        continue;
      }
      if (room <= 0) {
        problems.push(`A job holds at most ${remaining + items.length} more pages; ${file.name} was not added. Start another job for the rest.`);
        break;
      }
      const documentId = uid();
      if (isImage) {
        added.push({ key: uid(), file, name: file.name || "Photo", type: "image", documentId, documentName: file.name || "Camera photo", edit: { rotation: 0, crop: FULL_CROP }, thumb: URL.createObjectURL(file), progress: 0, error: null, uploading: false });
        room -= 1;
        continue;
      }
      setPreparing(`Reading ${file.name}…`);
      try {
        const pages: Item[] = [];
        const total = await pdfPages(
          file,
          ({ blob, index, count }) => {
            setPreparing(`Reading ${file.name}: page ${index} of ${count}…`);
            pages.push({ key: uid(), file: blob, name: `${file.name} — page ${index}`, type: "pdf", documentId, documentName: file.name, edit: { rotation: 0, crop: FULL_CROP }, thumb: URL.createObjectURL(blob), progress: 0, error: null, uploading: false });
          },
          room,
        );
        if (total > room) problems.push(`${file.name}: only the first ${room} of ${total} pages fit in this job.`);
        added.push(...pages);
        room -= pages.length;
        if (file.size <= MAX_ORIGINAL_BYTES) setOriginals((current) => [...current, { documentId, name: file.name, file }]);
      } catch {
        problems.push(`${file.name}: this PDF could not be opened. If it is password-protected, remove the password first.`);
      } finally {
        setPreparing(null);
      }
    }
    if (added.length) setItems((current) => [...current, ...added]);
    if (problems.length) setProblem(problems.join(" "));
  };

  const move = (index: number, by: -1 | 1) =>
    setItems((current) => {
      const next = [...current];
      const target = index + by;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  const remove = (key: string) =>
    setItems((current) => {
      const item = current.find((entry) => entry.key === key);
      if (item) URL.revokeObjectURL(item.thumb);
      return current.filter((entry) => entry.key !== key);
    });
  const patch = (key: string, change: Partial<Item>) => setItems((current) => current.map((entry) => (entry.key === key ? { ...entry, ...change } : entry)));

  const uploadAll = async () => {
    setBusy(true);
    setProblem(null);
    const failed: string[] = [];
    for (const item of itemsRef.current) {
      patch(item.key, { uploading: true, error: null, progress: 0 });
      try {
        const { blob } = await preparePage(item.file, item.edit);
        if (blob.size > maxPageBytes) throw new Error("The page is still larger than 4 MB after compression. Crop it into two pages.");
        const form = new FormData();
        form.append("file", blob, `${item.name.replace(/\.[^.]+$/, "")}.jpg`);
        form.append("documentId", item.documentId);
        form.append("documentName", item.documentName);
        form.append("documentType", item.type);
        const result = await uploadWithProgress(`/api/document-scans/${encodeURIComponent(jobId)}/pages`, form, (fraction) => patch(item.key, { progress: fraction }));
        if (result.status !== 201) throw new Error(String(result.data.error ?? `Upload failed (${result.status}).`));
        remove(item.key);
      } catch (error) {
        failed.push(item.name);
        patch(item.key, { uploading: false, error: (error as Error).message });
      }
    }
    // Originals of PDFs whose pages all uploaded are kept as uploaded.
    const left = new Set(itemsRef.current.map((item) => item.documentId));
    for (const original of originals.filter((entry) => !left.has(entry.documentId))) {
      const form = new FormData();
      form.append("file", original.file, original.name);
      form.append("documentId", original.documentId);
      form.append("documentName", original.name);
      await uploadWithProgress(`/api/document-scans/${encodeURIComponent(jobId)}/originals`, form, () => undefined);
    }
    setOriginals((current) => current.filter((entry) => left.has(entry.documentId)));
    setBusy(false);
    if (failed.length) setProblem(`${failed.length} page(s) were not uploaded. Fix the problem shown on each and press Upload again.`);
    await onUploaded();
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) void addFiles(event.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition ${dragging ? "border-blue-400 bg-blue-500/10" : "border-slate-700 bg-slate-950/40"}`}
      >
        <ImagePlus className="mx-auto h-8 w-8 text-slate-500" />
        <p className="mt-2 text-sm text-slate-300">Drag photos or PDF scans here</p>
        <p className="mt-1 text-xs text-slate-500">JPEG, PNG or PDF · photos are reduced to a clear 2000 px image before upload · up to {remaining} more page(s) in this job</p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <ActionButton disabled={disabled || busy} onClick={() => camera.current?.click()}>
            <Camera className="h-4 w-4" /> Take photo
          </ActionButton>
          <ActionButton tone="secondary" disabled={disabled || busy} onClick={() => browse.current?.click()}>
            <Upload className="h-4 w-4" /> Browse files
          </ActionButton>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => event.target.files && void addFiles(event.target.files).then(() => (event.target.value = ""))} aria-label="Take a photo with the camera" />
        <input ref={browse} type="file" accept="image/jpeg,image/png,image/heic,image/heif,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png" multiple className="hidden" onChange={(event) => event.target.files && void addFiles(event.target.files).then(() => (event.target.value = ""))} aria-label="Choose photos or PDF files" />
        <p className="mt-3 text-xs text-slate-500">Tip: lay the page flat in good light, fill the frame with the page and hold the phone straight above it. Several pages of one book can go in the same job.</p>
      </div>
      {preparing ? (
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" /> {preparing}
        </p>
      ) : null}
      <FormError message={problem} />

      {items.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300">{items.length} page(s) ready to upload, in this order:</p>
            <ActionButton disabled={busy || disabled} onClick={uploadAll}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload {items.length} page(s)
            </ActionButton>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item, index) => (
              <li key={item.key} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                <div className="relative h-24 w-20 shrink-0 overflow-hidden rounded-md border border-slate-700 bg-slate-900">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the user's own photo */}
                  <img src={item.thumb} alt={item.name} className="h-full w-full object-cover" style={{ transform: `rotate(${item.edit.rotation}deg)` }} />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm text-white">
                    <span className="text-slate-400">{index + 1}.</span> {item.name}
                  </p>
                  <p className="flex items-center gap-1 text-xs text-slate-500">
                    {item.type === "pdf" ? <FileText className="h-3 w-3" /> : null}
                    {item.edit.rotation || item.edit.crop.width < 1 || item.edit.crop.height < 1 ? "Edited" : "As taken"}
                  </p>
                  {item.uploading ? (
                    <div className="h-1.5 overflow-hidden rounded bg-slate-800" role="progressbar" aria-valuenow={Math.round(item.progress * 100)}>
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.round(item.progress * 100)}%` }} />
                    </div>
                  ) : null}
                  {item.error ? <p className="text-xs text-rose-300">{item.error}</p> : null}
                  <div className="flex flex-wrap gap-1 pt-1">
                    <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => move(index, -1)} disabled={busy || index === 0} aria-label="Move up">
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => move(index, 1)} disabled={busy || index === items.length - 1} aria-label="Move down">
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button type="button" className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => setEditing(item)} disabled={busy} aria-label="Rotate or crop">
                      <CropIcon className="h-4 w-4" />
                    </button>
                    <button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-500/20 hover:text-rose-200" onClick={() => remove(item.key)} disabled={busy} aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PageEditor
        source={editing?.file ?? null}
        initial={editing?.edit}
        title={`Edit ${editing?.name ?? "page"}`}
        onCancel={() => setEditing(null)}
        onSave={(edit) => {
          if (editing) patch(editing.key, { edit });
          setEditing(null);
        }}
      />
    </div>
  );
}
