// List shapes shared by the server (lists.server.ts) and the UI.

export interface ListItem {
  id: string;
  ean: string;
  title: string | null;
  price: number | null;
  thumbUrl: string | null;
  productUrl: string | null;
  done: boolean;
  position: number;
  createdAt: string;
}

export interface EanList {
  id: string;
  name: string;
  updatedAt: string;
  items: ListItem[];
}

export interface NewItem {
  ean: string;
  title?: string | null;
  price?: number | null;
  thumbUrl?: string | null;
  productUrl?: string | null;
}
