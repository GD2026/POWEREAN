import { availabilityTone, formatCount, formatPrice, spacedEan } from "@/lib/client/format";
import type { LookupResult } from "@/lib/product-types";

import { BarcodeIcon, CheckIcon, ChecklistIcon, OpenIcon } from "./icons";

interface ProductCardProps {
  ean: string;
  result: LookupResult | undefined;
  loading: boolean;
  inList: boolean;
  onAddToList: () => void;
  onRetry: () => void;
}

export function ProductCard({
  ean,
  result,
  loading,
  inList,
  onAddToList,
  onRetry,
}: ProductCardProps) {
  const listButton = (
    <button
      type="button"
      className={`pe-btn pe-btn--big ${inList ? "" : "pe-btn--primary"}`}
      onClick={onAddToList}
      disabled={inList}
    >
      {inList ? <CheckIcon aria-hidden /> : <ChecklistIcon aria-hidden />}
      {inList ? "Lagt i EAN-listen" : "Legg i EAN-listen"}
    </button>
  );

  if (loading || !result) {
    return (
      <article className="pe-card pe-product" aria-busy="true" aria-label={`Henter ${ean}`}>
        <div className="pe-product-img pe-skeleton" />
        <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
          <div className="pe-skeleton" style={{ height: 18, width: "85%" }} />
          <div className="pe-skeleton" style={{ height: 14, width: "50%" }} />
          <div className="pe-skeleton" style={{ height: 28, width: "40%", marginTop: 8 }} />
        </div>
        <div className="pe-status pe-skeleton" style={{ height: 44 }} />
      </article>
    );
  }

  if (result.status !== "found") {
    const notFound = result.status === "not_found";
    return (
      <article className="pe-card pe-message" role="status">
        <h2>{notFound ? "Fant ikke produktet på power.no" : "Fikk ikke hentet produktet"}</h2>
        <div className="pe-ean">{spacedEan(ean)}</div>
        <p className="pe-muted pe-small" style={{ margin: 0 }}>
          {notFound
            ? "EAN-en finnes ikke i nettbutikken (kan være utgått eller kun i butikk). Du kan fortsatt legge den i listen."
            : `${result.message}. Sjekk nettet og prøv igjen.`}
        </p>
        <div className="pe-row">
          {!notFound && (
            <button type="button" className="pe-btn" onClick={onRetry}>
              Prøv igjen
            </button>
          )}
        </div>
        {listButton}
      </article>
    );
  }

  const p = result.product;
  const store = p.stock.store;
  const tone = store ? availabilityTone(store.availability) : "neutral";
  return (
    <article className="pe-card pe-product" aria-label={p.title}>
      {p.imageUrl ? (
        <img
          className="pe-product-img"
          src={p.imageUrl}
          alt=""
          width={112}
          height={112}
          decoding="async"
        />
      ) : (
        <div className="pe-product-img pe-product-img--empty">
          <BarcodeIcon width={40} height={40} aria-hidden />
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <h2>{p.title}</h2>
        <div className="pe-ean">{spacedEan(p.ean)}</div>
        {p.model && <div className="pe-small pe-muted">Modell {p.model}</div>}
        <div className="pe-price">
          <strong>{formatPrice(p.price) ?? "Ingen pris"}</strong>
          {p.previousPrice != null && <s>{formatPrice(p.previousPrice)}</s>}
        </div>
        {p.priceNote && p.previousPrice != null && (
          <div className="pe-small pe-muted">{p.priceNote}</div>
        )}
      </div>

      <div className="pe-status" data-tone={tone}>
        <span className="pe-status-dot" aria-hidden />
        <div>
          {store
            ? store.exactCount != null
              ? `${store.exactCount} stk på lager i ${store.name.replace(/^POWER /, "")}`
              : store.label
            : "Lagerstatus for Mariero er ikke tilgjengelig"}
          <small>
            {store
              ? `${store.name}${store.onDisplay ? " · utstillingsmodell i butikk" : ""}`
              : "Prøv igjen om litt"}
          </small>
        </div>
      </div>

      <div className="pe-stock">
        <div className="pe-stat">
          <b>{formatCount(p.stock.webCount)}</b>
          <span>{p.stock.webText ?? "på nettlager"}</span>
        </div>
        <div className="pe-stat">
          <b>{formatCount(p.stock.allStoresCount)}</b>
          <span>i alle POWER-butikker</span>
        </div>
      </div>

      <div className="pe-product-actions" style={{ display: "grid", gap: 8 }}>
        {listButton}
        <a className="pe-btn" href={p.productUrl} target="_blank" rel="noopener noreferrer">
          <OpenIcon aria-hidden />
          Åpne på power.no
        </a>
      </div>
    </article>
  );
}
