"use client";

// Page images are prepared on the device before upload: turned upright, cropped, reduced to a size the AI
// reads well (longest side 2000 px) and saved as JPEG. PDF pages are drawn to images the same way.
// Smaller uploads matter on mobile data, and the server only ever receives JPEG images.

export type Crop = { x: number; y: number; width: number; height: number };
export type Edit = { rotation: 0 | 90 | 180 | 270; crop: Crop };
export const FULL_CROP: Crop = { x: 0, y: 0, width: 1, height: 1 };
export const MAX_SIDE = 2000;
const QUALITY = 0.86;

async function decode(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(source, { imageOrientation: "from-image" });
  } catch {
    // Some browsers decode formats (e.g. HEIC on iPhone) only through <img>.
    const url = URL.createObjectURL(source);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

const sizeOf = (image: ImageBitmap | HTMLImageElement) => ("naturalWidth" in image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: image.width, height: image.height });

function toBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the image."))), "image/jpeg", QUALITY));
}

/** Applies rotation and crop, scales to at most MAX_SIDE and encodes as JPEG. */
export async function preparePage(source: Blob, edit: Edit = { rotation: 0, crop: FULL_CROP }, maxSide = MAX_SIDE) {
  const image = await decode(source);
  const { width, height } = sizeOf(image);
  if (!width || !height) throw new Error("This image could not be read.");
  const turned = edit.rotation === 90 || edit.rotation === 270;
  const rotated = document.createElement("canvas");
  rotated.width = turned ? height : width;
  rotated.height = turned ? width : height;
  const context = rotated.getContext("2d");
  if (!context) throw new Error("Your browser cannot edit images.");
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate((edit.rotation * Math.PI) / 180);
  context.drawImage(image, -width / 2, -height / 2);
  if ("close" in image) image.close();

  const crop = edit.crop;
  const sx = Math.round(crop.x * rotated.width);
  const sy = Math.round(crop.y * rotated.height);
  const sw = Math.max(1, Math.round(crop.width * rotated.width));
  const sh = Math.max(1, Math.round(crop.height * rotated.height));
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const output = document.createElement("canvas");
  output.width = Math.max(1, Math.round(sw * scale));
  output.height = Math.max(1, Math.round(sh * scale));
  const out = output.getContext("2d");
  if (!out) throw new Error("Your browser cannot edit images.");
  out.fillStyle = "#fff";
  out.fillRect(0, 0, output.width, output.height);
  out.imageSmoothingQuality = "high";
  out.drawImage(rotated, sx, sy, sw, sh, 0, 0, output.width, output.height);
  rotated.width = rotated.height = 0;
  return { blob: await toBlob(output), width: output.width, height: output.height };
}

/** Draws every page of a PDF as a JPEG image (pages are read one at a time to keep memory low). */
export async function pdfPages(file: Blob, onPage: (page: { blob: Blob; index: number; count: number }) => Promise<void> | void, maxPages = 60) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document_ = await task.promise;
  const count = Math.min(document_.numPages, maxPages);
  try {
    for (let index = 1; index <= count; index += 1) {
      const page = await document_.getPage(index);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(4, MAX_SIDE / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Your browser cannot draw PDF pages.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await toBlob(canvas);
      canvas.width = canvas.height = 0;
      page.cleanup();
      await onPage({ blob, index, count: document_.numPages });
    }
  } finally {
    await task.destroy();
  }
  return document_.numPages;
}

/** POST with upload progress (fetch cannot report upload progress). */
export function uploadWithProgress(url: string, form: FormData, onProgress: (fraction: number) => void) {
  return new Promise<{ status: number; data: Record<string, unknown> }>((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    request.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(request.responseText);
      } catch {
        data = { error: `Upload failed (${request.status}).` };
      }
      resolve({ status: request.status, data });
    };
    request.onerror = () => resolve({ status: 0, data: { error: "Network error. Check your connection and retry." } });
    request.send(form);
  });
}
