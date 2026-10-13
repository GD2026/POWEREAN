// Camera barcode reading. Chrome/Android ship a native BarcodeDetector; iOS
// Safari does not, so there we load the ZXing-C++ WebAssembly ponyfill. The
// .wasm file is bundled with the app (no third-party CDN, CSP-friendly).
import zxingWasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

import { normalizeEan } from "../ean";

export interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type DetectorCtor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

export async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (Native?.getSupportedFormats) {
    try {
      const supported = await Native.getSupportedFormats();
      if (FORMATS.every((f) => supported.includes(f))) return new Native({ formats: FORMATS });
    } catch {
      // Fall through to the ponyfill.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith(".wasm") ? zxingWasmUrl : prefix + path,
    },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector;
}

/**
 * Accepts a code only after two identical reads close together (guards
 * against a one-frame misread), then ignores that same code for a while so
 * holding the phone over a box doesn't add it again and again.
 */
export class ReadConfirmer {
  private candidate: string | null = null;
  private candidateAt = 0;
  private lastAccepted: string | null = null;
  private lastAcceptedAt = 0;

  constructor(
    private readonly confirmWindowMs = 1500,
    private readonly cooldownMs = 3000,
  ) {}

  /** Returns the EAN to accept, or null. `now` is a millisecond clock. */
  offer(rawValue: string, now: number): string | null {
    const ean = normalizeEan(rawValue);
    if (!ean) return null;
    if (ean === this.lastAccepted && now - this.lastAcceptedAt < this.cooldownMs) {
      this.lastAcceptedAt = now; // still in view: extend the cooldown
      return null;
    }
    if (ean !== this.candidate || now - this.candidateAt > this.confirmWindowMs) {
      this.candidate = ean;
      this.candidateAt = now;
      return null;
    }
    this.candidate = null;
    this.lastAccepted = ean;
    this.lastAcceptedAt = now;
    return ean;
  }

  reset() {
    this.candidate = null;
    this.lastAccepted = null;
  }
}

/** Short beep + vibration on a successful read. The AudioContext must be created from a tap. */
export function createFeedback() {
  let ctx: AudioContext | null = null;
  return {
    unlock() {
      if (ctx) return;
      try {
        const AC =
          window.AudioContext ??
          (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        ctx = AC ? new AC() : null;
        void ctx?.resume();
      } catch {
        ctx = null;
      }
    },
    success() {
      try {
        navigator.vibrate?.(60);
      } catch {
        // Not supported on iOS.
      }
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1760;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
