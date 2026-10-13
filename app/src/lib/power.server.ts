// Server-only client for power.no's public web API (the same endpoints the
// power.no website calls). The browser cannot call it directly (no CORS), so
// the Worker proxies it. Only fixed hosts and digit-only EANs ever reach a
// URL, so there is no SSRF surface.
import { z } from "zod";

import { normalizeEan } from "./ean";
import type { LookupResult, ProductInfo, StoreAvailability, StoreStock } from "./product-types";

const POWER_ORIGIN = "https://www.power.no";
const IMAGE_ORIGIN = "https://media.power-cdn.net";
const TIMEOUT_MS = 6000;

export const MARIERO = Object.freeze({
  storeId: 1690,
  name: "POWER Mariero",
  postalCode: "4017",
});

// Lenient schemas: validate only what we read, ignore everything else.
const imageSchema = z
  .object({
    basePath: z.string(),
    variants: z
      .array(
        z.object({
          filename: z.string(),
          width: z.number(),
          isTransparent: z.boolean().optional(),
        }),
      )
      .default([]),
  })
  .nullish();

const searchProductSchema = z.object({
  productId: z.number().int().positive(),
  title: z.string(),
  manufacturerName: z.string().nullish(),
  categoryName: z.string().nullish(),
  productManufactorIdentity: z.string().nullish(),
  price: z.number().nullish(),
  previousPrice: z.number().nullish(),
  previousPriceDisclaimer: z.string().nullish(),
  productImage: imageSchema,
  url: z.string(),
  stockCount: z.number().nullish(),
  storesStockCount: z.number().nullish(),
  webStockText: z.string().nullish(),
});

const searchSchema = z.object({
  products: z.array(z.unknown()).default([]),
  totalProductCount: z.number().optional(),
});

const storeRowSchema = z.object({
  storeId: z.number(),
  name: z.string(),
  storeAvailability: z.number().nullish(),
  storeDisplayStock: z.number().nullish(),
  storeStockCount: z.number().nullish(),
});

export type PowerSearchProduct = z.input<typeof searchProductSchema>;

// Store availability enum from power.no's frontend (ProductStoreAvailabilityEnum).
const AVAILABILITY: Record<number, { key: StoreAvailability; label: string }> = {
  1: { key: "not_available", label: "Ikke på lager i butikk" },
  2: { key: "in_stock", label: "På lager i butikk" },
  3: { key: "store_only", label: "På lager – kun salg i butikk" },
  4: { key: "order_to_store", label: "Ikke på lager – kan bestilles til butikk" },
  5: { key: "order_online", label: "Ikke på lager – sendes fra sentrallager (3–7 dager)" },
  6: { key: "display_only", label: "Kun utstillingsmodell" },
};

// Norwegian texts for webStockText keys, from power.no's own dictionary.
const WEB_STOCK_TEXT: Record<string, string> = {
  "Product.Stock.aLotLeft": "På nettlager (100+)",
  "Product.Stock.GoodStock": "På nettlager (50+)",
  "Product.Stock.SomeLeft": "På nettlager (10+)",
  "Product.Stock.FewLeft": "På nettlager (<5)",
  "Product.Stock.WebStock": "Ikke på nettlager",
  "Product.Stock.NotInStock": "Ikke på lager",
  "Product.Stock.NotInStock.Dealer": "Ikke på lager",
  "Product.Stock.ComingIn": "Forventet inn til hovedlager",
  "Product.Stock.RemoteStock": "Forventet hovedlager",
  "Product.Stock.OnDemand": "Bestillingsvare, 2–4 ukers leveringstid",
  "Product.Stock.OnDemand.Short": "Bestillingsvare, 2–4 ukers leveringstid",
  "Product.Stock.CrossDockInStock": "Sendes fra eksternt lager, 1–2 uker",
  "Product.Stock.SFSInStock": "Sendes fra butikklager",
  "Product.Stock.Preorder": "Forhåndsbestilling",
  "Product.Stock.NoLongerAvailable": "Produktet er ikke lenger tilgjengelig",
  "Product.Stock.OnlyPurchasableInStore": "Kan kun kjøpes i butikk",
};

