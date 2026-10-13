// Server functions: the only entry points the browser can call. Every input is
// validated with zod before it touches power.no or the database.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { bindings } from "../bindings.server";
import {
  addItems,
  allowRequest,
  clearItems,
  createList,
  deleteItem,
  getList,
  hashClientKey,
  renameList,
  setAllDone,
  setItemDone,
} from "../lists.server";
import { lookupPowerProduct } from "../power.server";
import type { LookupResult } from "../product-types";

const LOOKUPS_PER_MINUTE = 60;
const CACHE_SECONDS = 60;

const eanSchema = z.string().regex(/^\d{8,14}$/, "Ugyldig EAN");
const listIdSchema = z.string().uuid();
const itemIdSchema = z.string().uuid();
const listNameSchema = z.string().trim().min(1).max(60);
const httpsUrlOn = (origin: string) =>
  z
    .string()
    .max(500)
    .refine((v) => v.startsWith(`${origin}/`), "Ugyldig URL");

const newItemSchema = z.object({
  ean: eanSchema,
  title: z.string().trim().max(200).nullish(),
  price: z.number().finite().nonnegative().max(10_000_000).nullish(),
  thumbUrl: httpsUrlOn("https://media.power-cdn.net").nullish(),
  productUrl: httpsUrlOn("https://www.power.no").nullish(),
});

function db() {
  const { DB } = bindings();
  if (!DB) throw new Error("Databasen er ikke tilgjengelig");
  return DB;
}

async function requireList(listId: string) {
  const list = await getList(db(), listId);
  if (!list) throw new Error("Fant ikke listen");
  return list;
}

// ---- Product lookup -------------------------------------------------------

export const lookupProduct = createServerFn({ method: "GET" })
  .validator(z.object({ ean: eanSchema }))
  .handler(async ({ data }): Promise<LookupResult> => {
    const { DB } = bindings();
    if (DB) {
      const ip = getRequestHeader("cf-connecting-ip") ?? "unknown";
      const allowed = await allowRequest(DB, await hashClientKey(ip), LOOKUPS_PER_MINUTE, 60);
      if (!allowed) {
        return { status: "error", ean: data.ean, message: "For mange oppslag. Vent litt." };
      }
    }

    // Short edge cache: repeated scans of the same shelf don't hammer power.no.
    const cache =
      typeof caches !== "undefined"
        ? (caches as unknown as { default?: Cache }).default
        : undefined;
    const cacheKey = new Request(`https://cache.powerean.internal/product/${data.ean}`);
    if (cache) {
      const hit = await cache.match(cacheKey).catch(() => undefined);
      if (hit) return (await hit.json()) as LookupResult;
    }

    const result = await lookupPowerProduct(data.ean);
    if (cache && result.status !== "error") {
      const response = Response.json(result, {
        headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` },
      });
      await cache.put(cacheKey, response).catch(() => undefined);
    }
    return result;
  });

// ---- Lists ---------------------------------------------------------------

export const createListFn = createServerFn({ method: "POST" })
  .validator(z.object({ name: listNameSchema }))
  .handler(async ({ data }) => createList(db(), data.name));

export const getListFn = createServerFn({ method: "GET" })
  .validator(z.object({ listId: listIdSchema }))
  .handler(async ({ data }) => getList(db(), data.listId));

export const renameListFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, name: listNameSchema }))
  .handler(async ({ data }) => {
    await requireList(data.listId);
    await renameList(db(), data.listId, data.name);
    return requireList(data.listId);
  });

export const addItemsFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, items: z.array(newItemSchema).min(1).max(500) }))
  .handler(async ({ data }) => {
    await requireList(data.listId);
    const result = await addItems(db(), data.listId, data.items);
    return { ...result, list: await requireList(data.listId) };
  });

export const setItemDoneFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, itemId: itemIdSchema, done: z.boolean() }))
  .handler(async ({ data }) => {
    await setItemDone(db(), data.listId, data.itemId, data.done);
    return requireList(data.listId);
  });

export const setAllDoneFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, done: z.boolean() }))
  .handler(async ({ data }) => {
    await setAllDone(db(), data.listId, data.done);
    return requireList(data.listId);
  });

export const deleteItemFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, itemId: itemIdSchema }))
  .handler(async ({ data }) => {
    await deleteItem(db(), data.listId, data.itemId);
    return requireList(data.listId);
  });

export const clearItemsFn = createServerFn({ method: "POST" })
  .validator(z.object({ listId: listIdSchema, onlyDone: z.boolean() }))
  .handler(async ({ data }) => {
    await clearItems(db(), data.listId, data.onlyDone);
    return requireList(data.listId);
  });
