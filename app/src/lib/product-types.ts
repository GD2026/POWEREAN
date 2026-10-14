// Shapes shared by the server functions and the UI.

export type StoreAvailability =
  | "in_stock"
  | "store_only"
  | "order_to_store"
  | "order_online"
  | "display_only"
  | "not_available"
  | "unknown";

export interface StoreStock {
  id: number;
  name: string;
  availability: StoreAvailability;
  label: string;
  onDisplay: boolean;
  /** Units in this store. power.no hides this in Norway today, so it is usually null. */
  exactCount: number | null;
}

export interface NearbyStore {
  name: string;
  distanceKm: number | null;
  /** The store only has a display unit. */
  onDisplayOnly: boolean;
}

export interface ProductInfo {
  /** The scanned EAN; null for products found by name/article number. */
  ean: string | null;
  productId: number;
  title: string;
  brand: string | null;
  category: string | null;
  model: string | null;
  price: number | null;
  previousPrice: number | null;
  priceNote: string | null;
  imageUrl: string | null;
  thumbUrl: string | null;
  productUrl: string;
  stock: {
    webCount: number | null;
    webText: string | null;
    allStoresCount: number | null;
    /** Mariero; null when power.no's store lookup failed. */
    store: StoreStock | null;
    /** Nearest other stores that have it, closest first (max 3). */
    nearby: NearbyStore[];
  };
  fetchedAt: string;
}

export type LookupResult =
  | { status: "found"; product: ProductInfo }
  | { status: "not_found"; ean: string }
  | { status: "error"; ean: string; message: string };

export type SearchResult =
  | { status: "found"; query: string; total: number; products: ProductInfo[] }
  | { status: "not_found"; query: string }
  | { status: "error"; query: string; message: string };