function pickImage(image: z.infer<typeof imageSchema>, preferredWidth: number): string | null {
  if (!image || !image.basePath.startsWith("/")) return null;
  // Opaque JPEGs render everywhere (including old iOS) and look right on any background.
  const candidates = image.variants
    .filter((v) => !v.isTransparent && /^[\w.-]+\.(jpg|jpeg|png|webp)$/i.test(v.filename))
    .sort((a, b) => Math.abs(a.width - preferredWidth) - Math.abs(b.width - preferredWidth));
  const best = candidates[0];
  return best ? `${IMAGE_ORIGIN}${image.basePath}/${best.filename}` : null;
}

function toStoreStock(rows: unknown[]): StoreStock | null {
  for (const raw of rows) {
    const parsed = storeRowSchema.safeParse(raw);
    if (!parsed.success || parsed.data.storeId !== MARIERO.storeId) continue;
    const row = parsed.data;
    const mapped = AVAILABILITY[row.storeAvailability ?? -1] ?? {
      key: "unknown" as const,
      label: "Ukjent lagerstatus",
    };
    return {
      id: row.storeId,
      name: row.name,
      availability: mapped.key,
      label: mapped.label,
      onDisplay: (row.storeDisplayStock ?? 0) > 0,
      exactCount: typeof row.storeStockCount === "number" ? row.storeStockCount : null,
    };
  }
  return null;
}

export function toProductInfo(ean: string, rawProduct: unknown, storeRows: unknown[]): ProductInfo {
  const p = searchProductSchema.parse(rawProduct);
  const productPath = p.url.startsWith("/") ? p.url : `/${p.url}`;
  return {
    ean,
    productId: p.productId,
    title: p.title,
    brand: p.manufacturerName ?? null,
    category: p.categoryName ?? null,
    model: p.productManufactorIdentity ?? null,
    price: p.price ?? null,
    previousPrice: p.previousPrice && p.price && p.previousPrice > p.price ? p.previousPrice : null,
    priceNote: p.previousPriceDisclaimer ?? null,
    imageUrl: pickImage(p.productImage, 600),
    thumbUrl: pickImage(p.productImage, 150),
    productUrl: `${POWER_ORIGIN}${productPath}`,
    stock: {
      webCount: p.stockCount ?? null,
      webText: p.webStockText ? (WEB_STOCK_TEXT[p.webStockText] ?? null) : null,
      allStoresCount: p.storesStockCount ?? null,
      store: toStoreStock(storeRows),
    },
    fetchedAt: new Date().toISOString(),
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetchImpl: FetchLike, path: string, params: Record<string, string>) {
  const url = new URL(path, POWER_ORIGIN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetchImpl(url.toString(), {
    headers: { accept: "application/json", "accept-language": "nb-NO" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`power.no svarte ${response.status}`);
  return (await response.json()) as unknown;
}

export async function lookupPowerProduct(
  input: string,
  fetchImpl: FetchLike = fetch,
): Promise<LookupResult> {
  const ean = normalizeEan(input);
  if (!ean) return { status: "error", ean: input.slice(0, 20), message: "Ugyldig EAN" };

  let first: unknown;
  try {
    const search = searchSchema.parse(
      await getJson(fetchImpl, "/api/v2/productlists", { q: ean, size: "5" }),
    );
    first = search.products[0];
  } catch (error) {
    console.error("power.no search failed", error instanceof Error ? error.message : error);
    return { status: "error", ean, message: "Fikk ikke kontakt med power.no" };
  }
  if (!first) return { status: "not_found", ean };

  const productId = searchProductSchema.shape.productId.safeParse(
    (first as { productId?: unknown }).productId,
  );
  if (!productId.success) return { status: "error", ean, message: "Uventet svar fra power.no" };

  // Store stock is best-effort: a product card without it beats no card.
  let storeRows: unknown[] = [];
  try {
    const rows = await getJson(fetchImpl, `/api/v2/products/${productId.data}/stores`, {
      postalCode: MARIERO.postalCode,
      amount: "5",
    });
    if (Array.isArray(rows)) storeRows = rows;
  } catch (error) {
    console.error("power.no store stock failed", error instanceof Error ? error.message : error);
  }

  try {
    return { status: "found", product: toProductInfo(ean, first, storeRows) };
  } catch {
    return { status: "error", ean, message: "Uventet svar fra power.no" };
  }
}
