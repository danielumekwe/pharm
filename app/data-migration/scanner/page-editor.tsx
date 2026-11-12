"use client";

import { RotateCcw, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import { ActionButton } from "@/components/erp/fields";
import { Modal } from "@/components/erp/modal";

import { FULL_CROP, preparePage, type Crop, type Edit } from "./image-tools";

/** Rotate and crop one page before it is uploaded (or re-uploaded). */
export function PageEditor({ source, initial, title, onCancel, onSave }: { source: Blob | null; initial?: Edit; title: string; onCancel: () => void; onSave: (edit: Edit) => void }) {
  const [rotation, setRotation] = useState<Edit["rotation"]>(initial?.rotation ?? 0);
  const [crop, setCrop] = useState<Crop>(initial?.crop ?? FULL_CROP);
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!source) return;
    let url: string | null = null;
    let cancelled = false;
    preparePage(source, { rotation, crop: FULL_CROP }, 900)
      .then(({ blob }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setPreview(url);
        setProblem(null);
      })
      .catch(() => !cancelled && setProblem("This image could not be opened for editing."));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, rotation]);

  const edges = { left: crop.x, top: crop.y, right: 1 - crop.x - crop.width, bottom: 1 - crop.y - crop.height };
  const setEdge = (edge: keyof typeof edges, value: number) => {
    const next = { ...edges, [edge]: value };
    if (next.left + next.right > 0.9 || next.top + next.bottom > 0.9) return;
    setCrop({ x: next.left, y: next.top, width: 1 - next.left - next.right, height: 1 - next.top - next.bottom });
  };
  const turn = (by: 90 | -90) => {
    setRotation((((rotation + by + 360) % 360) as Edit["rotation"]));
    setCrop(FULL_CROP);
  };

  return (
    <Modal open={source !== null} title={title} description="Turn the page upright and crop away the background so only the record is visible." onClose={onCancel} wide>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="relative mx-auto w-full max-w-xl select-none overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
          {preview ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the user's own photo */}
              <img src={preview} alt="Page preview" className="block w-full" />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 bg-slate-950/70" style={{ height: `${edges.top * 100}%` }} />
                <div className="absolute inset-x-0 bottom-0 bg-slate-950/70" style={{ height: `${edges.bottom * 100}%` }} />
                <div className="absolute left-0 bg-slate-950/70" style={{ top: `${edges.top * 100}%`, bottom: `${edges.bottom * 100}%`, width: `${edges.left * 100}%` }} />
                <div className="absolute right-0 bg-slate-950/70" style={{ top: `${edges.top * 100}%`, bottom: `${edges.bottom * 100}%`, width: `${edges.right * 100}%` }} />
                <div className="absolute border-2 border-blue-400" style={{ left: `${edges.left * 100}%`, top: `${edges.top * 100}%`, right: `${edges.right * 100}%`, bottom: `${edges.bottom * 100}%` }} />
              </div>
            </>
          ) : (
            <p className="p-10 text-center text-sm text-slate-400">{problem ?? "Opening the image…"}</p>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Rotate</p>
            <div className="flex gap-2">
              <ActionButton tone="secondary" onClick={() => turn(-90)} aria-label="Rotate left">
                <RotateCcw className="h-4 w-4" /> Left
              </ActionButton>
              <ActionButton tone="secondary" onClick={() => turn(90)} aria-label="Rotate right">
                <RotateCw className="h-4 w-4" /> Right
              </ActionButton>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">Crop</p>
            {(["top", "bottom", "left", "right"] as const).map((edge) => (
              <label key={edge} className="grid gap-1 text-xs capitalize text-slate-300">
                {edge}
                <input type="range" min={0} max={0.45} step={0.005} value={edges[edge]} onChange={(event) => setEdge(edge, Number(event.target.value))} />
              </label>
            ))}
            <ActionButton tone="ghost" onClick={() => setCrop(FULL_CROP)}>
              Reset crop
            </ActionButton>
          </div>
          <div className="flex gap-2 pt-2">
            <ActionButton tone="secondary" onClick={onCancel}>
              Cancel
            </ActionButton>
            <ActionButton disabled={!preview} onClick={() => onSave({ rotation, crop })}>
              Apply
            </ActionButton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
