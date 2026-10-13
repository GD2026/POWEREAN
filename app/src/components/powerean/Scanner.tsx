import { useCallback, useEffect, useRef, useState } from "react";

import { readStored, writeStored } from "@/lib/client/storage";
import {
  createDetector,
  createFeedback,
  ReadConfirmer,
  type Detector,
} from "@/lib/client/scanner-engine";
import { z } from "zod";

import { ScanIcon, TorchIcon } from "./icons";

type State = "idle" | "starting" | "running" | "paused" | "denied" | "unsupported" | "error";

const CAMERA_OK_KEY = "powerean.cameraOk";
const SCAN_INTERVAL_MS = 110;

interface ScannerProps {
  onDetected: (ean: string) => void;
}

/** Live camera view that reports each confirmed EAN once. */
export function Scanner({ onDetected }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<Detector | null>(null);
  const timerRef = useRef<number | null>(null);
  const confirmer = useRef(new ReadConfirmer());
  const feedback = useRef<ReturnType<typeof createFeedback> | null>(null);
  const onDetectedRef = useRef(onDetected);
  const [state, setState] = useState<State>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [hit, setHit] = useState(false);
  onDetectedRef.current = onDetected;

  const stop = useCallback((next: State = "idle") => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchAvailable(false);
    setState(next);
  }, []);

  const loop = useCallback(() => {
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
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    feedback.current ??= createFeedback();
    feedback.current.unlock();
    setState("starting");
    try {
      const [stream, detector] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        }),
        detectorRef.current ? Promise.resolve(detectorRef.current) : createDetector(),
      ]);
      detectorRef.current = detector;
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean; focusMode?: string[] };
      setTorchAvailable(Boolean(caps.torch));
      if (caps.focusMode?.includes("continuous")) {
        await track
          .applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] })
          .catch(() => undefined);
      }
      writeStored(CAMERA_OK_KEY, true);
      confirmer.current.reset();
      setState("running");
      loop();
    } catch (error) {
      stop(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "error");
    }
  }, [loop, stop]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  // Resume automatically for returning users; the camera prompt was accepted before.
  useEffect(() => {
    feedback.current ??= createFeedback();
    // iOS only allows sound after a tap; an auto-started camera has had none yet.
    const unlock = () => feedback.current?.unlock();
    document.addEventListener("pointerdown", unlock, { once: true });
    if (readStored(CAMERA_OK_KEY, z.boolean(), false)) void start();
    return () => {
      document.removeEventListener("pointerdown", unlock);
      stop();
      feedback.current?.close();
      feedback.current = null;
    };
  }, [start, stop]);

  // Release the camera when the app goes to the background (battery, privacy).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && streamRef.current) stop("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  const live = state === "running" || state === "starting";

  return (
    <div className="pe-scanner" data-hit={hit}>
      <video ref={videoRef} playsInline muted autoPlay aria-label="Kamerabilde" hidden={!live} />
      {live ? (
        <>
          <div className="pe-scanner-frame" aria-hidden />
          <div className="pe-scanner-status" role="status">
            {state === "starting" ? "Starter kamera…" : "Hold strekkoden inne i rammen"}
          </div>
          <div className="pe-scanner-hud">
            {torchAvailable && (
              <button
                type="button"
                className="pe-icon-btn"
                aria-label="Lommelykt"
                aria-pressed={torchOn}
                onClick={() => void toggleTorch()}
              >
                <TorchIcon />
              </button>
            )}
            <button type="button" className="pe-btn" onClick={() => stop("paused")}>
              Pause
            </button>
          </div>
        </>
      ) : (
        <div className="pe-scanner-idle">
          <ScanIcon aria-hidden />
          {state === "denied" ? (
            <p>
              Kameraet er blokkert. På iPhone: Innstillinger → Safari → Kamera → Tillat. Eller skriv
              inn EAN under.
            </p>
          ) : state === "unsupported" ? (
            <p>
              Denne nettleseren gir ikke tilgang til kamera. Åpne siden i Safari eller Chrome, eller
              skriv inn EAN under.
            </p>
          ) : state === "error" ? (
            <p>Fikk ikke startet kameraet. Lukk andre apper som bruker kameraet og prøv igjen.</p>
          ) : (
            <p>Pek kameraet mot strekkoden. Appen piper når den har lest koden.</p>
          )}
          <button
            type="button"
            className="pe-btn pe-btn--primary pe-btn--big"
            onClick={() => void start()}
          >
            <ScanIcon aria-hidden />
            {state === "paused" ? "Fortsett skanning" : "Start skanning"}
          </button>
        </div>
      )}
    </div>
  );
}
