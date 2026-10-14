import { useCallback, useEffect, useRef, useState } from "react";

import {
  createDetector,
  createFeedback,
  ReadConfirmer,
  type Detector,
} from "@/lib/client/scanner-engine";
import { cameraProblemText, useCamera } from "@/lib/client/use-camera";

import { ScanIcon, TorchIcon } from "./icons";

const SCAN_INTERVAL_MS = 110;

interface ScannerProps {
  onDetected: (ean: string) => void;
}

/** Live camera view that reports each confirmed EAN once. */
export function Scanner({ onDetected }: ScannerProps) {
  const detectorRef = useRef<Detector | null>(null);
  const timerRef = useRef<number | null>(null);
  const confirmer = useRef(new ReadConfirmer());
  const feedback = useRef<ReturnType<typeof createFeedback> | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [hit, setHit] = useState(false);
  onDetectedRef.current = onDetected;

  const loopRef = useRef<() => void>(() => {});
  const camera = useCamera({
    onBeforeStart: async () => {
      feedback.current ??= createFeedback();
      feedback.current.unlock();
      detectorRef.current ??= await createDetector();
    },
    onStarted: () => {
      confirmer.current.reset();
      loopRef.current();
    },
  });
  const { videoRef, streamRef } = camera;

  loopRef.current = useCallback(() => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const tick = async () => {
      if (!streamRef.current || !video || !detector || !ctx) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        // Read the centre band (where the guide frame is) at a bounded size:
        // faster on phones and fewer stray codes from neighbouring boxes.
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const sx = vw * 0.04;
        const sw = vw * 0.92;
        const sy = vh * 0.2;
        const sh = vh * 0.6;
        const scale = Math.min(1, 1280 / sw);
        canvas.width = Math.round(sw * scale);
        canvas.height = Math.round(sh * scale);
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        try {
          const codes = await detector.detect(canvas);
          for (const code of codes) {
            const ean = confirmer.current.offer(code.rawValue, performance.now());
            if (ean) {
              feedback.current?.success();
              setHit(true);
              window.setTimeout(() => setHit(false), 450);
              onDetectedRef.current(ean);
              break;
            }
          }
        } catch {
          // A single failed frame is not worth surfacing.
        }
      }
      if (streamRef.current) timerRef.current = window.setTimeout(tick, SCAN_INTERVAL_MS);
    };
    void tick();
  }, [videoRef, streamRef]);

  // iOS only allows sound after a tap; an auto-started camera has had none yet.
  useEffect(() => {
    feedback.current ??= createFeedback();
    const unlock = () => feedback.current?.unlock();
    document.addEventListener("pointerdown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      feedback.current?.close();
      feedback.current = null;
    };
  }, []);

  const problem = cameraProblemText(camera.state, "Eller skriv inn EAN under.");

  return (
    <div className="pe-scanner" data-hit={hit}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-label="Kamerabilde"
        hidden={!camera.live}
      />
      {camera.live ? (
        <>
          <div className="pe-scanner-frame" aria-hidden />
          <div className="pe-scanner-status" role="status">
            {camera.state === "starting" ? "Starter kamera…" : "Hold strekkoden inne i rammen"}
          </div>
          <div className="pe-scanner-hud">
            {camera.torchAvailable && (
              <button
                type="button"
                className="pe-icon-btn"
                aria-label="Lommelykt"
                aria-pressed={camera.torchOn}
                onClick={() => void camera.toggleTorch()}
              >
                <TorchIcon />
              </button>
            )}
            <button type="button" className="pe-btn" onClick={() => camera.stop("paused")}>
              Pause
            </button>
          </div>
        </>
      ) : (
        <div className="pe-scanner-idle">
          <ScanIcon aria-hidden />
          <p>{problem ?? "Pek kameraet mot strekkoden. Appen piper når den har lest koden."}</p>
          <button
            type="button"
            className="pe-btn pe-btn--primary pe-btn--big"
            onClick={() => void camera.start()}
          >
            <ScanIcon aria-hidden />
            {camera.state === "paused" ? "Fortsett skanning" : "Start skanning"}
          </button>
        </div>
      )}
    </div>
  );
}
