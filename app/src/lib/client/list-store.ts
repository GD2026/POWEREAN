// Pure EAN-list logic. Lists live on the device (localStorage) and travel
// between devices inside a share link, so the server stays stateless.
import { z } from "zod";

import { normalizeEan } from "../ean";
import type { EanList, ListItem, NewItem } from "../list-types";

export const MAX_ITEMS_PER_LIST = 1000;
export const MAX_LISTS = 10;

const itemSchema = z.object({
  id: z.string().min(1).max(64),
  ean: z.string().regex(/^\d{8,14}$/),
  title: z.string().max(200).nullable(),
  price: z.number().finite().nullable(),
  thumbUrl: z.string().startsWith("https://media.power-cdn.net/").max(500).nullable(),
  productUrl: z.string().startsWith("https://www.power.no/").max(500).nullable(),
  done: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
});

const listSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(60),
  updatedAt: z.string(),
  items: z.array(itemSchema).max(MAX_ITEMS_PER_LIST),
});

export const storeSchema = z.object({
  activeId: z.string().nullable(),
  lists: z.array(listSchema).max(MAX_LISTS),
});

export type ListStore = z.infer<typeof storeSchema>;

export const emptyStore: ListStore = { activeId: null, lists: [] };

type Ids = { now: () => string; id: () => string };
const defaultIds: Ids = {
  now: () => new Date().toISOString(),
  id: () => crypto.randomUUID(),
};

export function createList(name: string, ids: Ids = defaultIds): EanList {
  return { id: ids.id(), name: name.slice(0, 60), updatedAt: ids.now(), items: [] };
}

function touch(list: EanList, items: ListItem[], ids: Ids): EanList {
  return { ...list, items, updatedAt: ids.now() };
}

function safeUrl(value: string | null | undefined, origin: string): string | null {
  return value && value.startsWith(`${origin}/`) && value.length <= 500 ? value : null;
}

export type AddResult = { list: EanList; added: number; updated: number; full: boolean };

/**
 * Appends items in order. An EAN already in the list keeps its place and done
 * state; only its product snapshot is refreshed (so re-scanning is harmless).
 */
export function addItems(list: EanList, newItems: NewItem[], ids: Ids = defaultIds): AddResult {
  const items = [...list.items];
  const index = new Map(items.map((it, i) => [it.ean, i]));
  let position = items.reduce((max, it) => Math.max(max, it.position), -1) + 1;
  let added = 0;
  let updated = 0;
  let full = false;
  for (const raw of newItems) {
    const ean = normalizeEan(raw.ean);
    if (!ean) continue;
    const snapshot = {
      title: raw.title?.slice(0, 200) ?? null,
      price: typeof raw.price === "number" && Number.isFinite(raw.price) ? raw.price : null,
      thumbUrl: safeUrl(raw.thumbUrl, "https://media.power-cdn.net"),
      productUrl: safeUrl(raw.productUrl, "https://www.power.no"),
    };
    const at = index.get(ean);
    if (at !== undefined) {
      const old = items[at];
      items[at] = {
        ...old,
        title: snapshot.title ?? old.title,
        price: snapshot.price ?? old.price,
        thumbUrl: snapshot.thumbUrl ?? old.thumbUrl,
        productUrl: snapshot.productUrl ?? old.productUrl,
      };
      updated++;
      continue;
    }
    if (items.length >= MAX_ITEMS_PER_LIST) {
      full = true;
      break;
    }
    index.set(ean, items.length);
    items.push({ id: ids.id(), ean, ...snapshot, done: false, position, createdAt: ids.now() });
    position++;
    added++;
  }
  return { list: added || updated ? touch(list, items, ids) : list, added, updated, full };
}

export function setDone(list: EanList, itemId: string, done: boolean, ids: Ids = defaultIds) {
  return touch(
    list,
    list.items.map((it) => (it.id === itemId ? { ...it, done } : it)),
    ids,
  );
}

export function setAllDone(list: EanList, done: boolean, ids: Ids = defaultIds) {
  return touch(
    list,
    list.items.map((it) => ({ ...it, done })),
    ids,
  );
}

export function removeItem(list: EanList, itemId: string, ids: Ids = defaultIds) {
  return touch(
    list,
    list.items.filter((it) => it.id !== itemId),
    ids,
  );
}

export function clearItems(list: EanList, onlyDone: boolean, ids: Ids = defaultIds) {
  return touch(list, onlyDone ? list.items.filter((it) => !it.done) : [], ids);
}

export function renameList(list: EanList, name: string, ids: Ids = defaultIds): EanList {
  const trimmed = name.trim().slice(0, 60);
  return trimmed ? { ...list, name: trimmed, updatedAt: ids.now() } : list;
}

/** Puts a list into the store (replacing one with the same id) and makes it active. */
export function upsertList(store: ListStore, list: EanList, activate = true): ListStore {
  const others = store.lists.filter((l) => l.id !== list.id);
  // Keep the most recently used lists; the active one is always kept.
  const lists = [list, ...others].slice(0, MAX_LISTS);
  return { activeId: activate ? list.id : store.activeId, lists };
}

// ---- Share links ----------------------------------------------------------
// A share link carries the list itself in the URL fragment (never sent to the
// server): /liste#del=<payload>. Payload = base64url(JSON), deflated when the
// browser supports CompressionStream.

const shareSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  n: z.string().min(1).max(60),
  i: z
    .array(
      z.tuple([
        z.string().regex(/^\d{8,14}$/),
        z.string().max(200).nullable(),
        z.number().finite().nullable(),
        z.union([z.literal(0), z.literal(1)]),
      ]),
    )
    .max(MAX_ITEMS_PER_LIST),
});

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const transform = stream as unknown as TransformStream<Uint8Array, Uint8Array>;
  const response = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(transform));
  return new Uint8Array(await response.arrayBuffer());
}

export async function encodeShare(list: EanList): Promise<string> {
  const payload = {
    v: 1,
    id: list.id,
    n: list.name,
    i: list.items.map((it) => [it.ean, it.title?.slice(0, 80) ?? null, it.price, it.done ? 1 : 0]),
  };
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== "undefined") {
    const packed = await pipeThrough(json, new CompressionStream("deflate-raw"));
    return `z${toBase64Url(packed)}`;
  }
  return `j${toBase64Url(json)}`;
}

const MAX_SHARE_BYTES = 512 * 1024;

/** Decodes and validates a share payload; returns null for anything malformed. */
export async function decodeShare(text: string, ids: Ids = defaultIds): Promise<EanList | null> {
  try {
    if (text.length > MAX_SHARE_BYTES) return null;
    const kind = text[0];
    let bytes = fromBase64Url(text.slice(1));
    if (kind === "z") {
      if (typeof DecompressionStream === "undefined") return null;
      bytes = await pipeThrough(bytes, new DecompressionStream("deflate-raw"));
    } else if (kind !== "j") {
      return null;
    }
    if (bytes.length > MAX_SHARE_BYTES * 4) return null;
    const parsed = shareSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    if (!parsed.success) return null;
    const { id, n, i } = parsed.data;
    const now = ids.now();
    const seen = new Set<string>();
    const items: ListItem[] = [];
    for (const [ean, title, price, done] of i) {
      if (seen.has(ean)) continue;
      seen.add(ean);
      items.push({
        id: ids.id(),
        ean,
        title,
        price,
        thumbUrl: null,
        productUrl: null,
        done: done === 1,
        position: items.length,
        createdAt: now,
      });
    }
    return { id, name: n, updatedAt: now, items };
  } catch {
    return null;
  }
}
