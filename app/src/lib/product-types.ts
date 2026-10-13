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

export interface ProductInfo {
  ean: string;
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
    store: StoreStock | null;
  };
  fetchedAt: string;
}

export type LookupResult =
  | { status: "found"; product: ProductInfo }
  | { status: "not_found"; ean: string }
  | { status: "error"; ean: string; message: string };
