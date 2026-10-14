import { availabilityTone, formatCount } from "@/lib/client/format";
import type { ProductInfo } from "@/lib/product-types";

/**
 * POWER Mariero stock for a product (looked up with postal code 4017), plus the
 * nearest other stores that have it when Mariero does not.
 */
export function MarieroStatus({
  product,
  showCounts = true,
}: {
  product: ProductInfo;
  /** Off where the card already shows web and all-store counts. */
  showCounts?: boolean;
}) {
  const { store, nearby, webCount, allStoresCount } = product.stock;
  const tone = store ? availabilityTone(store.availability) : "neutral";
  const inMariero = store?.availability === "in_stock" || store?.availability === "store_only";

  return (
    <div className="pe-status" data-tone={tone}>
      <span className="pe-status-dot" aria-hidden />
      <div>
        {store
          ? store.exactCount != null
            ? `${store.exactCount} stk på lager i Mariero`
            : store.label
          : "Fikk ikke hentet lager for Mariero"}
        {(showCounts || store?.onDisplay) && (
          <small>
            {store?.onDisplay ? "Utstillingsmodell i butikk" : ""}
            {store?.onDisplay && showCounts ? " · " : ""}
            {showCounts &&
              `Nettlager ${formatCount(webCount)} · Alle butikker ${formatCount(allStoresCount)}`}
          </small>
        )}
        {!inMariero && nearby.length > 0 && (
          <small className="pe-nearby">
            Finnes i:{" "}
            {nearby
              .map(
                (s) =>
                  `${s.name.replace(/^POWER /, "")}${s.distanceKm != null ? ` (${s.distanceKm} km)` : ""}${s.onDisplayOnly ? " – utstilling" : ""}`,
              )
              .join(", ")}
          </small>
        )}
        {store && !inMariero && nearby.length === 0 && allStoresCount === 0 && (
          <small className="pe-nearby">Ingen POWER-butikker har den på lager.</small>
        )}
      </div>
    </div>
  );
}
