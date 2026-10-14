// Server functions: the only entry point the browser can call. The server is
// stateless (lists live on each device); it only proxies product lookups to
// power.no, with input validation, a short cache and a per-client rate limit.
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

import { lookupPowerProduct, searchPowerProducts } from "../power.server";
import type { LookupResult, SearchResult } from "../product-types";
import { allowRequest, cacheGet, cachePut } from "../server-cache.server";

const LOOKUPS_PER_MINUTE = 60;
const CACHE_MS = 60_000;

const eanSchema = z.string().regex(/^\d{8,14}$/, "Ugyldig EAN");

function clientKey(): string {
  // Behind Render/Cloudflare the client address arrives in a forwarding header.
  const forwarded = getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    getRequestHeader("cf-connecting-ip") ??
    getRequestHeader("true-client-ip") ??
    forwarded ??
    "unknown"
  );
}

export const lookupProduct = createServerFn({ method: "GET" })
  .validator(z.object({ ean: eanSchema }))
  .handler(async ({ data }): Promise<LookupResult> => {
    if (!allowRequest(clientKey(), LOOKUPS_PER_MINUTE, 60_000)) {
      return { status: "error", ean: data.ean, message: "For mange oppslag. Vent litt." };
    }
    const cached = cacheGet<LookupResult>(data.ean);
    if (cached) return cached;
    const result = await lookupPowerProduct(data.ean);
    // Repeated scans of the same shelf don't hammer power.no; errors are retried.
    if (result.status !== "error") cachePut(data.ean, result, CACHE_MS);
    return result;
  });

const searchTextSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(2, "Skriv minst 2 tegn").max(120));

export const searchProducts = createServerFn({ method: "GET" })
  .validator(z.object({ q: searchTextSchema }))
  .handler(async ({ data }): Promise<SearchResult> => {
    // A search costs several power.no calls; count it as three lookups.
    const key = clientKey();
    const allowed = [0, 1, 2].every(() => allowRequest(key, LOOKUPS_PER_MINUTE, 60_000));
    if (!allowed) {
      return { status: "error", query: data.q, message: "For mange søk. Vent litt." };
    }
    const cacheKey = `search:${data.q.toLowerCase()}`;
    const cached = cacheGet<SearchResult>(cacheKey);
    if (cached) return cached;
    const result = await searchPowerProducts(data.q);
    if (result.status !== "error") cachePut(cacheKey, result, CACHE_MS);
    return result;
  });
