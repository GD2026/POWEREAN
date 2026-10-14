// Small in-process cache and rate limiter for the power.no proxy. The app runs
// as one Node process on Render, so process memory is the right place: no
// database to provision, and losing it on restart costs nothing.

const MAX_CACHE_ENTRIES = 1000;
const MAX_CLIENTS = 10_000;

const cache = new Map<string, { value: unknown; expires: number }>();
const hits = new Map<string, { count: number; windowStart: number }>();

export function cacheGet<T>(key: string, now = Date.now()): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires <= now) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function cachePut(key: string, value: unknown, ttlMs: number, now = Date.now()) {
  cache.delete(key);
  cache.set(key, { value, expires: now + ttlMs });
  // Map keeps insertion order, so the first key is the oldest.
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** Fixed-window limit per client key. Returns true when the request is allowed. */
export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()) {
  const entry = hits.get(key);
  if (!entry || now - entry.windowStart >= windowMs) {
    hits.delete(key);
    hits.set(key, { count: 1, windowStart: now });
    while (hits.size > MAX_CLIENTS) hits.delete(hits.keys().next().value!);
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

export function resetServerCacheForTests() {
  cache.clear();
  hits.clear();
}
