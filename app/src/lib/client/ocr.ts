// On-device text reading for price tags (Tesseract.js, self-hosted). Nothing
// is uploaded: the photo is read in the browser and only the chosen text goes
// to the server as a search.
import type { Worker } from "tesseract.js";

// Served by the ocrAssets() plugin in vite.config.ts; keep the paths in sync.
const OCR_BASE = "/assets/ocr-v7";

type Progress = (fraction: number, label: string) => void;

let workerPromise: Promise<Worker> | null = null;
let onProgress: Progress | null = null;

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    const { createWorker, OEM, PSM } = await import("tesseract.js");
    const origin = window.location.origin;
    const worker = await createWorker("nor", OEM.LSTM_ONLY, {
      workerPath: `${origin}${OCR_BASE}/worker.min.js`,
      corePath: `${origin}${OCR_BASE}/core`,
      langPath: `${origin}${OCR_BASE}/lang`,
      workerBlobURL: false,
      logger: (m: { status: string; progress: number }) => {
        if (m.status === "recognizing text") onProgress?.(0.3 + m.progress * 0.7, "Leser tekst");
        else onProgress?.(Math.min(0.3, m.progress * 0.3), "Laster tekstleser");
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      user_defined_dpi: "300",
      preserve_interword_spaces: "1",
    });
    return worker;
  })().catch((error) => {
    workerPromise = null;
    throw error;
  });
  return workerPromise;
}

/** Starts loading the reader in the background so the first photo is quick. */
export function warmUpOcr() {
  void getWorker().catch(() => undefined);
}

/**
 * Crops, scales and boosts contrast so small print on a shelf label reads
 * better. Returns a new canvas.
 */
export function prepareForOcr(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop = { x: 0, y: 0, w: 1, h: 1 },
): HTMLCanvasElement {
  const sw = width * crop.w;
  const sh = height * crop.h;
  const scale = Math.min(2.5, Math.max(1, 1800 / sw));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, width * crop.x, height * crop.y, sw, sh, 0, 0, canvas.width, canvas.height);

  // Grayscale + stretch the histogram (ignore the 1% extremes).
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const y = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    px[i] = y;
    hist[y]++;
  }
  const total = px.length / 4;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01;) lo++;
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01;) hi--;
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / range));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export async function readText(image: HTMLCanvasElement, progress?: Progress): Promise<string> {
  onProgress = progress ?? null;
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    return data.text ?? "";
  } finally {
    onProgress = null;
  }
}
