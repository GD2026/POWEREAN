import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/powerean/AppShell";
import { CameraIcon, ImageIcon, SearchIcon, TorchIcon } from "@/components/powerean/icons";
import { StockResults } from "@/components/powerean/StockResults";
import { searchProducts } from "@/lib/api/powerean.functions";
import { prepareForOcr, readText, warmUpOcr } from "@/lib/client/ocr";
import { cameraProblemText, useCamera } from "@/lib/client/use-camera";
import { extractTagCandidates, type TagCandidate } from "@/lib/search-text";

export const Route = createFileRoute("/lager")({
  head: () => ({ meta: [{ title: "Lagersjekk · EAN-skanner" }] }),
  component: StockCheckPage,
});

// The guide frame on screen (see .pe-scanner--tag in powerean.css), as fractions.
const TAG_CROP = { x: 0.05, y: 0.12, w: 0.9, h: 0.76 };

const KIND_LABEL: Record<TagCandidate["kind"], string> = {
  varenr: "Varenr",
  ean: "EAN",
  modell: "Modell",
  navn: "Navn",
};

type Reading = { fraction: number; label: string } | null;

function StockCheckPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [reading, setReading] = useState<Reading>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TagCandidate[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const camera = useCamera({ onStarted: warmUpOcr });

  const search = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchProducts({ data: { q: query! } }),
    enabled: query != null,
    staleTime: 60_000,
    retry: 1,
  });

  const runSearch = useCallback((q: string) => {
    const clean = q.replace(/\s+/g, " ").trim().slice(0, 120);
    if (clean.length < 2) return;
    setInput(clean);
    setQuery(clean);
    window.setTimeout(
      () => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  }, []);

  const readImage = useCallback(
    async (canvas: HTMLCanvasElement) => {
      setPreview(canvas.toDataURL("image/jpeg", 0.7));
      setCandidates([]);
      setRawText(null);
      setReading({ fraction: 0, label: "Laster tekstleser" });
      try {
        const text = await readText(canvas, (fraction, label) => setReading({ fraction, label }));
        const found = extractTagCandidates(text);
        setRawText(text.trim());
        setCandidates(found);
        if (found[0]) runSearch(found[0].value);
      } catch {
        setRawText("");
      } finally {
        setReading(null);
      }
    },
    [runSearch],
  );

  const capture = () => {
    const video = camera.videoRef.current;
    if (!video || !video.videoWidth || reading) return;
    void readImage(prepareForOcr(video, video.videoWidth, video.videoHeight, TAG_CROP));
  };

  const onFile = async (file: File | undefined) => {
    if (!file || reading) return;
    try {
      const bitmap = await createImageBitmap(file);
      await readImage(prepareForOcr(bitmap, bitmap.width, bitmap.height));
      bitmap.close();
    } catch {
      setRawText("");
    }
  };

  // Load the reader once the page is open, so the first photo is quick.
  useEffect(() => {
    const t = window.setTimeout(warmUpOcr, 1500);
    return () => window.clearTimeout(t);
  }, []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    runSearch(input);
  };

  const problem = cameraProblemText(camera.state, "Bruk «Velg bilde» eller skriv inn under.");

  return (
    <AppShell title="Lagersjekk" subtitle="Ta bilde av prislappen · POWER Mariero">
      <div className="pe-scanner pe-scanner--tag">
        <video
          ref={camera.videoRef}
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
              {camera.state === "starting"
                ? "Starter kamera…"
                : "Fyll rammen med prislappen og hold stille"}
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
            <button
              type="button"
              className="pe-shutter"
              aria-label="Ta bilde av prislappen"
              onClick={capture}
              disabled={reading != null || camera.state !== "running"}
            />
          </>
        ) : (
          <div className="pe-scanner-idle">
            <CameraIcon aria-hidden />
            <p>
              {problem ??
                "Ta bilde av prislappen. Appen leser varenummer, modell eller navn og sjekker lageret."}
            </p>
            <button
              type="button"
              className="pe-btn pe-btn--primary pe-btn--big"
              onClick={() => void camera.start()}
            >
              <CameraIcon aria-hidden />
              {camera.state === "paused" ? "Fortsett" : "Start kamera"}
            </button>
          </div>
        )}
      </div>

      <div className="pe-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button
          type="button"
          className="pe-btn pe-btn--primary"
          onClick={capture}
          disabled={!camera.live || reading != null}
        >
          <CameraIcon aria-hidden />
          Ta bilde
        </button>
        <button
          type="button"
          className="pe-btn"
          onClick={() => fileRef.current?.click()}
          disabled={reading != null}
        >
          <ImageIcon aria-hidden />
          Velg bilde
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <form className="pe-manual" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="stock-q">
          Varenr, modell eller navn
        </label>
        <input
          id="stock-q"
          className="pe-input"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Varenr, modell eller navn"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={120}
        />
        <button type="submit" className="pe-btn pe-btn--primary" style={{ minHeight: 48 }}>
          <SearchIcon aria-hidden />
          Søk
        </button>
      </form>

      {(reading || preview) && (
        <section className="pe-card pe-ocr">
          {preview && <img className="pe-ocr-preview" src={preview} alt="Bildet som ble lest" />}
          {reading ? (
            <div role="status" style={{ display: "grid", gap: 8 }}>
              <span className="pe-small">
                {reading.label}… {Math.round(reading.fraction * 100)} %
              </span>
              <div className="pe-progress">
                <i
                  style={{
                    width: `${Math.round(reading.fraction * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            </div>
          ) : candidates.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              <span className="pe-small pe-muted">Fant på lappen – trykk for å søke:</span>
              <div className="pe-chips">
                {candidates.map((c) => (
                  <button
                    key={`${c.kind}:${c.value}`}
                    type="button"
                    className="pe-chip"
                    aria-pressed={query === c.value}
                    onClick={() => runSearch(c.value)}
                  >
                    <small>{KIND_LABEL[c.kind]}</small>
                    {c.value}
                  </button>
                ))}
              </div>
            </div>
          ) : rawText != null ? (
            <p className="pe-small" style={{ margin: 0 }}>
              Fant ingen tekst å søke på. Gå nærmere, unngå gjenskinn, eller skriv inn varenummeret.
            </p>
          ) : null}
          {rawText && (
            <details className="pe-small pe-muted">
              <summary>Teksten som ble lest</summary>
              <pre className="pe-ocr-text">{rawText}</pre>
            </details>
          )}
        </section>
      )}

      <div ref={resultsRef} style={{ scrollMarginTop: 80 }}>
        {query && (
          <StockResults
            result={search.data}
            loading={search.isFetching && !search.data}
            query={query}
            onRetry={() => void search.refetch()}
          />
        )}
      </div>

      {!query && !preview && (
        <p className="pe-disclaimer">
          Tips: Varenummeret (7 siffer) på prislappen gir alltid riktig vare. Lager hentes fra
          power.no og kan avvike fra butikksystemet.
        </p>
      )}
    </AppShell>
  );
}
