import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";

import { AppShell } from "@/components/powerean/AppShell";
import { KeyboardIcon, StoreIcon } from "@/components/powerean/icons";
import { ProductCard } from "@/components/powerean/ProductCard";
import { Scanner } from "@/components/powerean/Scanner";
import { lookupProduct } from "@/lib/api/powerean.functions";
import { formatPrice, spacedEan } from "@/lib/client/format";
import { useEanList } from "@/lib/client/list-context";
import { readStored, writeStored } from "@/lib/client/storage";
import { normalizeEan } from "@/lib/ean";
import type { NewItem } from "@/lib/list-types";
import type { LookupResult } from "@/lib/product-types";

export const Route = createFileRoute("/")({
  component: ScanPage,
});

const AUTO_ADD_KEY = "powerean.autoAdd";
const RECENT_KEY = "powerean.recent";

const recentSchema = z.array(
  z.object({
    ean: z.string().regex(/^\d{8,14}$/),
    title: z.string().nullable(),
    price: z.number().nullable(),
    thumbUrl: z.string().nullable(),
  }),
);
type Recent = z.infer<typeof recentSchema>[number];

function toListItem(ean: string, result: LookupResult | undefined): NewItem {
  if (result?.status !== "found") return { ean };
  const p = result.product;
  return { ean, title: p.title, price: p.price, thumbUrl: p.thumbUrl, productUrl: p.productUrl };
}

function ScanPage() {
  const { list, add } = useEanList();
  const [ean, setEan] = useState<string | null>(null);
  // Bumped on every scan, so scanning the same EAN again is a new event.
  const [scanSeq, setScanSeq] = useState(0);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [autoAdd, setAutoAdd] = useState(true);
  const [recent, setRecent] = useState<Recent[]>([]);
  const handledSeq = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setAutoAdd(readStored(AUTO_ADD_KEY, z.boolean(), true));
    setRecent(readStored(RECENT_KEY, recentSchema, []));
  }, []);

  const product = useQuery({
    queryKey: ["product", ean],
    queryFn: () => lookupProduct({ data: { ean: ean! } }),
    enabled: ean != null,
    staleTime: 60_000,
    retry: 1,
  });

  const inList = ean != null && (list?.items.some((i) => i.ean === ean) ?? false);

  // Once a lookup settles (or fails outright): remember it, and add it to the
  // EAN list when auto-add is on. The code still has to go into the internal
  // system even when power.no is unreachable, so failures are added too.
  useEffect(() => {
    if (!ean || product.isFetching || (!product.data && !product.isError)) return;
    if (handledSeq.current === scanSeq) return;
    handledSeq.current = scanSeq;
    const result = product.data;
    const found = result?.status === "found" ? result.product : null;
    setRecent((prev) => {
      const next = [
        {
          ean,
          title: found?.title ?? null,
          price: found?.price ?? null,
          thumbUrl: found?.thumbUrl ?? null,
        },
        ...prev.filter((r) => r.ean !== ean),
      ].slice(0, 15);
      writeStored(RECENT_KEY, next);
      return next;
    });
    if (autoAdd) void add([toListItem(ean, result)]);
  }, [ean, scanSeq, product.isFetching, product.data, product.isError, autoAdd, add]);

  const show = useCallback((code: string) => {
    setEan(code);
    setScanSeq((n) => n + 1);
    window.setTimeout(
      () => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      50,
    );
  }, []);

  const onManual = (e: FormEvent) => {
    e.preventDefault();
    const code = normalizeEan(manual);
    if (!code) {
      setManualError("Skriv 8–14 siffer");
      return;
    }
    setManualError(null);
    setManual("");
    show(code);
  };

  return (
    <AppShell title="EAN-skanner" subtitle="Pris og lager · POWER Mariero">
      <Scanner onDetected={show} />

      <form className="pe-manual" onSubmit={onManual} noValidate>
        <label className="sr-only" htmlFor="manual-ean">
          Skriv inn EAN
        </label>
        <input
          id="manual-ean"
          className="pe-input pe-input--mono"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Skriv inn EAN"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          aria-invalid={manualError != null}
          aria-describedby={manualError ? "manual-ean-error" : undefined}
          maxLength={20}
        />
        <button type="submit" className="pe-btn pe-btn--primary" style={{ minHeight: 48 }}>
          <KeyboardIcon aria-hidden />
          Søk
        </button>
        {manualError && (
          <div
            id="manual-ean-error"
            className="pe-small"
            style={{ color: "var(--bad)", gridColumn: "1 / -1" }}
          >
            {manualError}
          </div>
        )}
      </form>

      <div ref={cardRef} aria-live="polite">
        {ean ? (
          <ProductCard
            ean={ean}
            result={product.data}
            loading={product.isFetching && !product.data}
            inList={inList}
            onAddToList={() => void add([toListItem(ean, product.data)])}
            onRetry={() => void product.refetch()}
          />
        ) : (
          <div className="pe-card pe-message">
            <h2>Klar til å skanne</h2>
            <p className="pe-muted pe-small" style={{ margin: 0 }}>
              Du får bilde, pris og lagerstatus for POWER Mariero rett fra power.no. Skannede EAN
              legges i EAN-listen, klare til å skannes inn i butikksystemet.
            </p>
          </div>
        )}
      </div>

      <label className="pe-card pe-switch">
        <span>Legg skannede varer automatisk i EAN-listen</span>
        <input
          type="checkbox"
          role="switch"
          checked={autoAdd}
          onChange={(e) => {
            setAutoAdd(e.target.checked);
            writeStored(AUTO_ADD_KEY, e.target.checked);
          }}
        />
      </label>

      {recent.length > 0 && (
        <>
          <h2 className="pe-section-title">Sist skannet</h2>
          <ul className="pe-card pe-recent">
            {recent.map((r) => (
              <li key={r.ean}>
                <button type="button" onClick={() => show(r.ean)}>
                  {r.thumbUrl ? (
                    <img
                      className="pe-thumb"
                      src={r.thumbUrl}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                    />
                  ) : (
                    <span className="pe-thumb" aria-hidden />
                  )}
                  <span className="pe-recent-text">
                    <b>{r.title ?? "Ukjent produkt"}</b>
                    <span className="pe-ean">{spacedEan(r.ean)}</span>
                  </span>
                  {r.price != null && <span className="pe-small">{formatPrice(r.price)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="pe-disclaimer">
        <StoreIcon width={14} height={14} style={{ verticalAlign: "-2px" }} aria-hidden />{" "}
        Uoffisielt hjelpeverktøy. Pris og lager hentes fra power.no og kan avvike fra
        butikksystemet.
      </p>
    </AppShell>
  );
}
