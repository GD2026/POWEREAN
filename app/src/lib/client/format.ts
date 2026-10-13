import type { StoreAvailability } from "../product-types";

export function formatPrice(value: number | null | undefined): string | null {
  if (value == null) return null;
  const rounded = Math.round(value * 100) / 100;
  const whole = Number.isInteger(rounded);
  return `${rounded.toLocaleString("nb-NO", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })},-`;
}

export function formatCount(value: number | null | undefined): string {
  return value == null ? "–" : value.toLocaleString("nb-NO");
}

export type Tone = "ok" | "warn" | "bad" | "neutral";

export function availabilityTone(availability: StoreAvailability): Tone {
  switch (availability) {
    case "in_stock":
    case "store_only":
      return "ok";
    case "order_to_store":
    case "order_online":
    case "display_only":
      return "warn";
    case "not_available":
      return "bad";
    default:
      return "neutral";
  }
}

/** Groups digits the way they are printed under an EAN-13 (1 6 6). */
export function spacedEan(ean: string): string {
  if (ean.length === 13) return `${ean[0]} ${ean.slice(1, 7)} ${ean.slice(7)}`;
  if (ean.length === 8) return `${ean.slice(0, 4)} ${ean.slice(4)}`;
  return ean;
}
