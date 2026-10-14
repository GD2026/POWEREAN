import { availabilityTone, formatCount, formatPrice } from "@/lib/client/format";
import type { ProductInfo, SearchResult } from "@/lib/product-types";

import { BarcodeIcon, OpenIcon } from "./icons";

function StockRow({ p }: { p: ProductInfo }) {
  const store = p.stock.store;
  const tone = store ? availabilityTone(store.availability) : "neutral";
  return (
    <li className="pe-card pe-stockrow">
      <div className="pe-stockrow-main">
        {p.thumbUrl ? (
          <img
            className="pe-stockrow-img"
            src={p.imageUrl ?? p.thumbUrl}
            alt=""
            width={76}
            height={76}
            loading="lazy"
          />
        ) : (
          <span className="pe-stockrow-img pe-product-img--empty" aria-hidden>
            <BarcodeIcon width={28} height={28} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <b className="pe-stockrow-title">{p.title}</b>
          <div className="pe-small pe-muted">
            Varenr {p.productId}
            {p.model ? ` · ${p.model}` : ""}
          </div>
          <div className="pe-price" style={{ marginTop: 4 }}>
            <strong style={{ fontSize: 20 }}>{formatPrice(p.price) ?? "Ingen pris"}</strong>
            {p.previousPrice != null && <s>{formatPrice(p.previousPrice)}</s>}
          </div>
        </div>
      </div>
      <div className="pe-status" data-tone={tone}>
        <span className="pe-status-dot" aria-hidden />
        <div>
          {store
            ? store.exactCount != null
              ? `${store.exactCount} stk på lager i Mariero`
              : store.label
            : "Lagerstatus for Mariero ikke tilgjengelig"}
          <small>
            {store?.onDisplay ? "Utstillingsmodell i butikk · " : ""}
            Nettlager {formatCount(p.stock.webCount)} · Alle butikker{" "}
            {formatCount(p.stock.allStoresCount)}
          </small>
        </div>
      </div>
      <a className="pe-btn" href={p.productUrl} target="_blank" rel="noopener noreferrer">
        <OpenIcon aria-hidden />
        Åpne på power.no
      </a>
    </li>
  );
}

interface StockResultsProps {
  result: SearchResult | undefined;
  loading: boolean;
  query: string;
  onRetry: () => void;
}

export function StockResults({ result, loading, query, onRetry }: StockResultsProps) {
  if (loading || !result) {
    return (
      <div className="pe-card pe-message" aria-busy="true">
        <h2>Søker etter «{query}»…</h2>
        <div className="pe-skeleton" style={{ height: 76 }} />
        <div className="pe-skeleton" style={{ height: 44 }} />
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div className="pe-card pe-message" role="status">
        <h2>Fikk ikke søkt</h2>
        <p className="pe-muted pe-small" style={{ margin: 0 }}>
          {result.message}.
        </p>
        <button type="button" className="pe-btn" onClick={onRetry}>
          Prøv igjen
        </button>
      </div>
    );
  }
  if (result.status === "not_found") {
    return (
      <div className="pe-card pe-message" role="status">
        <h2>Ingen treff for «{query}»</h2>
        <p className="pe-muted pe-small" style={{ margin: 0 }}>
          Prøv varenummeret (7 siffer), modellkoden, eller bare merke og modell, f.eks. «LG G6»
          eller «iPhone 17 Pro Max 512».
        </p>
      </div>
    );
  }
  return (
    <section aria-live="polite" style={{ display: "grid", gap: 12 }}>
      <h2 className="pe-section-title">
        {result.total > result.products.length
          ? `Beste ${result.products.length} av ${result.total} treff`
          : `${result.products.length} treff`}{" "}
        · «{result.query}»
      </h2>
      <ul className="pe-items">
        {result.products.map((p) => (
          <StockRow key={p.productId} p={p} />
        ))}
      </ul>
    </section>
  );
}
