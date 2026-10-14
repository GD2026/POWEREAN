// Rear-camera stream shared by the barcode scanner and the price-tag reader:
// permission states, torch, autofocus, and releasing the camera when the app
// goes to the background.
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { readStored, writeStored } from "./storage";

export type CameraState =
  "idle" | "starting" | "running" | "paused" | "denied" | "unsupported" | "error";

const CAMERA_OK_KEY = "powerean.cameraOk";

interface UseCameraOptions {
  /** Start right away when the user has allowed the camera before. */
  autoStart?: boolean;
  /** Runs before the stream is requested (from the tap, e.g. to unlock audio). */
  onBeforeStart?: () => void | Promise<unknown>;
  /** Runs once the stream is live. */
  onStarted?: () => void;
}

export function useCamera({ autoStart = true, onBeforeStart, onStarted }: UseCameraOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const hooks = useRef({ onBeforeStart, onStarted });
  hooks.current = { onBeforeStart, onStarted };

  const stop = useCallback((next: CameraState = "idle") => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setTorchOn(false);
    setTorchAvailable(false);
    setState(next);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    setState("starting");
    try {
      const [stream] = await Promise.all([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        }),
        hooks.current.onBeforeStart?.(),
      ]);
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
      setState("running");
      hooks.current.onStarted?.();
    } catch (error) {
      stop(error instanceof DOMException && error.name === "NotAllowedError" ? "denied" : "error");
    }
  }, [stop]);

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
    if (autoStart && readStored(CAMERA_OK_KEY, z.boolean(), false)) void start();
    return () => stop();
  }, [autoStart, start, stop]);

  // Release the camera when the app goes to the background (battery, privacy).
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && streamRef.current) stop("paused");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stop]);

  return {
    videoRef,
    streamRef,
    state,
    live: state === "running" || state === "starting",
    start,
    stop,
    torchAvailable,
    torchOn,
    toggleTorch,
  };
}

/** Norwegian help text for the camera states that need one. */
export function cameraProblemText(state: CameraState, fallback: string): string | null {
  if (state === "denied")
    return `Kameraet er blokkert. På iPhone: Innstillinger → Safari → Kamera → Tillat. ${fallback}`;
  if (state === "unsupported")
    return `Denne nettleseren gir ikke tilgang til kamera. Åpne siden i Safari eller Chrome. ${fallback}`;
  if (state === "error")
    return "Fikk ikke startet kameraet. Lukk andre apper som bruker kameraet og prøv igjen.";
  return null;
}
