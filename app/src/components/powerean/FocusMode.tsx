import { useCallback, useEffect, useMemo, useState } from "react";

import { formatPrice } from "@/lib/client/format";
import type { ListItem } from "@/lib/list-types";

import { Barcode } from "./Barcode";
import { BackIcon, CloseIcon, DoneAllIcon, NextIcon } from "./icons";

interface FocusModeProps {
  items: ListItem[];
  onDone: (itemId: string) => void;
  onClose: () => void;
}

type WakeLock = { release: () => Promise<void> };

/**
 * One big barcode at a time on pure white, for feeding the codes into the
 * internal system with the store's handheld scanner. "Ferdig" marks the code
 * as entered and moves on. Keyboard: Enter/Space/→ next, ← back, Esc close.
 */
export function FocusMode({ items, onDone, onClose }: FocusModeProps) {
  // Work through the codes that were pending when the mode opened, in list order.
  const [queue] = useState(() => items.filter((i) => !i.done).map((i) => i.id));
  const [index, setIndex] = useState(0);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const current = index < queue.length ? byId.get(queue[index]) : undefined;
  const finished = index >= queue.length;

  const next = useCallback(() => {
    if (current) onDone(current.id);
    setIndex((i) => Math.min(i + 1, queue.length));
  }, [current, onDone, queue.length]);
  const skip = useCallback(() => setIndex((i) => Math.min(i + 1, queue.length)), [queue.length]);
  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Keep the screen on while codes are being scanned off it.
  useEffect(() => {
    let lock: WakeLock | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } })
          .wakeLock;
        const l = await wl?.request("screen");
        if (cancelled) await l?.release();
        else lock = l ?? null;
      } catch {
        // Unsupported or denied: the mode still works.
      }
    };
    void request();
    const onVisible = () => {
      if (!document.hidden) void request();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") back();
      else if (!finished && (e.key === "Enter" || e.key === " " || e.key === "ArrowRight")) {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, onClose, finished]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div className="pe-focus" role="dialog" aria-modal="true" aria-label="Skannemodus">
      <div className="pe-focus-top">
        <span>{finished ? "Ferdig" : `${index + 1} av ${queue.length}`}</span>
        <button
          type="button"
          className="pe-icon-btn"
          aria-label="Lukk skannemodus"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="pe-focus-body">
        {current ? (
          <>
            <Barcode value={current.ean} size="focus" />
            <div className="pe-focus-ean">{current.ean}</div>
            {(current.title || current.price != null) && (
              <div className="pe-focus-title">
                {current.title}
                {current.price != null && ` · ${formatPrice(current.price)}`}
              </div>
            )}
          </>
        ) : finished ? (
          <>
            <DoneAllIcon width={72} height={72} style={{ color: "#0f7a43" }} aria-hidden />
            <div className="pe-focus-ean" style={{ fontFamily: "inherit", letterSpacing: 0 }}>
              Alle EAN er lagt inn
            </div>
            <div className="pe-focus-title">{queue.length} koder er markert som ferdige.</div>
          </>
        ) : (
          <div className="pe-focus-title">Denne EAN-en er fjernet fra listen.</div>
        )}
      </div>

      <div>
        {finished ? (
          <button type="button" className="pe-btn pe-btn--big" onClick={onClose}>
            Tilbake til listen
          </button>
        ) : (
          <div className="pe-focus-actions">
            <button
              type="button"
              className="pe-btn pe-btn--big"
              onClick={back}
              disabled={index === 0}
              aria-label="Forrige"
            >
              <BackIcon />
            </button>
            <button type="button" className="pe-btn pe-btn--big" onClick={skip}>
              Hopp over
            </button>
            <button type="button" className="pe-btn pe-btn--big pe-btn--primary" onClick={next}>
              Ferdig – neste
              <NextIcon aria-hidden />
            </button>
          </div>
        )}
        <p className="pe-focus-tip">
          Tips: skru opp lysstyrken og hold skanneren 10–20 cm fra skjermen.
        </p>
      </div>
    </div>
  );
}
