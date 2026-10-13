// Server-only data access for EAN lists (D1). Every query is parameterised and
// scoped by list id; the list id (UUIDv4) is the capability that grants access.
import type { D1Database } from "@cloudflare/workers-types";

import type { EanList, ListItem, NewItem } from "./list-types";

export const MAX_ITEMS_PER_LIST = 1000;

type ItemRow = {
  id: string;
  ean: string;
  title: string | null;
  price: number | null;
  thumb_url: string | null;
  product_url: string | null;
  done: number;
  position: number;
  created_at: string;
};

function toItem(row: ItemRow): ListItem {
  return {
    id: row.id,
    ean: row.ean,
    title: row.title,
    price: row.price,
    thumbUrl: row.thumb_url,
    productUrl: row.product_url,
    done: row.done === 1,
    position: row.position,
    createdAt: row.created_at,
  };
}

async function touch(db: D1Database, listId: string) {
  await db
    .prepare("UPDATE lists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
    .bind(listId)
    .run();
}

export async function createList(db: D1Database, name: string): Promise<EanList> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO lists (id, name) VALUES (?, ?)").bind(id, name).run();
  const list = await getList(db, id);
  if (!list) throw new Error("Could not create list");
  return list;
}

export async function getList(db: D1Database, listId: string): Promise<EanList | null> {
  const list = await db
    .prepare("SELECT id, name, updated_at FROM lists WHERE id = ?")
    .bind(listId)
    .first<{ id: string; name: string; updated_at: string }>();
  if (!list) return null;
  const { results } = await db
    .prepare(
      "SELECT id, ean, title, price, thumb_url, product_url, done, position, created_at " +
        "FROM list_items WHERE list_id = ? ORDER BY position ASC",
    )
    .bind(listId)
    .all<ItemRow>();
  return { id: list.id, name: list.name, updatedAt: list.updated_at, items: results.map(toItem) };
}

export async function renameList(db: D1Database, listId: string, name: string) {
  await db.prepare("UPDATE lists SET name = ? WHERE id = ?").bind(name, listId).run();
  await touch(db, listId);
}

export type AddResult = { added: number; updated: number; full: boolean };

/**
 * Appends items in order. An EAN already in the list keeps its place and done
 * state; only its product snapshot is refreshed (so re-scanning is harmless).
 */
export async function addItems(
  db: D1Database,
  listId: string,
  items: NewItem[],
): Promise<AddResult> {
  const stats = await db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxPos FROM list_items WHERE list_id = ?",
    )
    .bind(listId)
    .first<{ n: number; maxPos: number }>();
  let count = stats?.n ?? 0;
  let position = (stats?.maxPos ?? -1) + 1;

  const existing = new Set<string>();
  if (items.length > 0) {
    const { results } = await db
      .prepare("SELECT ean FROM list_items WHERE list_id = ?")
      .bind(listId)
      .all<{ ean: string }>();
    for (const row of results) existing.add(row.ean);
  }

  let added = 0;
  let updated = 0;
  let full = false;
  const statements = [];
  for (const item of items) {
    const snapshot = [
      item.title ?? null,
      item.price ?? null,
      item.thumbUrl ?? null,
      item.productUrl ?? null,
    ];
    if (existing.has(item.ean)) {
      statements.push(
        db
          .prepare(
            "UPDATE list_items SET title = COALESCE(?, title), price = COALESCE(?, price), " +
              "thumb_url = COALESCE(?, thumb_url), product_url = COALESCE(?, product_url) " +
              "WHERE list_id = ? AND ean = ?",
          )
          .bind(...snapshot, listId, item.ean),
      );
      updated++;
      continue;
    }
    if (count >= MAX_ITEMS_PER_LIST) {
      full = true;
      break;
    }
    statements.push(
      db
        .prepare(
          "INSERT INTO list_items (id, list_id, ean, title, price, thumb_url, product_url, position) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(crypto.randomUUID(), listId, item.ean, ...snapshot, position),
    );
    existing.add(item.ean);
    position++;
    count++;
    added++;
  }
  if (statements.length > 0) {
    await db.batch(statements);
    await touch(db, listId);
  }
  return { added, updated, full };
}

export async function setItemDone(db: D1Database, listId: string, itemId: string, done: boolean) {
  await db
    .prepare("UPDATE list_items SET done = ? WHERE list_id = ? AND id = ?")
    .bind(done ? 1 : 0, listId, itemId)
    .run();
  await touch(db, listId);
}

export async function setAllDone(db: D1Database, listId: string, done: boolean) {
  await db
    .prepare("UPDATE list_items SET done = ? WHERE list_id = ?")
    .bind(done ? 1 : 0, listId)
    .run();
  await touch(db, listId);
}

export async function deleteItem(db: D1Database, listId: string, itemId: string) {
  await db
    .prepare("DELETE FROM list_items WHERE list_id = ? AND id = ?")
    .bind(listId, itemId)
    .run();
  await touch(db, listId);
}

export async function clearItems(db: D1Database, listId: string, onlyDone: boolean) {
  const sql = onlyDone
    ? "DELETE FROM list_items WHERE list_id = ? AND done = 1"
    : "DELETE FROM list_items WHERE list_id = ?";
  await db.prepare(sql).bind(listId).run();
  await touch(db, listId);
}

/**
 * Fixed-window rate limit. Returns true when the request is allowed. The key
 * is a hash of the client IP, so no raw IPs are stored.
 */
export async function allowRequest(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSeconds);
  const bucket = `${key}:${windowStart}`;
  const row = await db
    .prepare(
      "INSERT INTO rate_limits (bucket, hits, expires_at) VALUES (?, 1, ?) " +
        "ON CONFLICT(bucket) DO UPDATE SET hits = hits + 1 RETURNING hits",
    )
    .bind(bucket, windowStart + windowSeconds)
    .first<{ hits: number }>();
  const hits = row?.hits ?? 1;
  if (hits === 1) {
    // First hit of a new window: sweep expired buckets so the table stays tiny.
    await db.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(now).run();
  }
  return hits <= limit;
}

export async function hashClientKey(ip: string): Promise<string> {
  const bytes = new TextEncoder().encode(`powerean-rate:${ip}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
